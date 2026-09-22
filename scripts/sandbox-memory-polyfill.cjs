// The ChatGPT Work sandbox does not expose the OS memory counters expected by
// libuv. Production containers do expose them; this shim is only used by the
// local verification command documented in README.md.
const memoryUsage = () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 });
memoryUsage.rss = () => 0;
process.memoryUsage = memoryUsage;
