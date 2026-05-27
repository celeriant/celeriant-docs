---
title: Error codes
---

# Error codes

Every error the server returns carries a stable numeric code. Match on the code, not on the message text; messages are for humans and can change. Codes are grouped by category and sparse: unlisted values within a range are reserved.

:::info Pre-release
Codes reflect the current pre-1.0 protocol and may change before 1.0.
:::

## Read (1xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 1000 | `UnavailableBatchIndex` | The requested batch index is below the start of the stream, usually because it was trimmed. |
| 1001 | `AggregateNotExists` | No such aggregate to read. |

## Write and request (2xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 2000 | `EmptyEventsList` | A write carried no events. |
| 2002 | `ClientIdempotencyViolation` | This client sequence already landed. Treat as success: the event is already in the log. See [Idempotent retries](/concepts/idempotent-writes). |
| 2003 | `OptimisticConcurrencyViolation` | The aggregate moved past your `expectedVersion`. Re-read and retry. See [Optimistic concurrency](/concepts/optimistic-concurrency). |
| 2005 | `AggregateNotExists` | Write to a missing aggregate without `allowCreate`. |
| 2006 | `AggregateRecreateNotAllowed` | The aggregate was deleted and was not marked recreatable. |
| 2011 | `NotLeader` | The node is a follower. The official client pools retry this against the leader automatically; raw protocol clients must handle it. See [two-node cluster](/operations/two-node-cluster). |
| 2013 | `InflightDuplicateWrite` | A write with this client sequence is in flight but not yet confirmed durable. Hold the sequence, back off, and retry; do not treat it as success, since it could still roll back. See [Handling concurrency conflicts](/guides/handling-conflicts). |

## Schema (2020-2022)

| Code | Name | Meaning |
| --- | --- | --- |
| 2020 | `RegisterSchemaAlreadyExists` | A schema is already registered for this event type and version. |
| 2021 | `RegisterSchemaInvalid` | The submitted schema is malformed. |
| 2022 | `WriteSchemaValidationFailed` | An event failed validation against its registered schema. |

## Watch (8xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 8001 | `LatencyTooHigh` | The requested watch latency exceeds the server maximum. |

## Shard routing (9xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 9001 | `ShardRoutingMultipleShards` | A watch spans multiple shards; the client falls back to one connection per shard. |

## Authentication (10xxx)

These come from the [client identity](/concepts/identity) handshake.

| Code | Name | Meaning |
| --- | --- | --- |
| 10001 | `IdentifyInvalidNonce` | The nonce is expired or malformed. |
| 10002 | `IdentifyInvalidSignature` | The signature did not verify against the public key. |
| 10003 | `IdentifyMismatch` | The `clientId` in a write does not match the identified client. |
| 10004 | `IdentifyRequired` | The server requires identity and the client did not send one. |
