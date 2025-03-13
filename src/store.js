import { Redis } from "@upstash/redis/fastly";
1//import Redis from "redis"; // - This does not work due to node.js dependencies that Fastly does not support

// Typical usage (billing implications) :
// Each compute request will consume 1 connection to Redis. 
// 6 operations for a new queue member
// 3 operations for a queued member in queue
// 2 operations for an allowed queued member (or any allowed member that checks the config (enabled:true in the queue config))
// config.rediscount will always contain a count of the redis operations performed for any given request. 

// Helper function for configuring a Redis client.
export function getStore(config) {
    return new Redis({
        url: config.redisUrl,
        token: config.redisToken,
        backend: "redis",
    });
}

// Get the current queue cursor, i.e. how many visitors have been let in.
// If we don't have a cursor, the answer is 0
export async function getQueueCursor(store, config) {
    config.rediscount++;
    return parseInt((await store.get(`${config.queue.queueName}:cursor`)) || 0);
}

// Increment the current queue cursor, letting in `amt` visitors.
// Returns the new cursor value.
export async function incrementQueueCursor(store, config, amt) {
    // Setting an automatic value of 0 disables automatic queue entry. No need to call redis
    // for that.    
    if(amt === 0) return 0;

    config.rediscount++;
    return await store.incrby(`${config.queue.queueName}:cursor`, amt);
}

// Get the current length of the queue. This may not match the number of users waiting
// Since we may have abandoned tokens
export async function getQueueLength(store, config) {
    config.rediscount++;
    return parseInt(await store.get(`${config.queue.queueName}:length`));
}

// Update the TTL on a visitor record. This allows for a low cookie timer to be set, allowing genuine
// users to keep thier place in line, while purging positions assigned to bots, or other processes that
// are not storing the cookie issued to them.
export async function updateVisitorTTL(store, config, UUID) {
    config.rediscount++;
    return await store.pexpire(`${config.queue.queueName}:QP:${UUID}`, config.queue.cookieExpiry*1000);
}

// Add a visitor to the queue.
// Returns the new queue length.
export async function incrementQueueLength(store, config, UUID) {
    config.rediscount+= 2;
    let queuePosition = await store.incr(`${config.queue.queueName}:length`);
    
    // Insert a UUID record with this position, reserving it for that user. This allows us
    // to validate a queue position if necessary. Only set this key if it does not already exist.
    // Reservations persist as long as the cookie lives, set the TTL in milliseconds, accordingly.
    await store.set(`${config.queue.queueName}:QP:${UUID}`, queuePosition, { px: config.queue.cookieExpiry*1000, nx:true });
    
    return queuePosition;
}

// Validate a UUID position in the queue
export async function checkQueuePosition(store, config, UUID) {
    config.rediscount++;
    return parseInt(await store.get(`${config.queue.queueName}:QP:${UUID}`));
}

// Increment the request counter for the current period.
//
// Returns the new counter value.
export async function incrementAutoPeriod(store, config) {
    // let period_timestamp = Math.ceil(new Date().getTime() / (config.queue.automatic * 1000));

    // Increment the auto-authorize count. This has a TTL set, so that the record will
    // expire at the confugured period time, and the 1st subsequest request will trigger
    // the queue allow logic in the main function while also creating the new period record.
    let new_period = await store.incr(`${config.queue.queueName}:auto`);
    config.rediscount++;
    if(new_period === 1) { // This is a new period key, set  the timeout in seconds
        await store.expire(`${config.queue.queueName}:auto`, config.queue.automatic);
        config.rediscount++;
    }
    return new_period;
}