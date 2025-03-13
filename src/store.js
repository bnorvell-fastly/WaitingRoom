import { Redis } from "@upstash/redis/fastly";
import { DEBUG } from "./index.js";

1//import Redis from "redis"; // - This does not work due to node.js dependencies that Fastly does not support

// Redis key schema :
//
// General notes - every key except the cursor and length have TTL's set via queue/global configurations.
// Atomic operations are used wherever possible, so that this can maintain global state in high load conditions.
// The rediscount variable in the config object is incremented for all operations, to allow for estimating billing costs
//
// <queueName>:cursor
//  Current cursor into the queue. This is the current position of visitors let in. Atomic increment when we let users in
//  either automatically (via timer), or manually
// <queueName>:length
//  Overall length of the queue. Atomic increment when a new user is added
// <queueName>:auto
//  # of users who have arrive during this <interval> of time. TTL of queueRefreshInterval, so it will be reissued
//  each interval. This is used for the timer to allow users through the queue
// <queueName>:QP:<uuid>
//  queue position of each user in the queue. TTL set so that keys expire if not used regularly, this is to prevent bots from getting
//  (and keeping) a place in line, if they aren't storing or allowing re-writes to cookies.
//

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
    if(DEBUG) timer=performance.now();
    let res = parseInt((await store.get(`${config.queue.queueName}:cursor`)) || 0);
    if(DEBUG) config.redistimer += performance.now()-timer;
    return res;
}

// Increment the current queue cursor, letting in `amt` visitors.
// Returns the new cursor value.
export async function incrementQueueCursor(store, config, amt) {
    // Setting an automatic value of 0 disables automatic queue entry. No need to call redis
    // for that.    
    if(amt === 0) return 0;

    config.rediscount++;
    if(DEBUG) timer=performance.now();
    let res = await store.incrby(`${config.queue.queueName}:cursor`, amt);
    if(DEBUG) config.redistimer += performance.now()-timer;
    return res;
}

// Get the current length of the queue. This may not match the number of users waiting
// Since we may have abandoned tokens
export async function getQueueLength(store, config) {
    config.rediscount++;
    if(DEBUG) timer = performance.now();
    let res = parseInt(await store.get(`${config.queue.queueName}:length`));
    if(DEBUG) config.redistimer += performance.now()-timer;
    return res;
}

// Update the TTL on a visitor record. This allows for a low cookie timer to be set, allowing genuine
// users to keep thier place in line, while purging positions assigned to bots, or other processes that
// are not storing the cookie issued to them.
export async function updateVisitorTTL(store, config, UUID) {
    config.rediscount++;
    if(DEBUG) timer = performance.now();
    let res = await store.pexpire(`${config.queue.queueName}:QP:${UUID}`, config.queue.cookieExpiry*1000);
    if(DEBUG) config.redistimer += performance.now()-timer;
    return res;
}

// Add a visitor to the queue.
// Returns the new queue length.
export async function incrementQueueLength(store, config, UUID) {
    config.rediscount+= 2;
    if(DEBUG) timer = performance.now();
    let queuePosition = await store.incr(`${config.queue.queueName}:length`);
    
    // Insert a UUID record with this position, reserving it for that user. This allows us
    // to validate a queue position if necessary. Only set this key if it does not already exist.
    // Reservations persist as long as the cookie lives, set the TTL in milliseconds, accordingly.
    await store.set(`${config.queue.queueName}:QP:${UUID}`, queuePosition, { px: config.queue.cookieExpiry*1000, nx:true });

    if(DEBUG) config.redistimer += performance.now()-timer;
    return queuePosition;
}

// Validate a UUID position in the queue
export async function checkQueuePosition(store, config, UUID) {
    config.rediscount++;
    if(DEBUG) timer = performance.now();
    let res = parseInt(await store.get(`${config.queue.queueName}:QP:${UUID}`));
    if(DEBUG) config.redistimer += performance.now()-timer;
    return res;
}

// Increment the request counter for the current period.
//
// Returns the new counter value.
export async function incrementAutoPeriod(store, config) {
    // let period_timestamp = Math.ceil(new Date().getTime() / (config.queue.automatic * 1000));

    // Increment the auto-authorize count. This has a TTL set, so that the record will
    // expire at the configured period time, and the 1st subsequest request will trigger
    // the queue allow logic in the main function while also creating the new period record.
    if(DEBUG) timer = performance.now();
    let new_period = await store.incr(`${config.queue.queueName}:auto`);
    config.rediscount++;

    if(new_period === 1) { // This is a new period key, set  the timeout in seconds
        await store.expire(`${config.queue.queueName}:auto`, config.queue.automatic);
        config.rediscount++;
    }
    if(DEBUG) config.redistimer += performance.now()-timer;

    return new_period;
}