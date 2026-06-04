---
title: Events and the append-only log
---

# Events and the append-only log

An event is an immutable, typed, ordered fact. Once appended it is never changed and never moved. The log only grows.

## Anatomy of an event

Each event carries:

- **Event type**: a `(major, minor)` pair. Major marks a breaking change to the shape; minor a backward-compatible one. Types tie into [schema validation](/concepts/schemas).
- **Payload**: opaque bytes. Celeriant does not parse it; you choose the encoding (JSON, Protobuf, Avro, whatever your services speak). Optionally validated against a registered schema, optionally [encrypted](/concepts/encryption).
- **Timestamps**: the client's event timestamp (when it happened, in your domain) and the server timestamp (when it was durably written).
- **Sequence numbers**: the client sequence used for [idempotent retries](/concepts/idempotent-writes), and the server-assigned index.

The server trusts the client's ordering. The timestamp you stamp is the timestamp it keeps; it does not rewrite your events' time to its own clock. But neither timestamp determines order: order is the server-assigned index, full stop. See [Reads and ordering](/concepts/reads-and-ordering).

## Batches and the version

Events written together land in a batch. Each batch gets a 1-based index, and an aggregate's latest batch index is its **aggregate version**, the number [optimistic concurrency](/concepts/optimistic-concurrency) checks against. That is a different thing from an event type's `(major, minor)` version above: one is the stream's position, the other is the schema's revision.

## Append-only, including retention

The log is appended, never edited in place; there is no `UPDATE`. Two retention operations exist: delete removes a whole stream, and trim drops a prefix of old events from a stream. Both shrink what is stored; neither rewrites the events that remain.

The immutability is what makes the [audit chain](/concepts/audit-chain) meaningful: if events could be edited, hash-chaining them would prove nothing. The chain proves the events within a stream are unaltered; it does not by itself stop a stream being deleted wholesale, which is what retention policy and [backups](/operations/backup-recovery) govern.
