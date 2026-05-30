---
title: DLQ and poison handling
---

# DLQ and poison handling

Every queue is created with a mandatory `dlq_key` — another queue, in the same org. The DLQ is a first-class queue: consume it the same way you consume any other queue. There is no special "DLQ consumer" API.

## The three strategies

`dlq_strategy` is per-queue config. When a version's `delivery_count` exceeds `max_delivery_attempts`:

### `Skip` (default — SQS-shaped)

The handler:
1. Appends the payload to the DLQ aggregate (durable).
2. Then emits a `Park` control event on the source queue (durable).

The source queue advances past the parked version. Trim eventually drops it from the messages aggregate. Consumers of the DLQ see the payload as a normal message.

This is the "fire and forget the bad message" policy. It mirrors SQS DLQ semantics.

### `Block`

The handler emits a `Block` control event on the source queue. No DLQ write.

The Block fold:
- Releases the live lease (frees the in-flight slot).
- Inserts the version into `blocked_versions`.
- Pins `trim_cursor` at or before the lowest blocked version — the line stops.

The source queue can keep accepting later messages (Block is per-version, not per-queue), but plan_consume treats blocked versions as Skip. From an operator's perspective: trim doesn't advance, the blocked panel in Grafana turns red, the queue waits for human intervention.

To resume: send `Unblock { version }`. The fold removes the version from `blocked_versions`. The version returns to the normal lifecycle — re-leasable, eligible for trim once acked or parked.

### `BlockAndDlq`

Both. The handler writes the DLQ payload first (durable), then the Block control event (durable). The source queue blocks AND a copy is archived in the DLQ for later inspection.

This is the safest choice when you don't yet know whether you'll want to replay the message or skip past it: you have both the durable copy in the DLQ and the head-of-line stop on the source.

## The Kurrent #2748 fix

In Kurrent / EventStoreDB, persistent subscriptions Park with fire-and-forget ordering: the Park event is emitted, the DLQ write happens async, and on persistent write failure Kurrent [logs "Possible message loss" and drops the message](https://github.com/kurrent-io/KurrentDB/issues/2748). Neither delivered, parked, nor retried.

Celeriant Queue reverses the order. The DLQ payload is appended via `append_dlq_payload().await` first; only after that future resolves Ok does the Park control event commit. A crash in between leaves the DLQ payload orphaned but readable, and on restart the projection sees no Park event — the source queue re-runs the trigger conditions and re-parks. You get a duplicate in the DLQ, never a loss.

The same ordering applies to `BlockAndDlq`.

## Unblock vs Park as escape hatches

Both clear `blocked_versions`. The difference is intent:

- **Park** says "this message is dead, route to DLQ." The fold transitions the version to Parked. Trim will eventually drop it from the source.
- **Unblock** says "this message is fine, resume the line." The fold removes the version from `blocked_versions` but leaves it Available. The next consumer will lease it (with `delivery_count` incremented from the prior failed attempts).

For a poisoned message you've manually validated and want to retry, use Unblock. For one you've decided to abandon, inject a Park event (today via a manually-constructed control event; first-class admin "force park" verb is a followup).

## DLQ replay

The DLQ is a queue. Replay = consume from the DLQ, do whatever the original consumer would have done. If you want to re-feed the source queue, produce the payload back to it. There is no first-class "replay DLQ to source" verb — the explicit consume + produce pattern is what celeriant-db's event-sourcing model encourages anyway.
