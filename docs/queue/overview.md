---
title: What Celeriant Queue is
---

# Celeriant Queue

A message queue bolted onto Celeriant's storage engine. Same thread-per-core glommio runtime, same WAL, same fsync-before-ack discipline as Celeriant itself. The queue layer adds consumer groups, head-of-line poison handling, sticky parallel routing, and an operator escape hatch for Block.

It is not a separate process. The queue listener runs as a `PerShardExtension` inside the Celeriant binary's executor pool — every shard core that owns aggregates also serves the queue verbs that touch them. Produce and the WAL fsync are zero network hops apart.

The wire protocol is native bincode over TCP. There is no HTTP, no JSON, no axum, no JWT — same as Celeriant.

## What you get

- **Durable produce / consume / ack / nack / extend.** Every verb returns only after the control event is fsync'd. A crash mid-call leaves the on-disk log consistent; idempotent retry stays clean.
- **Per-message attempt count derived from the log.** `delivery_count` is the number of distinct `lease_id`s that ever covered a version. Extend reuses a lease_id and does not bump the count; a fresh lease does. No in-memory counters to lose on failover.
- **DLQ as a queue.** The dead-letter destination is another queue, consumed the same way. The DLQ payload is durable BEFORE the Park control event commits — this is the [Kurrent #2748](https://github.com/kurrent-io/KurrentDB/issues/2748) fix that Kurrent never landed.
- **Three poison strategies, per queue:**
  - `Skip` — park to DLQ, continue.
  - `Block` — head-of-line block; trim pinned; operator sends Unblock to advance.
  - `BlockAndDlq` — both. Archive the payload AND stop the line.
- **First-class Unblock verb.** Operator escape hatch from a head-of-line Block. Distinct from Park ("this message is dead, route to DLQ") — Unblock means "this message is fine, resume the line."
- **Strict ordering when you need it.** `ordering_required = true` enforces single-active-consumer at the projection layer, even across racing Consume requests on separate connections.
- **Sticky parallel consumers.** `partition_key` → blake3 → u16 ring slot → assigned consumer. Reassignment uses a mandatory draining protocol so per-key ordering survives ownership transfer.
- **Per-tenant queue count quota** with synchronous TOCTOU-safe reservation.
- **Operator visibility.** Per-queue depth / in-flight / ack-hole-ranges / parked / blocked / tail gauges + throughput counters via the same `metrics-exporter-prometheus` endpoint Celeriant uses.

## What you don't get yet

- **Push subscriptions / webhooks.** Pull only.
- **Cluster-wide per-tenant quota deduplication.** The cap is per-shard; cluster effective cap is `cap × num_shards`.
- **SQS / AMQP compat shims.** Not started.
- **A native client crate.** The native wire is stable; the client crate is on the followup list. Until then, copy the integration-test RPC helper.

## When to reach for it

Celeriant gives you the durable event log. Most read-side work is a [projection](/concepts/event-sourcing) you build yourself — that pattern absorbs the work and the back-pressure naturally.

Reach for the queue when:

- You need fan-out work distribution with at-least-once delivery and observable failure (DLQ, retry counts, head-of-line containment).
- A specific message must be processed by exactly one consumer at a time with explicit ack semantics.
- You need partition-key sticky routing across a consumer group with safe rebalancing.

Don't reach for the queue when:

- You're streaming events for downstream consumers to project. Build a projection that reads the log directly — projections are first-class in event sourcing and don't need consumer groups.
- You need at-most-once delivery. The queue is at-least-once by design (durable retry on visibility timeout).
- You want server-side fan-out to N webhooks. That's the push followup; not shipped.

## Reading order

- **[Getting started](/queue/getting-started)** — local dev stack with Grafana, basic produce/consume.
- **[Leases and acks](/queue/leases-and-acks)** — visibility timeouts, delivery counts, ack semantics.
- **[DLQ and poison handling](/queue/dlq-and-poison)** — the three dlq_strategy modes, Park vs Block vs Unblock.
- **[Sticky routing and ordering](/queue/sticky-and-ordering)** — partition keys, range assignment, ordering_required.
- **[Operations](/queue/operations)** — quotas, metrics, what to alert on.
- **[Wire reference](/queue/wire-reference)** — verbs, error codes, native protocol.
