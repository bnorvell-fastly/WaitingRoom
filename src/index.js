/// <reference types="@fastly/js-compute" />
import { env } from "fastly:env";

/// Crypto stuff
import { v7 as uuidv7, validate } from 'uuid';

import * as jose from "jose";
const alg = "RS256";

// The name of the backend serving the content that is being protected by the queue.
// Probably move this into the config as well at some point
const CONTENT_BACKEND = "protected_content";

// The name of the log endpoint receiving request logs.
// Move to global config object, and make a per-queue configuration
const LOG_ENDPOINT = "queue_logs";

import { fetchGlobalConfig, fetchQueueConfig } from "./config.js";
import { handleAdminRequest } from "./admin.js";
import * as Store from "./store.js";
import log from "./logging.js";

// Todo - use DynamicBackends for the origin connections to both content and redis.
import { allowDynamicBackends } from "fastly:experimental";

var timer = 0;
export var DEBUG = 0;

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

// Handle an incoming request.
async function handleRequest(event) {
    let VERSION = env("FASTLY_SERVICE_VERSION");
    let HOST = env("FASTLY_HOSTNAME");
    let redis = "";


    const { request, client } = event;
    
    console.log(`=> Service Version : ${VERSION} running on ${HOST} from ${client.address} <=`);
  
    // Get the global configuration object
    let globalConfig = await fetchGlobalConfig();

    // If we pass a Fastly-Debug header, set debug otherwise use the global config value
    request.headers.has("Fastly-Debug")?DEBUG=1:DEBUG=globalConfig.forceDebug;

    const url = new URL(request.url);
    let queuePath = url.pathname;

    if(DEBUG) console.log(`=> Incoming request : ${url}`);

    // Check the global whitelist first, so we don't incur any penalty on those.
    if (globalConfig.whitelist.includes(queuePath)) {
        if(DEBUG) console.log(`=> Whitelisted: ${queuePath}`);
        return await handleAuthorizedRequest(request);
    }

    // Handle global administration 
    if(url.pathname === globalConfig.adminPath)
        return await handleAdminRequest(request, url.pathname, globalConfig, redis);
    
    // Find the queue in the global config object, then load it's configuration
    // No queue config ? Let them have the page.
    let queueName = "";
    
    if(DEBUG) console.log(`:: QueuePath: ${queuePath}`);
    globalConfig.queues.forEach(queue => {
        let pathRegex = new RegExp(queue[0]);
        if(DEBUG) console.log(`::- Checking queue [${queue[1]}] with path [${queue[0]}]`)
        if(pathRegex.test(queuePath)) queueName = queue[1];
    });
    
    // No queue config matching this path at all
    if(!queueName)
        return await handleAuthorizedRequest(request);
  
    // Found a queue configuration, load and process
    let queueConfig = await fetchQueueConfig(globalConfig, queueName);
    if(!queueConfig) // Error handling, this should never occur in normal operations
        return await handleAuthorizedRequest(request);
  
     // Configure the Redis interface.
    redis = Store.getStore(queueConfig);

    // Allow requests to assets that are not protected by a queue, or the queue is disabled.
    if (!queueConfig.queue.active) {
        if(DEBUG) console.log(`==> Queue [${queueName}] is not active`);
        return await handleAuthorizedRequest(request);
    }

    // Allow requests when the queue has expired. Separate logic for this in case we need to add
    // additional processing in the future 
    if (queueConfig.queue.expires && Date.now() > new Date(queueConfig.queue.expires)) {
        if(DEBUG) console.log(`==> Queue [${queueName}] expired at ${new Date(queueConfig.queue.expires)}`);
        return await handleAuthorizedRequest(request);        
    }
    
    // If we are queueing by country, check membership
    if (queueConfig.queue.geocodes && !queueConfig.queue.geocodes.includes(client.geo.country_code3)) {
        // We are not in the listed countries for queueing, so process the request
        if(DEBUG) 
            console.log(`=> Country exception applied: ${queueConfig.queue.geocodes} configured for queueing, client in ${client.geo.country_code3}`);
        return await handleAuthorizedRequest(request);
    }

    if(DEBUG) console.log(`=> Begin processing for queue ${queueConfig.queue.queueName}`);
    
    let jwt_cookie = getQueueCookie(request, queueConfig.queue.cookieName);

    let isValid = 0;
    if(jwt_cookie) {
        
        if(DEBUG) timer = performance.now();
        try {
            // Decode the JWT signature to get the visitor's position in the queue.
            var { payload, protectedHeader } = await jose.jwtVerify(jwt_cookie, queueConfig.publicKey, {
                issuer: 'urn:example:issuer',
                audience: 'urn:example:audience',
                subject: queueConfig.queue.queueName,
            })
            
        } catch (e) {
            // Log error here if desired. A failed token could be one that's expired, or someone trying to do 
            // something interesting with the cookie to subvert the queue.
            if(DEBUG) 
                console.error(`=> Expired or Invalid token (${queueConfig.queue.queueName}), new token will be issued.\n==> Error: ${e}`);
        }
        if(DEBUG) console.log(`=> Validated an ${alg} token, took ${performance.now()-timer} ms`);    
        
        // We have a properly signed cookie, let check the internals      
        if(payload) {
            var UUIDPosition = await Store.checkQueuePosition(redis, queueConfig, payload.UUID);
            
            isValid =
                payload &&
                validate(payload.UUID) &&
                (UUIDPosition === payload.position) &&
                new Date(payload.expiry) > Date.now();
        }        

        if (DEBUG) console.log(`=> Token : isvalid:${isValid} payload:`,payload);
    }

    // Initialise properties used to construct a response.
    let newToken = true;        // new JWT Token
    let visitorPosition = null; // Position in Queue
    let reqsThisPeriod = null;  // # of new queue requests this period
    let tokenUUID = null;

    if (isValid) {
        visitorPosition = payload.position;
        tokenUUID = payload.UUID;
        newToken = false;

        // If cookie expiry is within the next refresh interval, then automatically issue a new cookie,
        // so they don't lose their place in line.
        if(new Date(payload.expiry) - Date.now() <= (queueConfig.queue.refreshInterval*1000)) {
            if(DEBUG) console.log(`==> Token valid, but expiring, reissuing`);
            newToken = true;

            // Update TTL on existing db record for this UUID
            if(!await Store.updateVisitorTTL(redis, queueConfig, tokenUUID)) 
                console.log("==> Unable to update visitor TTL");                
        }
    }

    if(newToken) {
        
        if(!tokenUUID){
            // New visitor, add them to the queue
            tokenUUID = uuidv7();
            visitorPosition = await Store.incrementQueueLength(redis, queueConfig, tokenUUID);
        }
        
        // Sign a JWT with the visitor's position.
        if(DEBUG) timer = performance.now();        
        try {
            newToken = await new jose.SignJWT(
                    { 'position': visitorPosition, 'expiry':new Date(Date.now() + (queueConfig.queue.cookieExpiry * 1000)), 'UUID':tokenUUID }
                )
                .setProtectedHeader( {alg} )
                .setIssuedAt()
                .setIssuer('urn:example:issuer')
                .setAudience('urn:example:audience')
                .setExpirationTime(new Date(Date.now() + (queueConfig.queue.cookieExpiry * 1000)))
                .setSubject(queueConfig.queue.queueName)
                .sign(queueConfig.privateKey)
        } catch(e) {
            console.log(`=> Signing Error: ${e}\n==> Token was NOT created`);
        }      

        if(DEBUG) console.log(`=> Created an ${alg} token, took ${performance.now()-timer} ms`);
    }

    // Fetch the current queue cursor
    let queueCursor = await Store.getQueueCursor(redis, queueConfig);
    
    // Check if the queue has reached the visitor's position yet.
    let permitted = (queueCursor >= visitorPosition);
    if(DEBUG) console.log(`=> Visitor Position: ${visitorPosition} | Cursor: ${queueCursor} | Permitted: ${permitted}`);

    // If we aren't permitted yet, and the automatic allow of users users is enabled, lets process that logic
    if (!permitted && queueConfig.queue.automatic > 0) {     
             
        // New request, see if we're letting anyone through yet this period (configured in global, and per queue objects)
        // This function sets a TTL on the Period record to expire at the end of the automaticPeriod, so the next period
        // will always start at 0
        reqsThisPeriod = await Store.incrementAutoPeriod(redis, queueConfig);

        // If we've not yet allowed the configured # of people through the queue this period, then check placement in line,
        // and let them through if they qualify
        // The 1st request during the new period will automatically bump the auto record, since the 1st request will always set
        // reqsThisPeriod to 1.
        if (reqsThisPeriod === 1) {
            if(DEBUG) console.log(`=> Allowing the next ${queueConfig.queue.automaticQuantity} queue memebers`);
            
            queueCursor = await Store.incrementQueueCursor( redis, queueConfig, queueConfig.queue.automaticQuantity );

            // This might have allowed the user through the queue, check and see
            permitted = (queueCursor >= visitorPosition);
        }
    }

    if (!permitted) 
        var response = await handleUnauthorizedRequest( request, queueConfig, visitorPosition - queueCursor);
    else
        var response = await handleAuthorizedRequest(request);
    
    // Set a cookie on the response if needed and return it to the client.
    // There can be multiple set-cookie headers, use append, and not get so that any other
    // set-cookies don't get overwritten.
    if (newToken)
        response.headers.append(
            "Set-Cookie",
            `${queueConfig.queue.cookieName}=${newToken}; path=/; Secure; HttpOnly; Max-Age=${queueConfig.queue.cookieExpiry}; SameSite=None`
        );
    
    // Log the request and response.
    log(
        LOG_ENDPOINT,
        request,
        client,
        permitted,
        response.status,
        {
            queueCursor,
            visitorPosition,
        }
    );
    
    // Log the # of redis operations to the console, this can be used for billing estimates
    if(DEBUG) console.log(`=> Used ${queueConfig.rediscount} redis operations in ${queueConfig.redistimer} ms.`);
    return response;
}

// Handle an incoming request that has been authorized to access protected content.
async function handleAuthorizedRequest(req) {
    if(DEBUG) console.log(`=> Auth'd req to ${req.url}`);
    return await fetch(req,{ backend: CONTENT_BACKEND });
}

// Handle an incoming request that is not yet authorized to access protected content.
async function handleUnauthorizedRequest(req, config, visitorsAhead) {
    if (visitorsAhead < 0) visitorsAhead = 0;

    // Calculate time remaining in queue
    // - people ahead of you / (# of users per second we allow) = seconds remaining
    let queueTime = visitorsAhead / (config.queue.automaticQuantity / config.queue.automatic);
    let expireTime = (Date.parse(config.queue.expires) - Date.now()+queueTime) / 1000;

    // Queue expires before the calculated end of the queue. Use that time instead.
    if(expireTime < queueTime) queueTime = expireTime;
    
    let queueDate = new Date(queueTime*1000);
    let queueString = "";
    
    // Make a string for the queue time remaining.
    if( queueTime > 86400)
         queueString = "unknown";
    else if(queueTime > 3600)
        // We have  > 1 hour remaining
        queueString = `${queueDate.getHours()} hours, ${queueDate.getMinutes()} minutes, and ${queueDate.getSeconds()} seconds`;
    else
        // < 1 hour remaining
        queueString = `${queueDate.getMinutes()} minutes, and ${queueDate.getSeconds()} seconds`;
    

    return new Response(
        processView(config.pages.waiting_room, {
            visitorsAhead: visitorsAhead.toLocaleString(),
            visitorsVerb: visitorsAhead == 1 ? "is" : "are",
            visitorsPlural: visitorsAhead == 1 ? "person" : "people",
            estimatedTime: queueString
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "text/html",
                "Refresh": config.queue.refreshInterval,
            },
        });
}

function getQueueCookie(req, cookieName) {
    let cookieData = "";
    let cookies = req.headers.get('cookie');
    if (cookies) {
        cookies.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            const name = parts.shift().trim();
            if(name === cookieName) {
                  cookieData = decodeURIComponent(parts.join('='));
            }
        });
    }
    return cookieData;
}

// Injects props into the given template (handlebars syntax)
export function processView(template, props) {
    for (let key in props) {
      template = template.replace(
        new RegExp(`{{\\s?${key}\\s?}}`, "g"),
        props[key]
      );
    }
    return template;
}

// Not using this anymore, left for future consideration
/*
function removeFileFromUrl(url) {
    try {
      const urlObject = new URL(url); // Use the URL constructor
      const pathParts = urlObject.pathname.split('/');
      pathParts.pop(); // Remove the last part (the file)
      urlObject.pathname = pathParts.join('/');
      return urlObject.pathname.toString();
    } catch (error) {
      // Handle cases where the URL is invalid
      console.error("Invalid URL:", error);
      return null;
    }
  }
*/