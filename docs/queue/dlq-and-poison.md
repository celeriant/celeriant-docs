---
title: DLQ and poison handling
---

# DLQ and poison handling

Every queue is created with a mandatory `dlq_key`. Another queue, same org. The DLQ is first-class. Consume it the same way you consume any other queue. There is no separate "DLQ consumer" API.

## The three strategies

`dlq_strategy` is per-queue config. When a version's `delivery_count` exceeds `max_delivery_attempts`:

### `Skip` (the default, SQS-shaped)

The handler does two writes:

1. Append the payload to the DLQ aggregate (durable).
2. Emit a `Park` control event on the source queue (durable).

Source advances past the parked version. Trim eventually drops it from the messages aggregate. DLQ consumers see the payload as a normal message.

"Fire and forget the bad message." Same shape as SQS DLQ semantics.

### `Block`

The handler emits a `Block` control event on the source queue. No DLQ write.

The Block fold:

- Releases the live lease (frees the in-flight slot).
- Inserts the version into `blocked_versions`.
- Pins `trim_cursor` at or before the lowest blocked version. The line stops.

The source can keep accepting later messages. Block is per-version, not per-queue. But plan_consume treats blocked versions as Skip. From an operator's perspective: trim doesn't advance, the blocked panel in Grafana turns red, the queue waits for human intervention.

To resume, send `Unblock { version }`. The fold removes the version from `blocked_versions`. Back to the normal lifecycle. Re-leasable, eligible for trim once acked or parked.

### `BlockAndDlq`

Both. Handler writes the DLQ payload first (durable), then the Block control event (durable). Source blocks AND a copy is archived in the DLQ.

This is the right default when you don't yet know whether you'll want to replay the message or skip past it. You have both the durable copy in the DLQ and the head-of-line stop on the source.

## The Kurrent #2748 fix

Kurrent / EventStoreDB Park is fire-and-forget. The Park event is emitted, the DLQ write happens async, and on persistent write failure Kurrent [logs "Possible message loss" and drops the message](https://github.com/kurrent-io/KurrentDB/issues/2748). Not delivered. Not parked. Not retried.

Celeriant Queue reverses the order. The DLQ payload is appended via `append_dlq_payload().await` first. Only after that future resolves Ok does the Park control event commit. A crash in between leaves the DLQ payload orphaned but readable. On restart the projection sees no Park event. Source queue re-runs the trigger conditions and re-parks. You get a duplicate in the DLQ. Never a loss.

Same ordering for `BlockAndDlq`.

## Unblock vs Park as escape hatches

Both clear `blocked_versions`. The difference is intent:

- **Park.** "This message is dead, route to DLQ." Fold transitions the version to Parked. Trim eventually drops it from the source.
- **Unblock.** "This message is fine, resume the line." Fold removes the version from `blocked_versions` but leaves it Available. Next consumer leases it, with `delivery_count` reflecting the prior failed attempts.

Poisoned message you've manually validated and want to retry? Unblock. One you've decided to abandon? Inject a Park. A first-class admin "force park" verb is a followup; today you construct the Park event manually.

## DLQ replay

The DLQ is a queue. Replay is just "consume from the DLQ, do whatever the original consumer would have done." If you want to re-feed the source queue, produce the payload back. There is no first-class "replay DLQ to source" verb. The explicit consume + produce pattern is what celeriant-db's event-sourcing model encourages anyway.
