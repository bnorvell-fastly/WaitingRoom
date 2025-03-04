import { ConfigStore } from "fastly:config-store";
import { KVStore } from "fastly:kv-store";
import { SecretStore } from "fastly:secret-store";

// Turn Debug logs off by default. Enable during run time by setting header Fastly-Debug
// timer is a generic for tracking timings when DEBUG is enabled (see console.log calls throughout)
export const DEBUG = 0;

// Since we use the same methods for config and kv stores, this is interchangeable.
async function get_kv_entry(key_store, key_value, as_json) {

    try {
        var kv_data = await key_store.get(key_value);
    } catch(e) {
        console.log("key_store.get:",e);
        return "";
    }

    if(kv_data === null) {
        console.log("Key not found:", key_value);
        return "";
    }

    if (as_json) return await kv_data.json();
    else         return await kv_data.text();
}

async function put_kv_entry(key_store, key, key_value) {

    try {
        await key_store.put(key, key_value, { mode:'overwrite' });
    } catch(e) {
        console.log("key_store.put:",e);
        return "";
    }

}

async function get_secret_entry(key_store, key_value, plaintext) {

    try {
        var kv_data = await key_store.get(key_value);
    } catch(e) {
        console.log("secret_store.get:",e);
        return "";
    }

    if(kv_data === null) {
        console.log("Secret not found:", key_value);
        return "";
    }
    if (plaintext) return await kv_data.plaintext();
    else return await kv_data.rawBytes();
}

// Write a configuration object to the KV store.
export async function writeConfig(queue_path, configObject) {

    try {
        var kv_store = new KVStore('queueConfig');
    } catch (e) {
        console.log(`kv_store.open: ${e}`);
        return "";
    }
    
    put_kv_entry(kv_store, queue_path, configObject);
}

// Get configuration from KV Store and Secret Store
// Read in global config, then apply queue specific override to it if necessary
export async function fetchConfig(queue_path) {

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
    // Get global queue config, then get request path config, if path not found, return empty so no processing occurs
    let globalConfig = await get_kv_entry(kv_store, "globalConfig",1);
    let queueConfig = await get_kv_entry(kv_store, queue_path,1);
    if (!globalConfig || !queueConfig) return "";

    // Anything not overriden, gets copied from the globalConfig object. Yes, this is redundant with providing
    // both objects, but it reduces additional logic in other places. We always presume that the queueConfig
    // is the source of truth.
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
        global: globalConfig,
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
            path: `${queue_path}/${queueConfig.adminPath}`,

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
