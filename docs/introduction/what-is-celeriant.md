---
title: What is Celeriant
---

# What is Celeriant

Celeriant is an append-only event store dedicated to the write side of [CQRS](https://martinfowler.com/bliki/CQRS.html). It is the source of truth: services append events, and read models are projected from the log. It is not a query database, and it is not a message broker.

## The problem it solves

Event sourcing lives or dies on one question: can I append this event only if nobody changed the aggregate under me?

Postgres can answer it, with a row lock and a conditional insert. Then it falls over around 10k to 20k conditional writes a second: commit-fsync latency, lock contention on hot aggregates, and vacuum debt building underneath.

Kafka plays a different game. Each microservice has its own Postgres, operations update local state and write an event to a local outbox table, then a CDC pipeline picks them up and publishes them onto topics for other services to consume. Throughput solved. Inside one service the conditional write still works, because Postgres is doing it.

The gap is between services. A service has to validate the next event against state assembled from other services' topics, and those topics lag. Two services can clear validation against a stale view at the same time, both append, and one of them silently violates an invariant. Kafka has no way to say "append only if the aggregate is still at version N." The log is unconditional by design.

So you bolt on the saga, the DLQ, idempotency keys at every consumer. That's scaffolding around a missing primitive, and it fails in production, not in tests.

Celeriant closes that gap. A conditional write is a first-class operation. The minimum viable monolith. You still distribute your services independently, but writes always go to one place.

## What you get

- **Optimistic concurrency.** Append only if the aggregate is still at the version you read; conditional, and atomic across several aggregates in one write. See [Optimistic concurrency](/concepts/optimistic-concurrency).
- **Idempotent retries.** A client sequence number per writer makes retries safe, so a timeout never turns into a double-write. See [Idempotent retries](/concepts/idempotent-writes).
- **Strict per-aggregate ordering**, with explicit offsets and event-type filtering on reads. See [Reads and ordering](/concepts/reads-and-ordering).
- **Schema validation** on the server, for JSON Schema, Avro, or Protobuf. See [Schema validation](/concepts/schemas).
- **Durability** on a two-node cluster, every acknowledged write is fdatasync'd to disk on both nodes through Direct I/O before the ack returns. Fallback to S3 if one node is down to maintain the dual-node durability rule. See [Durability and safety](/concepts/durability-and-safety).
- **A live watch API**, so read models follow the log in real time. See [Watch and subscribe](/concepts/watch).
- **Memory bounded by hardware limitations, not total cardinality.** Millions of aggregates and billions of events on a 32 GB box, with the log on NVMe.

## Where it fits

Celeriant is the write side. You append events to it and project them into a read store (Postgres, a search index, a cache) that answers queries. If your system already separates writes from reads, Celeriant slots in where the write log belongs. If it does not, read [When not to use it](/introduction/when-not-to-use) first; CQRS is a real tradeoff, not a free upgrade.
