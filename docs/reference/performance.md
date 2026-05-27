---
title: Performance
---

# Performance

One number, with the method, so you can judge whether it is honest.

## The headline

**400,000 durable writes per second, p99 under 80 ms.**

That is not a page-cache number. Every write in that figure is fsync'd to disk on both nodes and replicated before it is acknowledged.

## Method

| | |
| --- | --- |
| Payload | one "Hello World" event per acknowledged write |
| Load | three load-generating clients, many writes in flight at once; a saturation number, not a single-threaded ping |
| Hardware | two AWS i4i.8xlarge data nodes: 32 vCPU, local NVMe |
| Network | ap-southeast-2, single availability zone |
| Security | mTLS on client connections and on cluster replication |
| Batching | the server amortises fsync and replication across concurrent writes; each client write is still acknowledged on its own |
| Write path | every write is fdatasync'd to disk on both nodes through Direct I/O, replicated to the follower, and acknowledged only after both succeed |
| Latency | the p99 is end-to-end, including replication and both fsyncs, at full offered load |

## Why it is this fast

It is not clever code; it is architectural alignment. An i4i.8xlarge is 32 cores of NVMe and io_uring, and many databases were designed before that hardware existed and leave it idle. Celeriant is built backward from it: Direct I/O, thread-per-core, batched fsync and replication, kernel TLS (kTLS) offload. See [Durability and safety](/concepts/durability-and-safety) for the mechanism.

## Reproduce it

The benchmark is meant to be re-run, not taken on faith. For a few dollars an hour of EC2 you can stand up the same two nodes and a load generator and check the number yourself.

:::info Pre-release
These figures are from the current pre-1.0 build on the configuration above. This is a small-payload, write-rate-bound test; large payloads become bandwidth-bound. Your workload, payload size, and hardware will move the number; the method is what lets you predict which way.
:::
