---
title: Event sourcing and CQRS
---

# Event sourcing and CQRS

The model Celeriant assumes: the source of truth is an append-only log of events, and every queryable view of your data is a projection built from that log. State is derived, not stored. This page is the worldview the rest of the docs lean on; it is not an event-sourcing tutorial.

## Celeriant is the write side

CQRS splits the write side from the read side. Celeriant is the write side: it stores the events and enforces the invariants that govern them. It does not answer queries. You project the log into a read store (Postgres, a search index, a cache) and query that. See [Building a read model](/guides/building-a-projection) and the [two usage patterns](/introduction/usage-patterns).

This is the line where Celeriant stops being a drop-in for your SQL database. If your system does not already separate reads from writes, that separation is the real cost of adopting it, not the API. See [when not to use it](/introduction/when-not-to-use).

## Why a store built only for this

Event sourcing needs one operation that general-purpose databases and brokers do badly: the conditional append. Commit this event only if the aggregate has not moved since I read it. Postgres can do it and stalls under the load; Kafka cannot do it at all. Celeriant makes it a first-class, fast operation. See [Optimistic concurrency](/concepts/optimistic-concurrency).

That single operation is what lets you enforce a business invariant at write time instead of reconstructing it later with sagas, outboxes, and reconciliation jobs.

## The shift from state-first

If you are arriving from a CRUD system where events are published as a side effect of state changes, the mental move is to treat the event as the write and state as a view you rebuild. That is a genuine change in how you model, and it is worth doing deliberately. See [Coming from Kafka](/introduction/coming-from-kafka).

New to event sourcing? Martin Fowler's notes on [event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) and [CQRS](https://martinfowler.com/bliki/CQRS.html) are the standard primer.
