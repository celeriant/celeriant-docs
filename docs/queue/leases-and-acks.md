---
title: Leases, acks, and delivery counts
---

# Leases, acks, and delivery counts

## The lease model

`Consume` returns one or more messages plus a single `lease_id`. That lease_id grants exclusive in-flight ownership of every returned version until one of:

- The consumer sends `Ack { lease_id, version }` — the version becomes terminal-Acked.
- The consumer sends `Nack { lease_id, version, delay_ms }` — the version returns to Available, optionally with a redelivery delay.
- The consumer sends `Extend { lease_id }` — the deadline pushes out by another `visibility_timeout_ms`.
- The deadline (`server_timestamp_at_lease + visibility_timeout_ms`) passes without any of the above.

When the deadline passes, no sweeper or background thread reaps. The next `plan_consume` call sees the lease is expired and re-folds the version back into the Available set. This is "expiry as a fold rule" — there is no in-memory timer to lose on failover.

## delivery_count is durable

Every version carries a `delivery_count` derived from the durable log:

```
delivery_count(v) = number of DISTINCT lease_ids that have ever covered v
```

- Fresh `Lease` event → +1.
- `Extend` reuses the same lease_id → no bump.
- `Nack` doesn't bump on its own; the next fresh Lease does.

This matters because failover-safe attempt counts are the difference between "park after 5 real failures" and "park after 5 reconnects." Kurrent's persistent subscriptions reset their retry counter on leader change ([source](https://github.com/kurrent-io/KurrentDB/issues/2748)); Redis and River strand poison messages entirely when they drop from the in-memory delivery list. Celeriant Queue counts from the log, so the count survives anything that survives a fsync.

When `delivery_count > max_delivery_attempts`, the next consume routes the message to DLQ per the queue's [dlq_strategy](/queue/dlq-and-poison).

## Visibility timeout choice

`visibility_timeout_ms` is per-queue. Set it long enough for the slowest legitimate processing, plus margin. Too short means leases expire mid-process and `delivery_count` ticks up on a healthy message. Too long means a crashed consumer's work waits N seconds before another consumer can pick it up.

The standard recipe: pick the p99 of your real processing latency, multiply by 3.

If you genuinely can't predict it, use `Extend` from inside the consumer when you're still alive but not done. Extend reuses the lease_id and doesn't bump `delivery_count`, so it's safe to call as a heartbeat.

## Ack batching

`AckRequest` carries `Vec<AckHandle>`. The handler batches the entire request into ONE durable `ControlEvent::AckBatch` write per request — N acks, one fsync. This is the inside-request amortisation.

There is currently no cross-request coalescing window (a small future optimisation that would fold acks from independent RPCs landing within a few ms into one event). Each `Ack` RPC still pays one fsync.

## Idempotency on the produce side

`Produce` requires `client_id` + `client_seq` per message. The storage layer enforces strict monotonicity: `client_seq` must be strictly greater than every prior `client_seq` for that `client_id`. A replay of an older `client_seq` (e.g., after a TCP reset where the client retried with the same value) returns `IdempotencyConflict` — never a silent duplicate write. The integration test `produce_idempotency_replays_same_versions_across_reconnect` is the canonical demonstration.

If you genuinely lost the in-flight response and don't know whether the write committed, query `Stats` to see the tail. The durable `messages_tail_version` tells you what's actually on disk.

## Ack-hole policy

A queue's `max_ack_holes` config caps the number of coalesced range gaps in the ack set. When the count exceeds the cap, `Consume` returns `AckHoleCapExceeded` — block-on-overflow. The cap is a back-pressure signal, not silent data loss. Drain the holes (ack the missing versions, or wait for their leases to expire and re-deliver) and `Consume` resumes.

This is the Pulsar-style policy. Redis/River and standard SQS-shaped queues happily accumulate holes until memory blows up.
