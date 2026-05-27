---
title: Coming from Kafka
---

# Coming from Kafka

You are probably not event sourcing yet, even if you have a lot of events flying around. The common shape: each service owns a Postgres database, writes its state there with ordinary CRUD, and to tell other services what happened it writes a row to an outbox table in the same transaction. Debezium tails the WAL and publishes those rows to Kafka; other services consume and update their own state tables. Events exist, but they are a side effect of state changes, not the source of truth.

## The dual-write problem

The outbox is there to paper over one flaw: you cannot atomically update your state and publish an event to two different systems. The outbox makes the event part of the local transaction, and CDC makes the publish eventually happen. It works, and it is a pile of infrastructure (outbox tables, Debezium, Kafka Connect, a dead-letter queue) whose entire job is to keep your state and your events from drifting apart.

## Celeriant flips the order

The event is the write. You append the event to Celeriant as the source of truth, with a [conditional write](/concepts/optimistic-concurrency) that enforces your invariant, and you project state from the log afterward, into the same Postgres you already run. There is no second write to keep in sync, so there is no outbox, no CDC, and no DLQ. The dual-write problem does not exist when there is only one write.

## What maps to what

| Kafka + outbox + CDC | Celeriant |
| --- | --- |
| State table as the source of truth | The [event log](/concepts/event-sourcing) is the source of truth; state is a projection |
| Outbox table + Debezium | A single conditional [event write](/concepts/optimistic-concurrency) |
| Dual write, reconciled by the outbox | One write; nothing to reconcile |
| Topic for inter-service events | A consumer's [watch](/concepts/watch) and read model, or keep Kafka for fan-out |
| Confluent Schema Registry (open source); broker-side enforcement is a paid feature | [Schema validation](/concepts/schemas) enforced on the server, included |
| Dead-letter queue for poison messages | Malformed events rejected at write time by schema validation; they never enter the log |

## This is a real model shift

Bigger than it looks. You stop thinking state-first and start thinking events-first: the event is what happened, and state is a view you rebuild from events. If your team has not event-sourced before, read [Event sourcing and CQRS](/concepts/event-sourcing) first. This is a genuine shift in how you model your domain, not a library swap. It is also worth knowing there are [two ways to use Celeriant](/introduction/usage-patterns) before you pick one.

## What stays on Kafka

Streaming and fan-out where nothing depends on shared state and you never need a conditional write. Celeriant is the write-side source of truth; Kafka still moves high-volume streams between systems well. Use both. See [When not to use Celeriant](/introduction/when-not-to-use).
