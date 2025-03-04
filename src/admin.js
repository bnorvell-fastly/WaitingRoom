// Admin functions and code.

import { DEBUG, processView } from "./index.js";
import * as Store from "./store.js";
import { fetchConfig, writeConfig } from "./config.js";

import * as base64 from "base-64";


// Handle an incoming request to an admin-related endpoint.
export async function handleAdminRequest(req, path, config, redis) {
    let globalConfig = {};
    let newConfig = {};           
    
    // Global queue configuration
    if (path == "/QueueAdmin") {

        // If we have a global queue object, get it - otherwise we will create a new one.
        globalConfig = await fetchConfig("globalConfig"); 
        
        // Use global configuration for this password
        if (globalConfig.global.adminPassword &&
            req.headers.get("Authorization") != `Basic ${base64.encode(`admin:${globalConfig.global.adminPassword}`)}`
        )
        {
            return new Response(null, {
                status: 401,
                headers: {
                    "WWW-Authenticate": 'Basic realm="Global Queue Administration"',
                },
            });
        }

        // If we're posting new data, then update the record accordingly, and write it back to the KV store
        if(req.method === "POST" && globalConfig) {
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
            for( conf in newConfig )
                if(globalConfig.global[conf] != newConfig[conf])
                    globalConfig.global[conf] = newConfig[conf];

            // Now write the object back out the the KV store, and re-read it back into memory
            writeConfig("globalConfig", JSON.stringify(globalConfig.global));
            globalConfig = await fetchConfig("globalConfig"); 
                    
        }
        
        if(!globalConfig) {
            // 1st time running, lets setup with some default values to begin with.
            globalConfig = {             
                global: {
                    "queueName": "global_config",
                    "forceDebug": false,
                    "active": false,
                    "expires": "",
                    "adminPassword": "change me soon",
                    "adminPath": "_queueAdmin",
                    "queues": [
                        [ "sample_queue", "/sample_path" ],
                    ],
                    "refreshInterval": 15,
                    "cookieName": "global-queue",
                    "cookieExpiry": 86400,
                    "automatic": 300,
                    "automaticQuantity": 1,
                    "redisUrl": "https://your.redis.instance:443",
                    "redisToken": "global_redisToken",
                    "queuePage": "global_Queue",
                    "adminPage": "global_Admin",
                    "privateKey": "global_privateKey",
                    "publicKey": "global_publicKey"                
                },
                queue: {
                    "queueName": "sample_queue",
                    "queuePath": "/samplequeue",
                    "active": false,
                    "expires": "",
                    "adminPassword": "change me soon",
                    "adminPath": "_queueAdmin",
                    "geocodes": [],
                    "refreshInterval": 15,
                    "cookieName": "sample_queue",
                    "cookieExpiry": 86400,
                    "automatic": 0,
                    "automaticQuantity": 1,
                    "redisUrl": "",
                    "redisToken": "",
                    "queuePage": "",
                    "adminPage": "",
                    "privateKey": "",
                    "publicKey": ""
                }
            }
        }
        
        return new Response(
            `<!DOCTYPE html>
            <html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Virtual Queue</title>
            <style>body { font-family: Tahoma, Arial, sans-serif; font-size=17px; }</style>
            </head><body>
                <form method="POST">
                <table>
                <tr><td><label for="forceDebug">Force Debug logging</label></td>
                <td><input type="checkbox" name="forceDebug" ${globalConfig.global.forceDebug?"checked":"unchecked"} value="1"></td>
                <tr> <td><label for="active">Default queue state to active</label></td>
                <td><input type="checkbox" name="active" ${globalConfig.global.active?"checked":"unchecked"} value="1"></td>
                <tr> <td><label for="adminPath">Default queue admin path</label></td>
                <td><input type="text" name="adminPath" value="${globalConfig.global.adminPath}"></td>
                <tr> <td><label for="adminPassword">Default queue admin password</label></td>
                <td><input type="password" name="adminPassword" value="${globalConfig.global.adminPassword}"></td>                
                <tr> <td><label for="refreshInterval">Queue page refresh interval (secs)</label></td>
                <td><input type="number" min=0 max=86400 name="refreshInterval" value="${globalConfig.global.refreshInterval}"></td>
                <tr> <td><label for="cookieName">Default cookie name (beware collisions!)</label></td>
                <td><input type="text" name="cookieName" value="${globalConfig.global.cookieName}"></td>
                <tr> <td><label for="cookieExpiry">Cookie expiry (sec):</label></td>
                <td><input type="number" min=0 max=31536000 name="cookieExpiry" value="${globalConfig.global.cookieExpiry}"></td>
                <tr> <td><label for="automatic">How often to let users in automatically (sec)</label></td>
                <td><input type="number" min=0 name="automatic" value="${globalConfig.global.automatic}"></td>
                <tr> <td><label for="automaticQuantity">How many users to let in each period</label></td>
                <td><input type="number" min=0 name="automaticQuantity" value="${globalConfig.global.automaticQuantity}"></td>
                <tr> <td><label for="redisUrl">Url to your redis instance</label></td>
                <td><input type="url" size=60 name="redisUrl" value="${globalConfig.global.redisUrl}"></td>
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
            </body></html>`,
            { status:200,
                headers: { "Content-Type": "text/html", },
            }
            );
    }

    // ask for auth using the configured store (or global) credentials
    if (
        config.admin.password &&
        req.headers.get("Authorization") != `Basic ${base64.encode(`admin:${config.admin.password}`)}`
    ){
        return new Response(null, {
            status: 401,
            headers: {
                "WWW-Authenticate": 'Basic realm="Queue Admin"',
            },
        });
    }
    
    
    if (path == config.admin.path) {
        let reqUrl = new URL(req.url);

        // Check if we're allowing users in
        if(reqUrl.searchParams.has("amt")) {
            let amt = parseInt(reqUrl.searchParams.get("amt"));
            if(amt) {
                if(DEBUG) 
                    console.log(`=> Admin allowed ${amt} users in for queue ${config.queueName}`);

                await Store.incrementQueueCursor(redis, config, amt || 1);
                
                return new Response(null, {
                    status: 302,
                    headers: {
                        Location: config.admin.path,
                    },
                });    
            }
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
        
        let visitorsWaiting = (await Store.getQueueLength(redis, config)) - (await Store.getQueueCursor(redis, config));
        if (visitorsWaiting < 0) visitorsWaiting = 0;

        // Queue Administration page
        // Two functions - 1. Configure the queue itself, 2. Allow waiting users through the queue
        return new Response(
            `<!DOCTYPE html>
            <html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Queue Administration for ${config.queue.queueName}</title>
            <style>body { font-family: Tahoma, Arial, sans-serif; font-size=17px; }</style>
            </head><body>
                <form method="POST">
                <table>
                <th colspan=2>Queue configuration for ${config.queue.queueName}</th>
                <tr></tr>
                <tr><td><label for="queueName">Queue Name</label></td>
                <td><input type="text" name="queueName" value="${config.queue.queueName}"></td>
                <tr><td><label for="queuePath">Queue Path (key)</label></td>
                <td><input type="text" name="queuePath" value="${config.queue.queuePath}"></td>
                <tr> <td><label for="active">Is this queue Active</label></td>
                <td><input type="checkbox" name="active" ${config.queue.active?"checked":"unchecked"} value="0"></td>
                <tr> <td><label for="queuePage">KV Key for the Waiting Room page template</label></td>
                <td><input type="text" name="queuePage" value="${config.queue.queuePage}"></td>
                <tr> <td><label for="expires">Expiration Date/Time for this queue (GMT)</label></td>
                <td><input type="datetime-local" name="expires" value="${config.queue.expires}"></td>
                <tr> <td><label for="adminPassword">Queue admin password</label></td>
                <td><input type="password" name="adminPassword" value="${config.queue.adminPassword}"></td>                
                <tr> <td><label for="adminPath">Queue admin path</label></td>
                <td><input type="text" name="adminPath" value="${config.queue.adminPath}"></td>  
                <tr><td><label for="geoCodes">Country codes (3 letter) this queue applies to (blank for all)</label></td>
                <td><input type="text" name="geoCodes" ${config.queue.geoCodes}></td>
                <tr> <td><label for="refreshInterval">Queue page refresh interval (secs)</label></td>
                <td><input type="number" min=0 max=86400 name="refreshInterval" value="${config.queue.refreshInterval}"></td>
                <tr> <td><label for="cookieName">Default cookie name (beware collisions!)</label></td>
                <td><input type="text" name="cookieName" value="${config.queue.cookieName}"></td>
                <tr> <td><label for="cookieExpiry">Cookie expiry (sec)</label></td>
                <td><input type="number" min=0 max=31536000 name="cookieExpiry" value="${config.queue.cookieExpiry}"></td>
                <tr> <td><label for="automatic">How often to let users in automatically (sec)</label></td>
                <td><input type="number" min=0 name="automatic" value="${config.queue.automatic}"></td>
                <tr> <td><label for="automaticQuantity">How many users to let in each period</label></td>
                <td><input type="number" min=0 name="automaticQuantity" value="${config.queue.automaticQuantity}"></td>
                <tr> <td><label for="redisUrl">Url to your redis instance</label></td>
                <td><input type="url" size=60 name="redisUrl" value="${config.queue.redisUrl}"></td>
                <tr> <td><label for="redisToken">Secret store key for your redis token</label></td>
                <td><input type="text" size=60 name="redisToken" value="${config.queue.redisToken}"></td>
                <tr> <td><label for="privateKey">Secret Store key for your cookie private key</label></td>
                <td><input type="text" size=60 name="privateKey" value="${config.queue.privateKey}"></td>
                <tr> <td><label for="publicKey">Secret Store key for your cookie public key</label></td>
                <td><input type="text" size=60 name="publicKey" value="${config.queue.publicKey}"></td>

                <tr> <td><input type="submit" value="Save Configuiration Changes"></td>
                </table>
                </form>
                <br>
                <table>
                <br>
                <form method="get" action="{{ adminBase }}">
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
        
        
        return new Response(
            processView(config.pages.admin_page, {
                adminBase: config.admin.path,
                visitorsWaiting,
            }),

            {
                status: 200,
                headers: {
                    "Content-Type": "text/html",
                },
            });
    }
}
