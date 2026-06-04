---
title: Reads and ordering
---

# Reads and ordering

You read an aggregate's events in order, from an offset, optionally filtered. That is the whole read model on the write side: there is no query language, because Celeriant is not the read database. See [when not to use it](/introduction/when-not-to-use).

## Read one aggregate, in order

A read targets one aggregate and returns its events in strict order from the offset you ask for. The order is gap-free and stable: event 5 is always event 5, and it always sits between 4 and 6. That guarantee is what lets a projection fold the stream deterministically.

## Order is the sequence, not the clock

The order is the server-assigned batch index: a monotonic sequence stamped when the write lands. Timestamps play no part in it. The event timestamp is client-supplied and untrusted, so a skewed or forged clock changes nothing about where an event sits; and even the server timestamp is metadata, not a tiebreaker. Two writes from machines with drifting clocks still have one unambiguous order: the order the server appended them.

That cuts both ways. An event stamped earlier in wall-clock time but written later sits later in the stream, and it wins any last-write-wins fold. Do not build a projection that resolves conflicts by "latest timestamp wins": a client with a fast clock would silently shadow everyone else's writes. Resolve by stream position. Timestamps are for filtering and for your domain; for ordering there is one narrow exception below.

### The offline exception

The rule above assumes every event has a stream position when you fold it. An offline-first client breaks that assumption: it applies its own events locally, before the server has assigned them a position, and peer events arrive with positions in the meantime. Two clients that were both offline can sync the same events and land on different states, because each folded its own pending events in a different effective order relative to its peer's.

If your projection must converge through that window, a client-timestamp last-write-wins tiebreak is the pragmatic fix: "the later real-world action wins" gives every client the same answer regardless of sync order. It is an application-layer decision in your fold, not a server behavior, and it carries two hard conditions:

- **Trust boundary.** Only among a closed group of trusted writers. On an open-write aggregate, never: anyone can stamp a far-future timestamp and permanently shadow every later event on that entity. One forged event grief-locks the entity for everyone.
- **Clamp it.** Cap incoming timestamps at your own clock plus a small skew tolerance (a few minutes) before comparing. The cap is one-sided: the future is bounded, the past is left alone. A client returning from weeks offline carries honestly old timestamps, and they should stand; those actions happened weeks ago and lose to anything done since, which is the answer you want. Do not floor old timestamps up to sync time, or a long-offline client's stale edits would shadow newer work. What the cap kills is the forged far-future value: the worst case becomes a brief shadow instead of a permanent lock.

If the trust boundary does not hold, do not reach for timestamps. Order by stream position and handle the optimistic window differently: keep your unsent local events to one side and re-apply them on top of incoming peer events until the server confirms their position. You may see a moment of divergence before sync settles; you will not see a grief-lock.

Either way the stream itself is untouched: a replay from the server returns events in batch-index order, always. The timestamp tiebreak lives in your projection.

## Filters

A read can narrow what comes back:

- **by offset**: from a starting batch index, optionally up to an ending one.
- **by event type**: include only certain types, so a projection that cares about three of twenty event types does not pay for the rest.
- **by writer**: include or exclude a given client's events.
- **by time**: a server or event timestamp range. The event timestamp is client-supplied, so a writer with a skewed clock can land events outside the range you expect; the server timestamp is the trustworthy one.

## Pagination

Large aggregates page. A read returns a cursor (the next batch index); pass it back to continue. You stream a million-event aggregate in bounded memory instead of loading it whole.

A read pages when the response would exceed the negotiated maximum response size (`--max-response-size`), not at a fixed batch count. (`--list-page-size` bounds the *list* APIs, not single-aggregate reads.) Always follow the cursor until it is absent rather than assuming a page size.

## Catching up and following

A projection reads from its last processed offset to catch up, then [watches](/concepts/watch) for new events and follows the live tail. Combined, that is how a read model stays current; see [Building a read model](/guides/building-a-projection).

Reads can be routed to a follower to take load off the leader. Followers see new event batches a few ms before
the leader, as the leader waits for durable ack before moving its own read visibility cursor. There is no 2PC (https://en.wikipedia.org/wiki/Two-phase_commit_protocol).

See [Reading and replaying a stream](/guides/reading-and-replaying) for more usage details.
