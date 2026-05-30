---
title: Operations
---

# Operations

## Per-tenant queue cap

`--queue-max-queues-per-org-per-shard N` rejects `CreateQueue` once an org has N queues registered on a shard. Default is `u32::MAX` (no cap).

The cap is per-shard. Cluster effective cap is `N × num_shards`. The flag name makes this explicit. A true cluster-wide per-org cap needs a global ledger. Followup work. Until then, set `N` so that `N × num_shards` is the cluster limit you actually want.

The cap is enforced synchronously via a `CreateSlotGuard`. Two concurrent `CreateQueue` calls on the same org can't both pass the count check before either inserts. (Real TOCTOU bug, fixed in P4.1 and regression-tested.)

The cap does not survive a node restart cleanly today. Projections are loaded lazily on first `CreateQueue` per queue post-boot. A tenant with N existing queues + cap=N can briefly create N more before the first N re-load. A boot-time enumeration would close this. Tracked in `docs/p4-followups.md`.

## Metrics

The queue exports per-queue gauges and cluster-wide counters via the same `metrics-exporter-prometheus` endpoint Celeriant uses. Default `localhost:9090/metrics`.

### Gauges (labelled `(org_id, queue_id)`)

| Name | Meaning |
|---|---|
| `celeriant_queue_depth` | `message_tail_version - trim_cursor`. Approximates backlog. |
| `celeriant_queue_in_flight` | Live lease count. |
| `celeriant_queue_ack_hole_ranges` | Coalesced ack-gap range count. Hitting `max_ack_holes` blocks new leases. |
| `celeriant_queue_parked` | Versions parked to DLQ. |
| `celeriant_queue_blocked` | Versions in head-of-line Block. Non-zero means trim pinned. |
| `celeriant_queue_tail` | Monotonic `message_tail_version`. Slope is produce rate. |

### Counters

| Name | Meaning |
|---|---|
| `celeriant_queue_produced_total` | Messages durably appended. |
| `celeriant_queue_consumed_total` | Versions returned in Consume responses. |
| `celeriant_queue_acked_total` | Acks committed (durable AckBatch event count, not individual versions). |
| `celeriant_queue_nacked_total` | Nacks committed. |
| `celeriant_queue_parked_total` | Park events committed. |
| `celeriant_queue_expired_leases_total` | Leases re-folded due to visibility-timeout expiry. |
| `celeriant_queue_snapshot_oversize_skipped_total` | Snapshot capture exceeded 12 MiB cap and was skipped. |

### Sampling

The gauge emitter runs on a 5s tick per shard. Snapshots all queue projections under one tight RefCell borrow, drops the borrow, then emits to Prometheus. Respects the shard's shutdown flag (250 ms slice).

DeleteQueue zeroes the per-queue gauges in the handler. metrics-rs has no stable `.remove()` API. Dashboards see `0` for a deleted queue instead of the last live value sticking forever.

## What to alert on

- `celeriant_queue_blocked > 0` for any queue, sustained over 30s. A head-of-line block needs operator action. The Grafana dashboard turns red on first non-zero.
- `rate(celeriant_queue_parked_total[5m]) > 0` on a queue you don't expect poisons on. Investigate the DLQ.
- `celeriant_queue_ack_hole_ranges` approaching `max_ack_holes` on a queue. Consumers aren't draining holes. New leases will start failing with `AckHoleCapExceeded`.
- `celeriant_queue_snapshot_oversize_skipped_total > 0`. A queue's snapshot is too big. Recovery falls back to genesis fold on restart (slow). Probably pathological live-lease cardinality. Investigate.
- High `rate(celeriant_queue_expired_leases_total[5m])`. Consumers are slow or crashing mid-process. Bump `visibility_timeout_ms` or fix the consumer.

## Snapshot tier

Each shard runs a snapshot timer (60s interval) that captures projections whose control log has advanced by ≥ 64 events since the last snapshot. The capture is bincode-encoded and written as a `ControlEvent::Snapshot` to the control aggregate. On restart, recovery picks the latest Snapshot event and folds the tail of events with `cv > snapshot.cv` on top. Fast cold start.

Snapshots are a cache, never truth. The control log is the source of truth. Recovery falls back to genesis-fold on:

- Snapshot absent.
- Snapshot corrupt (bincode decode failure).
- Snapshot `schema_version != SNAPSHOT_SCHEMA_VERSION` (currently 2). Schema bumps deliberately invalidate older snapshots.
- Snapshot exceeded the 12 MiB hard cap at write time. Counter bumps. Recovery never sees the snapshot.

## Local dev stack

See [`deploy/local-cluster/README.md`](https://github.com/celeriant/celeriant-queue/blob/main/deploy/local-cluster/README.md). Docker Compose stack with queue node + Prometheus + Loki + Promtail + Grafana with a pre-provisioned queue dashboard. Built from source via the repo-root Dockerfile.
