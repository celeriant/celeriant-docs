---
title: Watch and subscribe
---

# Watch and subscribe

A watch tells you when aggregates change, as it happens. It is the read side's lifeline: how a projection follows the log in real time instead of polling.

## What a watch delivers

A watch delivers change notifications, not event payloads. Each notification says what changed: which aggregate, which operation (a write, a delete, a trim, a create), and the range of batch indexes affected. You then [read](/concepts/reads-and-ordering) the new events for that aggregate.

That split is deliberate. The notification stream stays small and cheap to fan out to many subscribers; the actual event data is fetched only by the subscribers that care, and through the same ordered read path as everything else.

:::note Create notifications and the version range
The very first write to a new aggregate emits **two** notifications: a `create` operation event (which has no batch-index range) and a `write` operation event carrying the range (`ToAggregateVersion = 1`). The `create` is a distinct "aggregate came into existence" signal; the accompanying `write` is what carries the version range. Advance your cursor on `ToAggregateVersion` from the `write` event - do not assume the `create` event itself carries a range.
:::

## Scope and latency

You scope a watch by `Orgs`, `AggregateTypes`, or `Aggregates`. The scope is not free: it has to match the cluster's [routing rule](/concepts/aggregates), because a watch runs on a shard and the shard owns the aggregates that mod to it. If routing is by `org_id`, your watch must name at least one org; if by `aggregate_type_id`, an aggregate type; if by `aggregate_id`, the specific aggregates. Mismatch a filter to the rule and you get error 9002 (`IncompatibleFilters`). This is enforced, not advised. Note that the Tokio client's `WatchConnection` helper *recovers* from this by automatically opening one connection per shard, so a caller using the helper transparently gets a valid multi-shard watch rather than a 9002; the error is surfaced only on the raw protocol path.

`RequestedLatency` is a cap, not a deadline. The server coalesces bursts of changes inside that window into fewer notifications, trading immediacy for less chatter. Coalescing merges; it never drops. The notification's `ToAggregateVersion` only advances, so re-reading from your cursor never misses an event. Treat this as eventually consistent with a bounded lag: between a write committing and the notification firing, there is a real (sub-window) gap. If you need "the user sees the write the instant it happens" semantics, do not wait on a watch - read the aggregate inline.

A watch that spans more than one shard fans out under the hood; the client library opens a connection per shard and merges the results, so you see one stream. The server enforces a max latency via `--watch-max-requested-latency-ms`; exceed it and you get 8001 (`LatencyTooHigh`).

## Catch up, then follow

A watch covers the live tail, not the past. The standard pattern for a projection: read from your last processed offset to catch up on what you missed, then start the watch and follow new changes. Done in the right order there is no gap and no double-processing. See [Subscribing to live events](/guides/subscribing) and [Building a read model](/guides/building-a-projection).
