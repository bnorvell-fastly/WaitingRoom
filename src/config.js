import { ConfigStore } from "fastly:config-store"; // Future use
import { KVStore } from "fastly:kv-store";
import { SecretStore } from "fastly:secret-store";
import { DEBUG } from "./index.js";


// Since we use the same methods for config and kv stores, this is interchangeable.
export async function get_kv_entry(key_store, key_value, as_json) {

    try {
        var kv_data = await key_store.get(key_value);
    } catch(e) {
        console.log("key_store.get:",e);
        return "";
    }

    if(kv_data === null) {
        if(DEBUG)  console.log("Key not found:", key_value);
        return "";
    }
    
    if (as_json) return await kv_data.json();
    else         return await kv_data.text();
}

export async function put_kv_entry(key_store, key, key_value) {
    try {
        await key_store.put(key, key_value, { mode:'overwrite' });
    } catch(e) {
        console.log("key_store.put:",e);
        return "";
    }
}

export async function get_secret_entry(key_store, key_value, plaintext) {

    try {
        var kv_data = await key_store.get(key_value);
    } catch(e) {
        console.log("secret_store.get:",e);
        return "";
    }

    if(kv_data === null) {
        if(DEBUG) console.log("Secret not found:", key_value);
        return "";
    }
    if (plaintext) return await kv_data.plaintext();
    else return await kv_data.rawBytes();
}

// Function here in case we want/need to do some more extensive logic in the future.
export async function writeConfig(key, config) {
    try {
        var kv_store = new KVStore('queueConfig');
    } catch (e) {
        console.log(`kv_store.open: ${e}`);
        return "";
    }
    
    put_kv_entry(kv_store, key, config);
}

// Get global configuration (contains all queue config references, and system defaults)
export async function fetchGlobalConfig() {
    try {
        var kv_store = new KVStore('queueConfig');
    } catch (e) {
        console.log(`kv_store.open: ${e}`);
        return "";
    }
    
    let globalConfig = await get_kv_entry(kv_store, "globalConfig",1);

    // If we didn't find a config entry, set defaults and save
    if(!globalConfig) {
        globalConfig = {
            "queueName": "global_config",
            "forceDebug": true,
            "active": false,
            "expires": "",
            "adminPassword": "change me soon",
            "adminPath": "_queue",
            "queues": [
                [ "sample_queue", "/sample_path" ],
            ],
            "whitelist": [
                "/robots.txt",
                "/favicon.ico"
            ],
            "refreshInterval": 15,
            "cookieName": "global-queue",
            "cookieExpiry": 86400,
            "automatic": 60,
            "automaticQuantity": 0,
            "redisUrl": "https://your.redis.instance:443",
            "redisToken": "global_redisToken",
            "queuePage": "global_Queue",
            "adminPage": "global_Admin",
            "privateKey": "global_privateKey",
            "publicKey": "global_publicKey"                
        };

        // Write this default back out to the KV store
        await put_kv_entry(kv_store, "globalConfig", JSON.stringify(globalConfig));

        // Re-read the config back into memory
        // This ensures that a) we wrote it properly and b) that it's in the local KV cache
        // for future requests
        globalConfig = await get_kv_entry(kv_store, "globalConfig",1);
    }
    
    // Return the config object
    return globalConfig;
}

// Get configuration from KV Store and Secret Store
// Read in global config, then apply queue specific override to it if necessary
export async function fetchQueueConfig(globalConfig, queueName) {

    try {
        var kv_store = new KVStore('queueConfig');
    } catch (e) {
        console.log(`kv_store.open: ${e}`);
        return "";
    }
    
    try {
        var secret_store = new SecretStore('queue-secrets');
    } catch (e) {
        console.log(`secret_store.open: ${e}`);
        return "";
    }
    
    if(DEBUG) console.log(`==> Loading config data for queue [${queueName}]`);

    // Get global queue config, then get request path config, if path not found, return empty so no processing occurs
    let queueConfig = await get_kv_entry(kv_store, queueName,1);
    if(!queueConfig) {
        if(DEBUG) console.log(`No queue for path [${queueName}]`);
        return "";
    }

    // Anything not overriden, gets copied from the globalConfig object. Yes, this is redundant with providing
    // both objects, but it reduces additional logic in other places. We always presume that the queueConfig
    // is the source of truth.
    // Todo - make this an iterator, instead of individuals
    if(!queueConfig.adminPath) queueConfig.adminPath = globalConfig.adminPath;
    if(!queueConfig.adminPassword) queueConfig.adminPassword = globalConfig.adminPassword;

    if(!queueConfig.refreshInterval) queueConfig.refreshInterval = globalConfig.refreshInterval;
    if(!queueConfig.cookieName) queueConfig.cookieName = globelConfig.cookieName;
    if(!queueConfig.cookieExpiry) queueConfig.cookieExpiry = globalConfig.cookieExpiry;
    if(!queueConfig.tokenExpiry) queueConfig.tokenExpiry = globalConfig.tokenExpiry;
    if(!queueConfig.automatic) queueConfig.automatic = globalConfig.automatic;
    if(!queueConfig.automaticQuantitiy) queueConfig.automaticQuantitiy = globalConfig.automaticQuantitiy;
    if(!queueConfig.redisUrl) queueConfig.redisUrl = globalConfig.redisUrl;
    if(!queueConfig.redisToken) queueConfig.redisToken = globalConfig.redisToken;
    if(!queueConfig.queuePage) queueConfig.queuePage = globalConfig.queuePage;
    if(!queueConfig.adminPage) queueConfig.adminPage = globalConfig.adminPage;
    if(!queueConfig.privateKey) queueConfig.privateKey = globalConfig.privateKey;
    if(!queueConfig.publicKey) queueConfig.publicKey = globalConfig.publicKey;
    
    // Load the waiting and admin room pages into memory
    let waiting_room = await get_kv_entry(kv_store, queueConfig.queuePage);
    let admin_page = await get_kv_entry(kv_store, queueConfig.adminPage);
    
    // Load keys for JWT processing
    let publicKey = JSON.parse(await get_secret_entry(secret_store, queueConfig.publicKey, 1));
    let privateKey = JSON.parse(await get_secret_entry(secret_store, queueConfig.privateKey, 1));
    
    // Load the redis configuration
    let redisUrl = queueConfig.redisUrl;
    let redisToken = await get_secret_entry(secret_store, queueConfig.redisToken, 1);

    // Return all the config data as a single JSON object in memory
    return {
        queue: queueConfig,
        publicKey: publicKey,
        privateKey: privateKey,
        redisUrl: redisUrl,
        redisToken: redisToken,
        rediscount: 0,
        admin: {
            // the path for serving the admin interface and API
            //
            // set to null to disable the admin interface
            path: queueConfig.adminPath,

            // the password for the admin interface, requested
            // when the admin path is accessed via HTTP Basic Auth
            // with the username `admin`.
            //
            // set to null to disable HTTP Basic Auth (not recommended!)
            password: queueConfig.adminPassword,
        },
        pages: {
            waiting_room: waiting_room,
            admin_page: admin_page
        }
    };
}