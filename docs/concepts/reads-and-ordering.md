---
title: Reads and ordering
---

# Reads and ordering

You read an aggregate's events in order, from an offset, optionally filtered. That is the whole read model on the write side: there is no query language, because Celeriant is not the read database. See [when not to use it](/introduction/when-not-to-use).

## Read one aggregate, in order

A read targets one aggregate and returns its events in strict order from the offset you ask for. The order is gap-free and stable: event 5 is always event 5, and it always sits between 4 and 6. That guarantee is what lets a projection fold the stream deterministically.

## Filters

A read can narrow what comes back:

- **by offset**: from a starting batch index, optionally up to an ending one.
- **by event type**: include only certain types, so a projection that cares about three of twenty event types does not pay for the rest.
- **by writer**: include or exclude a given client's events.
- **by time**: a server- or event-timestamp range.

## Pagination

Large aggregates page. A read returns a cursor (the next batch index); pass it back to continue. You stream a million-event aggregate in bounded memory instead of loading it whole.

A read pages when the response would exceed the negotiated maximum response size (`--max-response-size`), not at a fixed batch count. (`--list-page-size` bounds the *list* APIs, not single-aggregate reads.) Always follow the cursor until it is absent rather than assuming a page size.

## Catching up and following

A projection reads from its last processed offset to catch up, then [watches](/concepts/watch) for new events and follows the live tail. Combined, that is how a read model stays current; see [Building a read model](/guides/building-a-projection).

Reads can be routed to a follower to take load off the leader. A follower can sit a beat behind, so a follower read may return a slightly stale version. That is fine for projections and queries, and wrong for deciding an [optimistic-concurrency](/concepts/optimistic-concurrency) write, where the version you guard against must come from the leader. See [Reading and replaying a stream](/guides/reading-and-replaying).
