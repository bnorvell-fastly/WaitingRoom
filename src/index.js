/// <reference types="@fastly/js-compute" />
import { env } from "fastly:env";

/// Crypto stuff
import { v7 as uuidv7, validate } from 'uuid';
import * as jose from "jose";
const alg = "RS256";

// The name of the backend serving the content that is being protected by the queue.
// Probably move this into the config as well at some point
const CONTENT_BACKEND = "protected_content";

// An array of paths that will be served from the origin regardless of the visitor's queue state.
// Add paths to be protected to the queue config as well, perhaps in the global object, linking path to queue
// TODO : Make this whitelist a config store object, for paths or objects that are NEVER to be placed into a 
//        waiting room
const QUEUE_WHITELIST = [
    "/assets/background.jpg",
    "/assets/logo.svg",
];

// The name of the log endpoint receiving request logs.
// Move to global config object, or make a per-queue configuration
const LOG_ENDPOINT = "queue_logs";

import { fetchGlobalConfig, fetchQueueConfig } from "./config.js";
import { handleAdminRequest } from "./admin.js";
import * as Store from "./store.js";
import log from "./logging.js";

// Todo - use DynamicBackends for the origin connections to both content and redis.
import { allowDynamicBackends } from "fastly:experimental";
import { getGeolocationForIpAddress } from "fastly:geolocation";

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
    
    console.log(`:: QueuePath: ${queuePath}`);
    globalConfig.queues.forEach(queue => {
        let pathRegex = new RegExp(queue[0]);
        console.log(`::- Checking [${queue[0]}]`)
        if(pathRegex.test(queuePath)) queueName = queue[1];
    });
    
    let queueConfig = await fetchQueueConfig(globalConfig, queueName);
    if(!queueConfig)
        return await handleAuthorizedRequest(request);
  
     // Configure the Redis interface.
    redis = Store.getStore(queueConfig);

    // Handle requests to admin endpoints.
    // if (.admin.path && url.pathname.startsWith(config.admin.path) || url.pathname === "/QueueAdmin")
    
    // Allow requests to assets that are not protected by a queue, or the queue is disabled.
    if (!queueConfig.queue.active) {
        if(DEBUG) console.log("==> Queue is not active", queueConfig.queue.active);
        return await handleAuthorizedRequest(request);
    }
    
    // If we are queueing by country, check membership
    if (queueConfig.queue.geocodes && !queueConfig.queue.geocodes.includes(client.geo.country_code3)) {
        // We are not in the listed countries for queueing, so process the request
        if(DEBUG) 
            console.log(`=> Country exception applied: ${queueConfig.queue.geocodes} configured for queueing, client in ${clientGeo.country_code3}`);
        return await handleAuthorizedRequest(request);
    }

    if(DEBUG) console.log(`=> Begin processing for queue ${queueConfig.queue.queueName}`);
    
    let jwt_cookie = getQueueCookie(request, queueConfig.queue.cookieName);

    let isValid = 0;
    if(jwt_cookie) {
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
                console.error(`=> Expired or Invalid token (${queueConfig.queue.queueName}), new token will be issued.\n=> Error: ${e}`);
        }
            
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
    let newToken = null;        // new JWT Token
    let visitorPosition = null; // Position in Quque
    let reqsThisPeriod = null;  // # of new queue requests this period

    if (payload && isValid) {
        visitorPosition = payload.position;
    } else {
        // Generate a UUID to associate with this queue position
        let tokenUUID = uuidv7();
        
        // Add a new visitor to the end of the queue.
        visitorPosition = await Store.incrementQueueLength(redis, queueConfig, tokenUUID);

        // Sign a JWT with the visitor's position.
        // TODO : Set the expiration of the cookie more intelligently (look at queue expiration, etc)
        timer = performance.now();        
        try {
            newToken = await new jose.SignJWT(
                    { 'position': visitorPosition, 'expiry':new Date(Date.now() + queueConfig.queue.cookieExpiry * 1000), 'UUID':tokenUUID }
                )
                .setProtectedHeader( {alg} )
                .setIssuedAt()
                .setIssuer('urn:example:issuer')
                .setAudience('urn:example:audience')
                .setExpirationTime(new Date(Date.now() + queueConfig.queue.cookieExpiry * 1000))
                .setSubject(queueConfig.queue.queueName)
                .sign(queueConfig.privateKey)
        } catch(e) {
            console.log("Signing Error: ",e,"\nToken not created");
        }      
        if(DEBUG) console.log(`=> Created an ${alg} token, took ${performance.now()-timer}ms`);

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

        // if(DEBUG) console.log(`S: ${reqsThisPeriod} Q: ${queueConfig.automatic} A:${queueConfig.automaticQuantity}`);
     
        // If we've not yet allowed the configured # of people through the queue this period, then check placement in line,
        // and let them through if they qualify
        // The 1st request during the new period will automatically bump the cursor, since the 1st request will always set
        // reqsThisPeriod to 1.
        if (reqsThisPeriod === 1) {
            if(DEBUG) console.log(`=> Allowing the next ${queueConfig.queue.automaticQuantity} queue memebers`);
            
            queueCursor = await Store.incrementQueueCursor( redis, queueConfig, queueConfig.queue.automaticQuantity );

            if (visitorPosition < queueCursor) {
                permitted = true;
            }
        }
    }

    if (!permitted) {
        var response = await handleUnauthorizedRequest(
            request,
            queueConfig,
            visitorPosition - queueCursor
        );
    } else {
        var response = await handleAuthorizedRequest(request);
    }

    // Set a cookie on the response if needed and return it to the client.
    if (newToken) {
        response.headers.set(
            "Set-Cookie",
            `${queueConfig.queue.cookieName}=${newToken}; path=/; Secure; HttpOnly; Max-Age=${queueConfig.queue.cookieExpiry}; SameSite=None`
        );
    }

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
    if(DEBUG) console.log(`Used ${queueConfig.rediscount} redis operations.`);
    return response;
}

// Handle an incoming request that has been authorized to access protected content.
async function handleAuthorizedRequest(req) {
    if(DEBUG) console.log(`Auth'd req to ${req.url}`);
    return await fetch(req, {
        backend: CONTENT_BACKEND,
        ttl: 86400,
    });
}

// Handle an incoming request that is not yet authorized to access protected content.
async function handleUnauthorizedRequest(req, config, visitorsAhead) {
    if (visitorsAhead < 0) visitorsAhead = 0;
    return new Response(
        processView(config.pages.waiting_room, {
            visitorsAhead: visitorsAhead.toLocaleString(),
            visitorsVerb: visitorsAhead == 1 ? "is" : "are",
            visitorsPlural: visitorsAhead == 1 ? "person" : "people"
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