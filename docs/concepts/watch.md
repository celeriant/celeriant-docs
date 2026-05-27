---
title: Watch and subscribe
---

# Watch and subscribe

A watch tells you when aggregates change, as it happens. It is the read side's lifeline: how a projection follows the log in real time instead of polling.

## What a watch delivers

A watch delivers change notifications, not event payloads. Each notification says what changed: which aggregate, which operation (a write, a delete, a trim, a create), and the range of batch indexes affected. You then [read](/concepts/reads-and-ordering) the new events for that aggregate.

That split is deliberate. The notification stream stays small and cheap to fan out to many subscribers; the actual event data is fetched only by the subscribers that care, and through the same ordered read path as everything else.

## Scope and latency

You scope a watch to what you care about: a single aggregate, an aggregate type, or a whole org. You also set a latency tolerance; a higher tolerance lets the server coalesce bursts of changes into fewer notifications, trading immediacy for less chatter. Coalescing merges notifications, it does not drop changes: the batch-index range always spans everything written since you last read, so re-reading by range never misses an event.

A watch that spans more than one shard fans out under the hood; the client library opens a connection per shard and merges the results, so you see one stream.

## Catch up, then follow

A watch covers the live tail, not the past. The standard pattern for a projection: read from your last processed offset to catch up on what you missed, then start the watch and follow new changes. Done in the right order there is no gap and no double-processing. See [Subscribing to live events](/guides/subscribing) and [Building a read model](/guides/building-a-projection).
