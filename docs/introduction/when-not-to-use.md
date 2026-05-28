---
title: When not to use Celeriant
---

# When not to use Celeriant

Celeriant is narrow on purpose. Adopting the wrong database is expensive, so here is when it is the wrong tool. If any of these is you, use something else and do not feel bad about it.

## You have one writer per aggregate

If each aggregate has exactly one writer (one device, one user session, one isolated worker), there is no contention to arbitrate, and OCC — the bulk of what this database provides — is dead weight. A log or queue with an outbox suffices.

Be honest about whether you actually have this. "One service writes to orders" is not the same as "one writer per aggregate" — if that service runs N replicas, or restarts mid-batch, you have concurrent writers on the same aggregate and you need OCC. The single-writer case is real for per-device or per-user streams, edge clients, and isolated worker queues. It is rare for backend services that own a shared entity.

## You need a query database

Celeriant is the write side. Reads are per-aggregate, by offset and event type. There is no SQL, no ad-hoc query, no secondary index you can query across aggregates. Project the log into Postgres or your read store of choice and query there. See [Building a read model](/guides/building-a-projection).

## You need transactional reads across aggregates

This one needs nuance, because "eventually consistent" oversells the problem. A read model is a separate store updated by projecting events, so a read is not the same transaction as the write. But it does not have to be stale. A common pattern is just-in-time catch-up: a read request first replays the target aggregate's new events into its projection, then serves the result. Per aggregate, that is effectively read-your-writes; the cost is a catch-up read on the request path.

What you do not get is a single transactional snapshot across many aggregates, the way a `SELECT ... JOIN` inside one transaction does on an RDBMS. If your reads genuinely need that cross-entity transactional consistency, an RDBMS is the simpler tool. Use one. See [Building a read model](/guides/building-a-projection) for the catch-up pattern.

## You only need streaming

If nothing depends on shared state and you never need a conditional write, you need a log or a queue, not an event store. Kafka, NATS, or Redis Streams are the right tools. Keep using them.

## You need stability today

Celeriant is pre-1.0. The wire format can still change between releases, and there are no backward-compatibility guarantees yet. If you cannot ride breaking changes, run [EventStoreDB](https://www.eventstore.com/) or [Marten](https://martendb.io/) now and revisit Celeriant later.

---

Still here? Good. Start with the [Quickstart](/get-started/quickstart).
