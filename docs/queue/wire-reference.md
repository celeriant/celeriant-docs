---
title: Wire reference
---

# Wire reference

Native bincode over TCP on the queue port (default `10100`). Frames use the same `celeriant_wire::network::wire_header::WireHeader` as Celeriant. Body types in `celeriant_queue_proto::requests` and `::responses`.

No HTTP. No JSON. No JWT. The wire is the same shape Celeriant uses for its own client traffic.

## Verbs

| ID  | Verb | Purpose |
|----:|---|---|
| 1   | `CreateQueue` | Register a queue with config + DLQ. Idempotent on `(queue_key, dlq, config)`. |
| 2   | `DeleteQueue` | Best-effort delete. Removes the in-memory projection and zeroes gauges. |
| 3   | `Produce` | Append messages to a queue. One `client_id` per request, `client_seq` per message for idempotency (see below). |
| 4   | `Consume` | Lease N messages with an optional long-poll `wait_ms`. |
| 5   | `Ack` | Terminate-by-success. Batched per-request into one durable AckBatch event. |
| 6   | `Nack` | Return-to-Available. Per-handle `delay_ms` delays redelivery. Batched per-request into one durable NackBatch event, mirroring Ack. |
| 7   | `Extend` | Bump the lease deadline by `additional_visibility_ms`, capped at `visibility_timeout_ms`. Same lease_id, no `delivery_count` bump. |
| 8   | `Stats` | Queue state snapshot: tail, trim, in-flight, parked, blocked, ack-hole ranges, range assignments. |
| 9   | `TrimQueue` | Advance `trim_cursor` to `keep_from_version`. Fold clamps to lowest live lease / blocked / nack-delay. |
| 10  | `SnapshotNow` | Force-write a Snapshot control event. Useful for tests. Production relies on the 60s timer. |
| 11  | `AssignRange` | Assign a ring range `(lo, hi)` to a `(group, consumer)`. Idempotent on exact bounds. Partial overlap is `InvalidConfig`. |
| 12  | `Unblock` | Clear a head-of-line Block for a specific version. |

## Produce idempotency

`ProduceResponse.assigned_versions` is `Vec<Option<u64>>`, one slot per request entry, in submission order. `Some(version)` means newly appended. `None` means the entry's `client_seq` was already durable for that `client_id` and was skipped. `client_seq` is strictly monotonic per `client_id`; same seq = same message. A blind retry of the whole batch self-heals — Kafka-style idempotent producer.

## Response IDs

Response message types are 100 + verb ID. Errors are `199`.

## Error codes

`QueueErrorCode` (in `celeriant_queue_proto::responses`):

| Code | Variant | When |
|---|---|---|
| 1 | `UnknownQueue` | `queue_key` not registered. |
| 2 | `QueueAlreadyExists` | `CreateQueue` with different DLQ or config. |
| 3 | `InvalidConfig` | Validation failure on `QueueConfig` or `AssignRange` overlap. |
| 4 | `InvalidHandle` | Ack/Nack/Extend against a stale lease_id, parked version, below trim, or no live lease. |
| 5 | `AckHoleCapExceeded` | Per-queue ack-hole range count above `max_ack_holes`. |
| 6 | `InFlightCapExceeded` | Per-queue in-flight above `max_in_flight`. |
| 7 | `OccConflict` | `Produce.expected_last_version` mismatch. |
| 8 | `IdempotencyConflict` | Reserved. Pre-v2 a duplicate `client_seq` on Produce errored here; wire-v2 skips duplicates and reports `None` in `assigned_versions` instead. |
| 9 | `NotLeader` | This shard isn't the leader for the queue's aggregates. |
| 10 | `SchemaValidation` | Reserved for schema enforcement (Tier 2). |
| 11 | `PayloadTooLarge` | Frame exceeded `--queue-max-frame-size`. |
| 12 | `QuotaExceeded` | `--queue-max-queues-per-org-per-shard` hit. |
| 99 | `Internal` | Server-side bug or unexpected storage error. |

## Control event enum

`ControlEvent` discriminants are positional in bincode. NEW VARIANTS MUST BE APPENDED AT THE END. Inserting mid-enum breaks every stored WAL log.

| Idx | Variant |
|----:|---|
| 0 | `Lease` |
| 1 | `Ack` |
| 2 | `Nack` |
| 3 | `Park` |
| 4 | `TrimStart` |
| 5 | `SnapshotMarker` |
| 6 | `Register` |
| 7 | `AckBatch` |
| 8 | `Snapshot` |
| 9 | `RangeAssign` |
| 10 | `Block` |
| 11 | `Unblock` |
| 12 | `NackBatch` |

## Snapshot schema

`QueueSnapshot` carries `schema_version: u32` (currently `2`) as the FIRST field. Recovery rejects mismatches with `SnapshotSchemaMismatch` and falls back to genesis-fold of the control log.

## Canonical client shape

No first-class client crate yet. The reference RPC helper lives in `celeriant_queue_integration_tests/tests/common/mod.rs::rpc`:

```rust
pub async fn rpc(tcp: &mut TcpStream, req: &QueueRequest, codec: &DictCodec) -> QueueResponse {
    write_request_uncompressed(tcp, req, 1024 * 1024, PROTOCOL_VERSION_V2).await.unwrap();
    tcp.flush().await.unwrap();
    let header = WireHeader::from_reader(tcp, 16 * 1024 * 1024).await.unwrap();
    read_response(header, tcp, codec).await.unwrap()
}
```

Connections are persistent. Open once, pipeline as many requests as you want, multiplex by `correlation_id` if you want to send before reading.
