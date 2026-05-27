---
title: Request and response types
---

# Request and response types

The operations the server exposes, and where each runs. The exact field shapes are in the [.NET](/clients/dotnet) and [Rust](/clients/rust) client types; this is the map.

| Operation | Request | Response | Runs on | Notes |
| --- | --- | --- | --- | --- |
| Write | `WriteRequest` (map of `AggregateKey` to `SingleAggregateWrite`) | `SuccessResponse` | leader | Conditional and atomic across aggregates on one shard. |
| Read | `ReadRequest` (`AggregateKey` + `ReadFilters`) | `ReadResponse` (event batches + `NextAggregateVersion` cursor) | any node | Per-aggregate, ordered, filtered, paged. |
| Aggregate details | `AggregateDetailsRequest` | `AggregateDetailsResponse` (versions, `IsDeleted`, flags, last write) | any node | Metadata without the events. |
| Delete | `DeleteRequest` (map to `SingleAggregateDelete`) | `SuccessResponse` | leader | Removes a stream; `AllowRecreate` / `AllowSequenceContinuation` flags. |
| Trim | `TrimStartRequest` (`KeepFromAggregateVersion`) | `SuccessResponse` | leader | Drops a prefix of old events. |
| Register schema | `RegisterSchemaRequest` (`SchemaKey` + `SchemaType` + schema) | `SuccessResponse` | leader | Validates future writes of that event type. |
| Watch | `WatchRequest` (scope + `RequestedLatency`) | a stream of `WatchResponse` (change notifications) | any node | Notifications carry the changed batch-index range, not payloads. |
| List orgs / types / aggregates | list request (scope + paging) | a stream of list items / `AggregateStats` | any node | Streaming; the client merges across shards. |

## Shared shape

Every request carries an optional `CorrelationId` (a `u128`) echoed back on the response, for tracing. Write, delete, trim, and register-schema also carry a `ClientId` (the writer's identity for [idempotency](/concepts/idempotent-writes)) and an optional `UserId`.

## Leader vs any node

Writes and other mutations run on the leader; the client pools follow a `NotLeader` redirect automatically. Reads, details, watch, and list run on any node, and can be routed to a follower (accepting its small replication lag) when the pool has `RouteReadsToFollowers` set. A follower read must not drive an [optimistic-concurrency](/concepts/optimistic-concurrency) write; take that version from the leader.

## Errors

Any operation can return an `ErrorResponse` with a numeric `ErrorCode`; the clients turn known codes into typed errors. See the [error codes reference](/reference/error-codes).
