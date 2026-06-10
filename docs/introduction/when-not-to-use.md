---
title: When not to use Celeriant
---

# When not to use Celeriant

Celeriant is narrow on purpose. Adopting the wrong database is expensive, so here is when it is the wrong tool. If any of these is you, use something else and do not feel bad about it.

## You only need streaming

You might have two services; for example, an order service, and an SMS service. Events only go one way, and they are not causally coupled in any way. If nothing depends on shared state and you never need a conditional write, you need a log or a queue, not an event store.

## You need SQL and/or OLAP

Celeriant is the write side. Reads are per-aggregate, by offset and event type. It is row based. There is no SQL, no ad-hoc query, no secondary index you can query across aggregates. Use a RDBMS, DuckDB or a data lake, etc.

## You need transactional reads across aggregates

This one needs nuance, because "eventually consistent" oversells the problem. A read model is a separate store updated by projecting events, so a read is not the same transaction as the write. But it does not have to be stale. A common pattern is just-in-time catch-up: a read request first replays the target aggregate's new events into its projection, then serves the result. Per aggregate, that is effectively read-your-writes; the cost is a catch-up read on the request path.

What you do not get is a single transactional snapshot across many aggregates, the way a `SELECT ... JOIN` inside one transaction does on an RDBMS. If your reads genuinely need that cross-entity transactional consistency, an RDBMS is the simpler tool. Use one. See [Building a read model](/guides/building-a-projection) for the catch-up pattern.

## You need stability today

Celeriant is pre-1.0. The wire format can still change between releases, and there are no backward-compatibility guarantees yet. If you cannot ride breaking changes, run [EventStoreDB](https://www.eventstore.com/) or [Marten](https://martendb.io/) now and revisit Celeriant later.

