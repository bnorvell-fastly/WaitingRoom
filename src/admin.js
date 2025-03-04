// Admin functions and code.

import { DEBUG, processView } from "./index.js";
import * as Store from "./store.js";
import { fetchConfig, writeConfig } from "./config.js";

import * as base64 from "base-64";


// Handle an incoming request to an admin-related endpoint.
export async function handleAdminRequest(req, path, config, redis) {
                
    // Global queue configuration
    if (path == "/QueueAdmin") {

        // If we have a global queue object, get it - otherwise we will create a new one.
        let globalConfig = await fetchConfig("globalConfig"); 
        
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

            let newConfig = {};
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
            let globalConfig = {             
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
                }
            }
            // Should also create (and save) the /sample_path queue as well, since it's a fresh setup
            let queueConfig = {
                queue: {
                    "queueName": "sample_queue",
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
     
        let visitorsWaiting = (await Store.getQueueLength(redis, config)) - (await Store.getQueueCursor(redis, config));
        if (visitorsWaiting < 0) visitorsWaiting = 0;

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
