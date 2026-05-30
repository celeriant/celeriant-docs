---
title: Wire reference
---

# Wire reference

Native bincode over TCP on the queue port (default `10100`). Frames use the same `celeriant_wire::network::wire_header::WireHeader` as Celeriant. Body types in `celeriant_queue_proto::requests` / `::responses`.

There is no HTTP, no JSON, no JWT. The wire is the same shape Celeriant uses for its own client traffic.

## Verbs

| ID  | Verb | Purpose |
|----:|---|---|
| 1   | `CreateQueue` | Register a queue with config + DLQ. Idempotent on `(queue_key, dlq, config)`. |
| 2   | `DeleteQueue` | Best-effort delete. Removes the in-memory projection + zeroes gauges. |
| 3   | `Produce` | Append messages to a queue. Per-message `(client_id, client_seq)` for idempotency. |
| 4   | `Consume` | Lease N messages with an optional long-poll `wait_ms`. |
| 5   | `Ack` | Terminate-by-success. Batched per-request into one durable AckBatch event. |
| 6   | `Nack` | Return-to-Available. Optional `delay_ms` delays redelivery. |
| 7   | `Extend` | Bump the lease deadline by another `visibility_timeout_ms`. Same lease_id, so no `delivery_count` bump. |
| 8   | `Stats` | Queue state snapshot: tail, trim, in-flight, parked, blocked, ack-hole ranges, range assignments. |
| 9   | `TrimQueue` | Advance `trim_cursor` to `keep_from_version`. Fold clamps to lowest live lease / blocked / nack-delay. |
| 10  | `SnapshotNow` | Force-write a Snapshot control event. Useful for tests; production relies on the 60s timer. |
| 11  | `AssignRange` | Assign a ring range `(lo, hi)` to a `(group, consumer)`. Idempotent on exact bounds; partial overlap = `InvalidConfig`. |
| 12  | `Unblock` | Clear a head-of-line Block for a specific version. |

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
| 5 | `AckHoleCapExceeded` | Per-queue ack-hole range count > `max_ack_holes`. |
| 6 | `InFlightCapExceeded` | Per-queue in-flight > `max_in_flight`. |
| 7 | `OccConflict` | `Produce.expected_last_version` mismatch. |
| 8 | `IdempotencyConflict` | `Produce.client_seq` is not strictly greater than prior writes for the same `client_id`. |
| 9 | `NotLeader` | This shard isn't the leader for the queue's aggregates. |
| 10 | `SchemaValidation` | Reserved for schema enforcement (Tier 2). |
| 11 | `PayloadTooLarge` | Frame exceeded `--queue-max-frame-size`. |
| 12 | `QuotaExceeded` | `--queue-max-queues-per-org-per-shard` hit. |
| 99 | `Internal` | Server-side bug or unexpected storage error. |

## Control event enum

`ControlEvent` discriminants are positional in bincode. NEW VARIANTS MUST BE APPENDED AT THE END — inserting mid-enum breaks every stored WAL log.

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

## Snapshot schema

`QueueSnapshot` carries `schema_version: u32` (currently `2`) as the FIRST field. Recovery rejects mismatches with `SnapshotSchemaMismatch` and falls back to genesis-fold of the control log.

## Canonical client shape

There is no first-class client crate yet. The reference RPC helper lives in `celeriant_queue_integration_tests/tests/common/mod.rs::rpc`:

```rust
pub async fn rpc(tcp: &mut TcpStream, req: &QueueRequest, codec: &DictCodec) -> QueueResponse {
    write_request_uncompressed(tcp, req, 1024 * 1024, PROTOCOL_VERSION_V2).await.unwrap();
    tcp.flush().await.unwrap();
    let header = WireHeader::from_reader(tcp, 16 * 1024 * 1024).await.unwrap();
    read_response(header, tcp, codec).await.unwrap()
}
```

Connections are persistent: open once, pipeline as many requests as you want, multiplex by `correlation_id` if you want to send before reading.
