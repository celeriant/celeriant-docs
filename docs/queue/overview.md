---
title: What Celeriant Queue is
---

# Celeriant Queue

A message queue bolted onto Celeriant's storage engine. Same thread-per-core glommio runtime, same WAL, same fsync-before-ack discipline. The queue layer adds consumer groups, head-of-line poison handling, sticky parallel routing, and a first-class Unblock verb.

Not a separate process. The queue listener runs as a `PerShardExtension` inside the Celeriant binary's executor pool. Every core that owns aggregates also serves the queue verbs that touch them. Produce and the WAL fsync are zero network hops apart.

Wire protocol is native bincode over TCP. No HTTP. No JSON. No JWT.

## The problem

Every queue you've used picks one tradeoff. Throughput or correctness. Cheap retries or durable retries. Skip the poison or block the line. The picks compound.

Kafka picks throughput. ~24k req/s per-operation on real hardware, no fsync. Re-partitioning permanently breaks ordering. The DLQ pattern halts the entire aggregate stream because skipping a poisoned event breaks the causal chain. Axon [says this directly](https://docs.axoniq.io/axon-framework-reference/4.11/events/event-processors/dead-letter-queue/).

Kurrent picks ordering. Persistent subscriptions are leader-only, single-threaded, locked, capped around 40k/sec on hardware where Celeriant does 400k+. The retry count lives in memory and resets on failover. A message retried 9 times gets 10 fresh attempts after a leader change. Park is fire-and-forget. On persistent write failure Kurrent logs "Possible message loss" and drops the message. Not delivered, not parked, not retried. Issue [#2748 has been open since 2020](https://github.com/kurrent-io/KurrentDB/issues/2748).

Redis and River pick simplicity. Visibility-timeout redelivery is a sweeper job that strands messages mid-failover. Once a poison message drops from the in-memory delivery list, no attempt count survives. It can be redelivered forever.

Celeriant Queue picks all of them. The architecture is the unlock: every queue verb is a control event on Celeriant's WAL. Durable produce, durable ack, durable lease. `delivery_count` is derived from the log, not from RAM. Park is preceded by a durable DLQ write, not followed by one. Block stops the line and the projection keeps the version addressable for as long as the operator needs to look at it.

## What you get

- **Durable produce / consume / ack / nack / extend.** Every verb returns only after the control event is fsync'd. Crash mid-call, retry, stays clean.
- **Attempt count from the log.** `delivery_count` is the number of distinct `lease_id`s that ever covered a version. Extend reuses the lease_id and does not bump. Fresh leases do. The count survives anything a fsync survives.
- **DLQ as a queue.** The DLQ is just another queue. Consume it the same way. Payload is durable before the Park control event commits. This is the [Kurrent #2748](https://github.com/kurrent-io/KurrentDB/issues/2748) fix that Kurrent never landed.
- **Three poison strategies, per queue:**
  - `Skip`. Park to DLQ, continue. SQS-shaped.
  - `Block`. Head-of-line block, trim pinned, operator sends Unblock to advance.
  - `BlockAndDlq`. Both. Archive AND stop the line.
- **First-class Unblock verb.** Distinct from Park. Park means "this message is dead, route to DLQ." Unblock means "this message is fine, resume the line."
- **`ordering_required` when you need it.** Single-active-consumer at the projection layer. Enforced even across racing Consume requests on separate connections.
- **Sticky parallel consumers.** `partition_key` blake3-hashed into a u16 ring, ranges assigned to consumers. Reassignment uses a mandatory drain protocol so per-key ordering survives ownership transfer.
- **Per-tenant queue count quota.** Synchronous TOCTOU-safe reservation.
- **Operator visibility.** Per-queue depth, in-flight, ack-hole ranges, parked, blocked, tail. Plus throughput counters. All via the same Prometheus endpoint Celeriant uses.

## What you don't get yet

Pull only. No webhooks, no push subscriptions. No native client crate (the wire is stable; copy the integration-test RPC helper). No SQS or AMQP compat. The per-tenant quota is per-shard, not cluster-wide, so the cluster effective cap is `cap × num_shards`. All tracked in followup docs.

## When to reach for it

Celeriant gives you the durable event log. Most read-side work is a [projection](/concepts/event-sourcing) you build yourself. Projections absorb back-pressure naturally and avoid a whole class of coordination.

Reach for the queue when:

1. You need fan-out work distribution with at-least-once delivery and observable failure (DLQ, retry counts, head-of-line containment).
2. A specific message must be processed by exactly one consumer at a time with explicit ack semantics.
3. You need partition-key sticky routing across a consumer group with safe rebalancing.

Don't reach for the queue when:

1. You're streaming events for downstream consumers to project. Build a projection. Projections are first-class in event sourcing and don't need consumer groups.
2. You need at-most-once delivery. The queue is at-least-once by design.
3. You want server-side push to N webhooks. Followup, not shipped.

## Reading order

- [Getting started](/queue/getting-started). Local dev stack with Grafana, basic produce/consume.
- [Leases and acks](/queue/leases-and-acks). Visibility timeouts, delivery counts, ack semantics.
- [DLQ and poison handling](/queue/dlq-and-poison). The three dlq_strategy modes. Park vs Block vs Unblock.
- [Sticky routing and ordering](/queue/sticky-and-ordering). Partition keys, range assignment, ordering_required.
- [Operations](/queue/operations). Quotas, metrics, what to alert on.
- [Wire reference](/queue/wire-reference). Verbs, error codes, native protocol.
