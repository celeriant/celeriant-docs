---
title: Performance
---

# Performance

The full shape of one run. Not a single hero number: connections, throughput, the whole latency spread.

## The headline

| | |
| --- | --- |
| Connections | **60,000** |
| Durable writes / sec | **1,057,417** |
| p50 | 48 ms |
| p95 | 72 ms |
| p99 | 108 ms |

Every latency is end-to-end, including replication and both fsyncs, over mTLS on the client and replication paths. That is encrypted, durable, replicated throughput, not a page-cache number you cannot trust.

60,000 connections is the knee, and it is the peak of the curve rather than a point the tail forced a stop at:

| connections | writes/s | p50 | p95 | p99 | run-to-run spread |
| --- | --- | --- | --- | --- | --- |
| 32,000 | 813,019 | 36 ms | 43 ms | 60 ms | 1.2% |
| **60,000** | **1,057,417** | **48 ms** | **72 ms** | **108 ms** | **0.8%** |
| 100,000 | 1,018,950 | 77 ms | 146 ms | 220 ms | 5.3% |
| 132,000 | 916,122 | 112 ms | 206 ms | 432 ms | 10.1% |

Past 60,000 the box sits at 94-95% CPU, throughput falls, and the spread widens to 5-10%. Those points are neither faster nor trustworthy.

## Pick a tier

Peak clean throughput, meaning the highest level that ran with zero client-visible errors.

| tier | cluster | storage | durable writes/s | at connections | p50 | p99 | cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Flagship** | 2x i4i.metal (128 vCPU) | 8x NVMe RAID0 | **1,057,417** | 60,000 | 48 ms | 108 ms | ~$3,700/mo spot |
| Large | 2x i4i.16xlarge (64 vCPU) | 4x NVMe RAID0 | 466,640 | 60,000 | 97 ms | 264 ms | ~$9,600/mo |
| Mid | 2x i4i.8xlarge (32 vCPU) | 2x NVMe RAID0 | 446,667 | 24,000 | 44 ms | 109 ms | ~$4,800/mo |
| **Entry** | 2x c7g.xlarge (4 vCPU ARM) | stock gp3 | **67,720** | 8,000 | 113 ms | 165 ms | **~$295/mo** |

The 32-core box gets 96% of the 64-core box's throughput for half the money. Doubling vCPUs from 32 to 64 buys 4%; going to 64 physical cores on i4i.metal buys 2.3x on top of that. Cores that share an SMT sibling are not cores.

Every tier has a ceiling and does not degrade gracefully past it. The ARM pair runs clean to 8,000 connections and sheds tens of thousands of errors at 16,000. Know your tier's number and stay under it.

## Method

| | |
| --- | --- |
| Concurrency | 60,000 durable writes in flight at once, across four load-generating clients. A saturation number well past Postgres's connection wall, not a single-threaded ping. |
| Payload | one "Hello World" event per acknowledged write |
| Hardware | two AWS i4i.metal data nodes: 64 physical cores each, eight local NVMe drives striped RAID0 |
| Network | ap-southeast-2, single availability zone |
| Security | mTLS on client connections and on cluster replication |
| Batching | the server amortises fsync and replication across concurrent writes; each client write is still acknowledged on its own |
| Write path | every write is fdatasync'd to disk on both nodes through Direct I/O, replicated to the follower, and acknowledged only after both succeed |
| Load generator | one connection and one aggregate pinned per writer task for the whole run, so no write crosses to a shard its connection is not on |
| Tuning | 128 shards, fsync window 1,000 us, replication window 15,000 us. Measured values that ship pinned to the `i4i-metal` deploy profile, not generic defaults |

## Cost

The metal pair ran on spot at **$5.08 an hour**, about **$3,700 a month**. On demand it is $26.33 an hour, about **$19,200 a month**.

It scales down hard, and the small boxes win on value. Two c7g.xlarge on stock EBS cost about **$295 a month** and hold **67,720 durable writes a second at p99 165 ms**. That is 230 writes/s per dollar per month, 4.7x better than the 64-vCPU cluster. Same architecture, same write path, smaller box.

## Why it is this fast

An i4i.metal is 64 physical cores of NVMe and io_uring, and many databases were designed before that hardware existed and leave it idle. Celeriant is built backward from it: Direct I/O, thread-per-core, batched fsync and replication, kernel TLS (kTLS) offload. See [Durability and safety](/concepts/durability-and-safety) for the mechanism.

Storage is the decision that matters more than the instance size. Local NVMe holds throughput flat under load; the same box on gp3 peaks early and then declines, ending 63% behind at high concurrency, with a p99 already 2x worse where its throughput is still competitive.

## Reproduce it

The benchmark is meant to be re-run, not taken on faith. Throughput is the minimum across three repetitions and latency the maximum, cells run forward then backward so drift cancels: at the headline point the spread across runs is 0.8%. Stand up the two nodes and the load generators and check the number yourself. Tested in a single availability zone; expect worse numbers for cross-AZ.

:::info Pre-release
These figures are from the current pre-1.0 build on the configuration above. This is a small-payload, write-rate-bound test; large payloads become bandwidth-bound. Your workload, payload size, and hardware will move the number; the method is what lets you predict which way.
:::
