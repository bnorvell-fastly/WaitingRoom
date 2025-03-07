// Admin functions and code.

import { DEBUG, processView } from "./index.js";
import * as Store from "./store.js";
import { writeConfig, fetchGlobalConfig, fetchQueueConfig } from "./config.js";

import * as base64 from "base-64";


// Handle an incoming request to an admin-related endpoint.
export async function handleAdminRequest(req, path, globalConfig, redis) {
    let newConfig = {};           
    
    if(DEBUG) console.log(`==> Admin request for ${path}`);

    if(DEBUG) console.log("==> Pass:", globalConfig.adminPassword);

    const reqUrl = new URL(req.url);
    
    // If we're administering a single queue, lets get that configuration
    if(reqUrl.searchParams.has("queue")) {
        
        let queue = reqUrl.searchParams.get("queue");

        if(DEBUG) console.log(`=> Configure queue ${queue}`);

        // Get the queue configuration
        let queueConfig = await fetchQueueConfig(globalConfig, queue);

        // ask for auth using the configured store (or global) credentials
        if ( queueConfig.admin.password &&
            req.headers.get("Authorization") != `Basic ${base64.encode(`admin:${queueConfig.admin.password}`)}`
        ){
            return new Response(null, {
                status: 401,
                headers: {
                    "WWW-Authenticate": `Basic realm="Queue ${queueConfig.queue.queueName} Admin"`,
                },
            });
        }

        // Configure the Redis interface (this wont be open yet if we're in admin)
        redis = Store.getStore(queueConfig);

        // Are we allowing users in for this queue ?
        if(reqUrl.searchParams.has("amt")) {
            let amt = parseInt(reqUrl.searchParams.get("amt"));
            if(amt) {
                if(DEBUG) 
                    console.log(`=> Admin allowed ${amt} users in for queue ${queueConfig.queue.queueName}`);

                await Store.incrementQueueCursor(redis, queueConfig, amt || 1);
                
                return new Response(null, {
                    status: 302,
                    headers: {
                        Location: `${globalConfig.adminPath}?queue=${queueConfig.queue.queueName}`,
                    },
                });    
            }
        }

        // Anyone in the queue currently ?
        let visitorsWaiting = (await Store.getQueueLength(redis, queueConfig)) - (await Store.getQueueCursor(redis, queueConfig));
        if (visitorsWaiting < 0) visitorsWaiting = 0;

        // Queue Administration page
        // Two functions - 1. Configure the queue itself, 2. Allow waiting users through the queue
        return new Response(
            `<!DOCTYPE html>
            <html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Queue Administration for ${queueConfig.queue.queueName}</title>
            <style>body { font-family: Tahoma, Arial, sans-serif; font-size=17px; }</style>
            </head><body>
                <form method="POST">
                <table>
                <th colspan=2>Queue configuration for ${queueConfig.queue.queueName}</th>
                <tr></tr>
                <tr><td><label for="queueName">Queue Name</label></td>
                <td><input type="text" name="queueName" value="${queueConfig.queue.queueName}"></td>
                <tr><td><label for="queuePath">Queue Path (key)</label></td>
                <td><input type="text" name="queuePath" value="${queueConfig.queue.queuePath}"></td>
                <tr> <td><label for="active">Is this queue Active</label></td>
                <td><input type="checkbox" name="active" ${queueConfig.queue.active?"checked":"unchecked"} value="0"></td>
                <tr> <td><label for="queuePage">KV Key for the Waiting Room page template</label></td>
                <td><input type="text" name="queuePage" value="${queueConfig.queue.queuePage}"></td>
                <tr> <td><label for="expires">Expiration Date/Time for this queue (GMT)</label></td>
                <td><input type="datetime-local" name="expires" value="${queueConfig.queue.expires}"></td>
                <tr> <td><label for="adminPassword">Queue admin password</label></td>
                <td><input type="password" name="adminPassword" value="${queueConfig.queue.adminPassword}"></td>                
                <tr> <td><label for="adminPath">Queue admin path</label></td>
                <td><input type="text" name="adminPath" value="${queueConfig.queue.adminPath}"></td>  
                <tr><td><label for="geoCodes">Country codes (3 letter) this queue applies to (blank for all)</label></td>
                <td><input type="text" name="geoCodes" ${queueConfig.queue.geoCodes}></td>
                <tr> <td><label for="refreshInterval">Queue page refresh interval (secs)</label></td>
                <td><input type="number" min=0 max=86400 name="refreshInterval" value="${queueConfig.queue.refreshInterval}"></td>
                <tr> <td><label for="cookieName">Default cookie name (beware collisions!)</label></td>
                <td><input type="text" name="cookieName" value="${queueConfig.queue.cookieName}"></td>
                <tr> <td><label for="cookieExpiry">Cookie expiry (sec)</label></td>
                <td><input type="number" min=0 max=31536000 name="cookieExpiry" value="${queueConfig.queue.cookieExpiry}"></td>
                <tr> <td><label for="automatic">How often to let users in automatically (sec)</label></td>
                <td><input type="number" min=0 name="automatic" value="${queueConfig.queue.automatic}"></td>
                <tr> <td><label for="automaticQuantity">How many users to let in each period</label></td>
                <td><input type="number" min=0 name="automaticQuantity" value="${queueConfig.queue.automaticQuantity}"></td>
                <tr> <td><label for="redisUrl">Url to your redis instance</label></td>
                <td><input type="url" size=60 name="redisUrl" value="${queueConfig.queue.redisUrl}"></td>
                <tr> <td><label for="redisToken">Secret store key for your redis token</label></td>
                <td><input type="text" size=60 name="redisToken" value="${queueConfig.queue.redisToken}"></td>
                <tr> <td><label for="privateKey">Secret Store key for your cookie private key</label></td>
                <td><input type="text" size=60 name="privateKey" value="${queueConfig.queue.privateKey}"></td>
                <tr> <td><label for="publicKey">Secret Store key for your cookie public key</label></td>
                <td><input type="text" size=60 name="publicKey" value="${queueConfig.queue.publicKey}"></td>

                <tr> <td><input type="submit" value="Save Configuiration Changes"></td>
                </table>
                </form>
                <br>
                <table>
                <br>
                <form method="get">
                    <input type="hidden" name="queue" value="${queueConfig.queue.queueName}" hidden />
                    <input type="number" name="amt" value="1" />
                    <input type="submit" value="Let visitors in" />                    
                </form>
                <br/>

                <p>There are <em>${visitorsWaiting}</em> visitors waiting to enter.</p>
            </body></html>`,
            { status:200,
                headers: { "Content-Type": "text/html", },
            }
            );
    }

    // Performing global configuration
    if (req.headers.get("Authorization") != `Basic ${base64.encode(`admin:${globalConfig.adminPassword}`)}`)
    {
        return new Response(null, {
            status: 401,
            headers: {
                "WWW-Authenticate": 'Basic realm="Global Queue Administration"',
            },
        });
    }

    // If we're posting new data, then update the record accordingly, and write it back to the KV store
    if(req.method === "POST") {
        const reqBody = new String(await req.text());

        newConfig = {};
        if (reqBody) {
            reqBody.split('&').forEach(param => {
                const parts = param.split('=');
                const name = parts.shift().trim();
                value = decodeURIComponent(parts.join('='));
                newConfig[`${name}`]=`${value}`;
            });
        }

        // Copy the config elements, and write it.
        for( conf in newConfig )
            globalConfig[conf] = newConfig[conf];

        // Since the checkboxes might not be present (unchecked), we need to validate them individually (forceDbug and active)
        if(!newConfig.forceDebug) globalConfig.forceDebug = false;
        if(!newConfig.active) globalConfig.active = false;

        console.log(`=> Password:`, decodeURIComponent(globalConfig.password));

        // Now write the object back out the the KV store, and re-read it back into memory
        writeConfig("globalConfig", JSON.stringify(globalConfig));
        globalConfig = await fetchGlobalConfig(path);                     
    }
    
    let adminBody = 
        `<!DOCTYPE html>
        <html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Virtual Queue</title>
        <style>body { font-family: Tahoma, Arial, sans-serif; font-size=17px; }</style>
        </head><body>
            <form method="POST">
            <table>
            <tr><td><label for="forceDebug">Force Debug logging</label></td>
            <td><input type="checkbox" name="forceDebug" ${globalConfig.forceDebug?"checked":"unchecked"} value="true"></td>
            <tr> <td><label for="active">Default queue state to active</label></td>
            <td><input type="checkbox" name="active" ${globalConfig.active?"checked":"unchecked"} value="true"></td>
            <tr> <td><label for="adminPath">Queue admin path</label></td>
            <td><input type="text" name="adminPath" value="${globalConfig.adminPath}"></td>
            <tr> <td><label for="adminPassword">Default queue admin password (alphanumeric only, 4-32 chars)</label></td>
            <td><input type="password" name="adminPassword" value="${globalConfig.adminPassword}" pattern="[0-9a-zA-Z]{4,32}"></td>                
            <tr> <td><label for="refreshInterval">Queue page refresh interval (secs)</label></td>
            <td><input type="number" min=0 max=86400 name="refreshInterval" value="${globalConfig.refreshInterval}"></td>
            <tr> <td><label for="cookieName">Default cookie name (beware collisions!)</label></td>
            <td><input type="text" name="cookieName" value="${globalConfig.cookieName}"></td>
            <tr> <td><label for="cookieExpiry">Cookie expiry (sec):</label></td>
            <td><input type="number" min=0 max=31536000 name="cookieExpiry" value="${globalConfig.cookieExpiry}"></td>
            <tr> <td><label for="automatic">How often to let users in automatically (sec)</label></td>
            <td><input type="number" min=0 name="automatic" value="${globalConfig.automatic}"></td>
            <tr> <td><label for="automaticQuantity">How many users to let in each period</label></td>
            <td><input type="number" min=0 name="automaticQuantity" value="${globalConfig.automaticQuantity}"></td>
            <tr> <td><label for="redisUrl">Url to your redis instance</label></td>
            <td><input type="url" size=60 name="redisUrl" value="${globalConfig.redisUrl}"></td>
            <tr> <td><input type="submit" value="Save Changes"></td>
            </table>
            </form>
            <br>
            <table>
            <td colspan=2>Secret Store record names (these will be the default for all queues unless overriden by a queue configuration)</td><tr><tr>
            <td></td><tr>
            <td>Redis token for API access</td><td>global_redisToken</td><tr>
            <td>Default private key for the Queue token</td><td>global_privateKey</td><tr>
            <td>Default public key for the Queue token</td><td>global_publicKey</td><tr>
            </table>
            <br>
            Currently Defined Queues
            <table>
            <th>Name</th><th>Path</th>`;

            globalConfig.queues.forEach(queue => {
                adminBody += `<tr><td width=40>${queue[1]}</td><td>${queue[0]}</td></tr>`;
            });

            adminBody += `</table></body></html>`;
    
    return new Response( adminBody, { 
            status:200,
            headers: { "Content-Type": "text/html", },
            }
        );













    
   /* 
    if (path == config.admin.path) {
        let reqUrl = new URL(req.url);

        // Check if we're allowing users in

     
        // If we're posting new data, then update the record accordingly, and write it back to the KV store
        if(req.method === "POST") {
            const reqBody = new String(await req.text());

            newConfig = {};
            if (reqBody) {
                reqBody.split('&').forEach(param => {
                    const parts = param.split('=');
                    const name = parts.shift().trim();
                    value = decodeURIComponent(parts.join('='));
                    newConfig[`${name}`]=`${value}`;
                });
            }

            // Only copy things that are different. Add validation here once this is all working as intended.
            // Updating of the queue path is disallowed
            console.log("Config before: ", config.queue);

            for( conf in newConfig )
                if(config.queue[conf] != newConfig[conf] && conf != "queuePath")
                    config.queue[conf] = newConfig[conf];
            
            console.log("newConfig: ", newConfig);
            console.log("Config after: ", config.queue);

            // Now write the object back out the the KV store, and re-read it back into memory
            writeConfig(config.queue.queuePath, JSON.stringify(config.queue));
            config = await fetchConfig(config.queue.queuePath); 
                    
        }
        
     */  
}
