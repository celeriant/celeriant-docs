---
title: Performance
---

# Performance

The full shape of one run. Not a single hero number: connections, throughput, the whole latency spread.

## The headline

| | |
| --- | --- |
| Connections | **36,000** |
| Durable writes / sec | **325,000** |
| p50 | 94 ms |
| p95 | 111 ms |
| p99 | 201 ms |

Every latency is end-to-end, including replication and both fsyncs, over mTLS on the client and replication paths. That is encrypted, durable, replicated throughput, not a page-cache number you cannot trust.

## Method

| | |
| --- | --- |
| Concurrency | 36,000 durable writes in flight at once, across four load-generating clients. A saturation number well past Postgres's connection wall, not a single-threaded ping. |
| Payload | one "Hello World" event per acknowledged write |
| Hardware | two AWS i4i.16xlarge data nodes: 64 vCPU, four local NVMe drives striped RAID0 |
| Network | ap-southeast-2, single availability zone |
| Security | mTLS on client connections and on cluster replication |
| Batching | the server amortises fsync and replication across concurrent writes; each client write is still acknowledged on its own |
| Write path | every write is fdatasync'd to disk on both nodes through Direct I/O, replicated to the follower, and acknowledged only after both succeed |

## Cost

The two i4i.16xlarge data nodes run **$13.16 an hour on-demand** in ap-southeast-2, about **$9,600 a month**, before reserved or spot discounts.

It scales down hard. Two i4i.large cost about **$300 a month** and still hold **30,000 durable writes a second at p99 158 ms**. Same architecture, same write path, smaller box.

## Why it is this fast

It is not clever code; it is architectural alignment. An i4i.16xlarge is 64 cores of NVMe and io_uring, and many databases were designed before that hardware existed and leave it idle. Celeriant is built backward from it: Direct I/O, thread-per-core, batched fsync and replication, kernel TLS (kTLS) offload. See [Durability and safety](/concepts/durability-and-safety) for the mechanism.

## Reproduce it

The benchmark is meant to be re-run, not taken on faith. One sweep on AWS, reproducible for a few dollars: stand up the two nodes and a load generator and check the number yourself. Tested in a single availability zone; expect worse numbers for cross-AZ.

:::info Pre-release
These figures are from the current pre-1.0 build on the configuration above. This is a small-payload, write-rate-bound test; large payloads become bandwidth-bound. Your workload, payload size, and hardware will move the number; the method is what lets you predict which way.
:::
