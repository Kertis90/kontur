import IORedis from "ioredis";
import { Queue } from "bullmq";

let redis;
let eventsQueue;
let aiQueue;

export function getRedis() {
  if (!redis) redis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true });
  return redis;
}

export function getEventsQueue() {
  if (!eventsQueue) eventsQueue = new Queue("kontur-events", { connection: getRedis(), defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 1500 }, removeOnComplete: { age: 86400, count: 5000 }, removeOnFail: { age: 604800, count: 10000 } } });
  return eventsQueue;
}

export async function enqueue(name, data, options = {}) {
  return getEventsQueue().add(name, data, options);
}

export function getAiQueue() {
  if (!aiQueue) aiQueue = new Queue("kontur-ai", { connection: getRedis(), defaultJobOptions: { attempts: 1, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: true } });
  return aiQueue;
}
