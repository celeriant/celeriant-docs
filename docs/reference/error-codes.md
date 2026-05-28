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
| 1002 | `CacheLoadLockTimeout` | The aggregate's cache load contended with another loader and timed out. Retry. |
| 1003 | `CacheLoadFileScan` | A file-scan error during cache load; check disk and `--data-root`. |
| 1004 | `FetchDatablocks` | Failed to fetch data blocks from disk. |
| 1005 | `FetchMetablocks` | Failed to fetch metadata blocks from disk. |

## Write and request (2xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 2000 | `EmptyEventsList` | A write carried no events. |
| 2001 | `ZeroEventType` | An event's `EventTypeMajor` is zero, which is reserved. |
| 2002 | `ClientIdempotencyViolation` | This client sequence already landed and is durable. Treat as success. See [Idempotent retries](/concepts/idempotent-writes). |
| 2003 | `OptimisticConcurrencyViolation` | The aggregate moved past your `expectedVersion`. Re-read and retry. See [Optimistic concurrency](/concepts/optimistic-concurrency). |
| 2004 | `FailedToSerialiseDatablocks` | The write's payload could not be serialised; usually a malformed event. |
| 2005 | `AggregateNotExists` | Write to a missing aggregate without `allowCreate`. |
| 2006 | `AggregateRecreateNotAllowed` | The aggregate was deleted and was not marked recreatable. |
| 2007 | `WriteReplicationError` | Replication failed during the write (follower disconnect, batch corruption). The write was not acknowledged. |
| 2008 | `WriteFsyncError` | The leader's fsync failed. Acknowledged data is unaffected; this write did not land. |
| 2009 | `WriteCacheAggregateClientError` | Internal cache error while resolving the aggregate. |
| 2010 | `WriteAggregateExistsCacheError` | Internal cache error checking aggregate existence. |
| 2011 | `NotLeader` | The write hit a follower. Official client pools redirect automatically; raw clients must handle it. See [two-node cluster](/operations/two-node-cluster). |
| 2012 | `WriteReplicationBackpressure` | The follower cannot keep up; the leader is shedding load. Back off and retry. See [troubleshooting](/operations/troubleshooting). |
| 2013 | `InflightDuplicateWrite` | A write with this client sequence is fsynced locally but not yet confirmed replicated. Hold the sequence, back off, and retry; do not treat as success, since a failover before confirmation can roll it back. |

## Schema (2020-2029)

| Code | Name | Meaning |
| --- | --- | --- |
| 2020 | `RegisterSchemaAlreadyExists` | A schema is already registered for this event type and version. |
| 2021 | `RegisterSchemaInvalid` | The submitted schema is malformed. |
| 2022 | `WriteSchemaValidationFailed` | An event failed validation against its registered schema. |
| 2023 | `WriteSchemaCompilationFailed` | The cached compiled schema is corrupt; re-register the schema. |
| 2024 | `RegisterSchemaUnsupportedType` | The schema uses a type the server cannot compile. |
| 2025 | `RegisterSchemaCacheLoadError` | Internal cache load failure for the schema registry. |
| 2026 | `RegisterSchemaFsyncError` | Fsync failed while writing the registered schema to disk. |
| 2027 | `RegisterSchemaCannotAcceptWrites` | This node is a follower; the registration must go to the leader. |
| 2028 | `RegisterSchemaReplicationError` | Replicating the schema registration to the follower failed. |
| 2029 | `RegisterSchemaCoordinationFailed` | Cross-shard schema coordination failed; transient, retry. |

## Trim (3xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 3000 | `TrimAggregateNotExists` | No such aggregate to trim. |
| 3001 | `TrimCacheError` | Internal cache error during trim. |
| 3002 | `TrimReplicationError` | Replication failed during the trim. |
| 3003 | `TrimFsyncError` | Fsync failed during the trim. |
| 3004 | `TrimIndexOutOfRange` | The trim index is outside the stream's current range. |
| 3005 | `TrimNotLeader` | The trim hit a follower. Retry against the leader. |

## Delete (4xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 4000 | `DeleteAggregateNotExists` | No such aggregate to delete. |
| 4001 | `DeleteEmptyDeleteList` | The delete request had no aggregates. |
| 4002 | `DeleteOptimisticConcurrencyViolation` | The aggregate moved past your `expectedVersion`. Re-read and retry. |
| 4003 | `DeleteCacheError` | Internal cache error during delete. |
| 4004 | `DeleteReplicationError` | Replication failed during the delete. |
| 4005 | `DeleteFsyncError` | Fsync failed during the delete. |
| 4006 | `DeleteNotLeader` | The delete hit a follower. Retry against the leader. |

## Listing (5xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 5000 | `ListOrgsDiskRead` | Failed to read the org list from disk. |
| 5001 | `ListAggregateTypesDiskRead` | Failed to read the aggregate-type list from disk. |
| 5002 | `ListAggregatesDiskRead` | Failed to read the aggregate list from disk. |

## Replication batch (6xxx)

These come back from the replication port (follower-facing), not the client port.

| Code | Name | Meaning |
| --- | --- | --- |
| 6000 | `ReplicationBatchFsync` | The follower's fsync of a replication batch failed. |
| 6001 | `ReplicationBatchSerialiseDatablocks` | The follower could not deserialise the leader's data blocks; version mismatch or corruption. |
| 6002 | `ReplicationBatchWalSeqGap` | The follower received a non-contiguous WAL sequence; triggers S3 catch-up. |

## Exists / aggregate-details (7xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 7000 | `ExistsCacheError` | Internal cache error during an existence check. |
| 7001 | `ExistsAggregateNotExists` | The aggregate does not exist. |
| 7002 | `ExistsMetablockReadError` | Failed to read metadata blocks for the existence check. |

## Watch (8xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 8000 | `WatchRequestInvalid` | The watch request is malformed (no filters, conflicting filters). |
| 8001 | `LatencyTooHigh` | `RequestedLatency` exceeds `--watch-max-requested-latency-ms`. |
| 8002 | `WatchReadIo` | I/O error while reading events for a notification. |
| 8003 | `WatchReadSerialization` | Serialisation error while shipping notifications. |
| 8004 | `WatchReadOther` | Other internal error in the watch session. |

## Shard routing (9xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 9000 | `ShardRoutingNoKey` | The request carries no routing key; the server cannot pick a shard. |
| 9001 | `ShardRoutingMultipleShards` | Aggregates in this request hash to different shards. Re-allocate ids that share `% num_shards`, or change the cluster's routing rule. See [Atomic multi-aggregate writes](/guides/multi-aggregate-writes). |
| 9002 | `ShardRoutingIncompatibleFilters` | A watch's filter set does not match the cluster's routing rule (e.g. routing by `org_id` but the watch has no `Orgs` filter). |

## Identity and authentication (10xxx)

These come from the [client identity](/concepts/identity) handshake and the API-key path.

| Code | Name | Meaning |
| --- | --- | --- |
| 10001 | `IdentifyInvalidNonce` | The nonce is expired or malformed. Check client clock against server. |
| 10002 | `IdentifyInvalidSignature` | The signature did not verify against the public key. |
| 10003 | `IdentifyMismatch` | The `clientId` in a write does not match the identified client. |
| 10004 | `IdentifyRequired` | The server runs with `--require-client-identity` and the client sent none. |
| 10005 | `AuthRequired` | The server requires API-key auth and none was provided. |
| 10006 | `AuthInvalidKey` | The presented API key does not match a stored hash. |
| 10007 | `AuthInsufficientPermissions` | The API key is read-only; the request needs write permission. |

## Server health (11xxx)

| Code | Name | Meaning |
| --- | --- | --- |
| 11000 | `ServerBusy` | A shard's inter-shard channel is full; the request was not routed. Back off and retry. Persistent values point to an overloaded shard. |
