---
title: Operations
---

# Operations

## Per-tenant queue cap

`--queue-max-queues-per-org-per-shard N` rejects `CreateQueue` once an org has N queues registered on a shard. Default is `u32::MAX` (no cap).

The cap is per-shard. Cluster effective cap is `N × num_shards`. The flag name makes this explicit. A true cluster-wide per-org cap needs a global ledger. Followup work. Until then, set `N` so that `N × num_shards` is the cluster limit you actually want.

The cap is enforced synchronously via a `CreateSlotGuard`. Two concurrent `CreateQueue` calls on the same org can't both pass the count check before either inserts. (Real TOCTOU bug, fixed in P4.1 and regression-tested.)

The cap survives a node restart. Boot enumerates every queue's projection from the control logs before the queue port binds (a recovery failure refuses connections, never silently amnesias), so the per-org count is restored before the first `CreateQueue` is served.

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
| `celeriant_queue_acked_total` | Versions acked. Counted per entry, not per durable AckBatch event. |
| `celeriant_queue_nacked_total` | Versions nacked. Per entry, same as acked. |
| `celeriant_queue_parked_total` | Park events committed. |
| `celeriant_queue_blocked_total` | Block events committed (poison hit `max_delivery_attempts` on a Block/BlockAndDlq queue). The counter twin of the `blocked` gauge. |
| `celeriant_queue_snapshot_oversize_skipped_total` | Snapshot capture exceeded 12 MiB cap and was skipped. |

### Operator series (per-verb latency, errors, connections, snapshots)

These mirror celeriant-db's own conventions so a queue node and a db node read the same way on a dashboard.

| Name | Type | Meaning |
|---|---|---|
| `celeriant_queue_produce_duration_seconds` | histogram | Server-side produce handling latency. |
| `celeriant_queue_ack_duration_seconds` | histogram | Server-side ack handling latency. |
| `celeriant_queue_nack_duration_seconds` | histogram | Server-side nack handling latency. |
| `celeriant_queue_extend_duration_seconds` | histogram | Server-side extend handling latency. |
| `celeriant_queue_produce_errors_total` | counter | Produce verbs that returned an error. |
| `celeriant_queue_consume_errors_total` | counter | Consume verbs that returned an error. |
| `celeriant_queue_ack_errors_total` | counter | Ack verbs that returned an error. |
| `celeriant_queue_nack_errors_total` | counter | Nack verbs that returned an error. |
| `celeriant_queue_extend_errors_total` | counter | Extend verbs that returned an error. |
| `celeriant_queue_connections_active` | gauge | Open client TCP connections, labelled by `shard_id`. |
| `celeriant_queue_snapshot_success_total` | counter | Completed (verified + written) snapshots. |
| `celeriant_queue_snapshot_duration_seconds` | histogram | Snapshot capture + write + verify duration. |

Two honesty notes that will save you an alert chase:

- **Consume has an error counter but NO latency histogram.** Consume long-polls (blocks up to `wait_ms` waiting for a message), so a wall-clock latency histogram would measure idle wait, not work. There is no `celeriant_queue_consume_duration_seconds` and that is deliberate, not a gap. Use `celeriant_queue_consumed_total` for throughput.
- **`celeriant_queue_connections_active` is labelled by `shard_id`.** Each shard owns its own count. For the node total, `sum` across `shard_id` (`sum(celeriant_queue_connections_active)`). The per-verb error counters and the throughput counters are unlabelled and aggregate additively; pre-dispatch `NotLeader` rejections are deliberately not error-counted.

### Sampling

The gauge emitter runs on a 5s tick per shard. Snapshots all queue projections under one tight RefCell borrow, drops the borrow, then emits to Prometheus. Respects the shard's shutdown flag (250 ms slice).

DeleteQueue zeroes the per-queue gauges in the handler. metrics-rs has no stable `.remove()` API. Dashboards see `0` for a deleted queue instead of the last live value sticking forever.

## What to alert on

- `celeriant_queue_blocked > 0` for any queue, sustained over 30s. A head-of-line block needs operator action. The Grafana dashboard turns red on first non-zero.
- `rate(celeriant_queue_parked_total[5m]) > 0` on a queue you don't expect poisons on. Investigate the DLQ.
- `celeriant_queue_ack_hole_ranges` approaching `max_ack_holes` on a queue. Consumers aren't draining holes. New leases will start failing with `AckHoleCapExceeded`.
- `celeriant_queue_snapshot_oversize_skipped_total > 0`. A queue's snapshot is too big. Recovery falls back to genesis fold on restart (slow). Probably pathological live-lease cardinality. Investigate.

## Checkpoint tier (snapshot + reclamation)

Each shard runs a checkpoint timer (60s interval) that captures projections whose control log has advanced by ≥ 64 events since the last checkpoint. The capture is bincode-encoded and written as a self-contained `ControlEvent::Checkpoint` (snapshot + queue config in one event) to the control aggregate. On restart, recovery picks the latest restorable checkpoint and folds the tail of events with `cv > snapshot.cv` on top. Fast cold start.

Checkpoints also bound the control log's disk footprint. After a new checkpoint is durable AND verified (read back from storage, decoded, restored), the control aggregate is trimmed to the *previous* checkpoint — two checkpoints are always retained, and everything older (historical snapshot blobs, acks, the opening Register) is physically reclaimable by compaction. The log holds roughly two checkpoint cycles of events, forever.

Above the trim floor, a checkpoint is a cache: recovery walks back to the older retained checkpoint if the newest fails to restore, and falls all the way back to fold-from-the-floor when the log is still Register-headed. Below the floor the newest verified checkpoint **is** the history — a trimmed log whose checkpoints are all unreadable refuses recovery loudly rather than serving a lossy fold. Other fallback triggers:

- Snapshot corrupt (bincode decode failure) → next-older candidate.
- Snapshot `schema_version != SNAPSHOT_SCHEMA_VERSION` (currently 2). Schema bumps deliberately invalidate older snapshots.
- Capture exceeded the 12 MiB hard cap at write time. Counter bumps; the checkpoint isn't written and no trim advances.

## Auth and TLS cert hot-reload

The queue port can rotate its API keys and renew its TLS certificate WITHOUT a node restart, the same way celeriant-db's own ports do. New connections pick up the rotated material; existing connections are unaffected.

Opt in with `--tls-cert-reload-interval-secs N`. `0` is the default and means off (read once at boot, no reload). `N > 0` arms a per-shard timer that mtime-polls the files every `N` seconds and swaps the live config for new connections. The single flag arms BOTH reloaders:

- `api_keys.toml` re-reads on the interval. Rotate the file (add a new key, remove a revoked one) and the next handshake validates against the new set.
- The TLS cert/key files re-read on the same interval. Renew or revoke a cert and new TLS handshakes use it.

One semantic to be clear about: reload only re-reads a file that was ALREADY enabled at boot. A node booted without API keys does not gain auth because an `api_keys.toml` appears later, and a node booted without TLS does not start terminating TLS because cert files appear. Reload rotates an enabled file's contents; it does not turn a feature on. To enable auth or TLS on a node that booted without it, restart it with the cert/key flags.

## Admin CLI

`celeriant-queue-cli` is the operator CLI. It is a thin wrapper over the queue's tokio client, so it speaks the same native wire and honours the same identity.

Connection and identity flags (mirror celeriant-db's CLI):

| Flag | Purpose |
|---|---|
| `--server` | Queue server address. Default `127.0.0.1:10100`. |
| `--tls` | Enable TLS. Requires `--ca-cert`. |
| `--ca-cert` | CA PEM for server verification (the cluster uses a private CA). |
| `--client-cert` / `--client-key` | Client cert + key for mTLS. |
| `--server-name` | TLS SNI name. Defaults to the host from `--server`. Rejected without `--tls`. |
| `--api-key` | Base64 API key for the access level. |
| `--public-key` / `--private-key` | Key-pair files that prove identity. Compose with `--api-key` (the pair proves who you are, the key grants access). |

Subcommands:

| Command | What it does |
|---|---|
| `list-queues` | List queues on one shard. `--all-shards` self-discovers the shard count (via `cluster-info`) and enumerates every shard. `--org` filters to one tenant. |
| `create-queue` | Create a queue with its mandatory DLQ binding and config (`--visibility-timeout-ms`, `--max-delivery-attempts`, `--ordering-required`, `--dlq-strategy`, `--max-depth`). |
| `delete-queue` | Soft-delete a queue. |
| `stats` | Per-queue stats (see the `retained_span` note below). |
| `produce` | Produce one message (`--data` or `--file`). |
| `consume` | Lease messages. `--ack` acks them in the SAME session — the only place a `lease_id` exists. Without `--ack` they stay in-flight until the lease expires. |
| `trim` | Reclaim below `--keep-from-version`. |
| `redrive` | Move dead-letters from a DLQ back to a source queue. |
| `cluster-info` | Print the data-shard count. |

There is no standalone `ack` / `nack` / `extend`. A `lease_id` only lives inside a consume session, so the ack folds into `consume --ack`.

`stats` reports `retained_span`, NOT live depth. `retained_span` is the on-disk `[trim, tail]` record span (`tail + 1 - trim`); it does not subtract acked, parked, or TTL-expired messages. For the live picture read the `in_flight`, `parked_count`, and `blocked_count` fields the same command prints.

## Offline WAL inspection

`celeriant-queue-wal-inspect` reads a queue node's on-disk WAL directly, with the node stopped. The queue writes the identical `celeriant_wal` on-disk format as celeriant-db, so this is the disk-truth oracle for a queue node (recovery debugging, chaos audits).

It operates on a single log file. A shard's logs live at `<data_root>/shard_0/log_<n>.wal`.

| Subcommand | What it prints |
|---|---|
| `header` | Front and rear `ShardLogHeader` fields (cursors, tip hashes, metablock count). |
| `wal <wal_seq>` | The metablock with the given `wal_seq`. |
| `range <start> <end>` | Every metablock in `[start..=end]`. |
| `bounds` | First and last metablock `wal_seq` in the file. |
| `client <org_id> <agg_type_id> <agg_id> <client_id>` | Every event batch matching `(org, aggregate_type, aggregate, client_id)`, with `aggregate_version` and the min/max `client_seq` per batch. The two queue aggregate types are `CLRQ_MSG` (messages) and `CLRQ_CTL` (control); `agg_id` is the `queue_id`. |

## Local dev stack

See [`deploy/local-cluster/README.md`](https://github.com/celeriant/celeriant-queue/blob/main/deploy/local-cluster/README.md). Docker Compose stack with queue node + Prometheus + Loki + Promtail + Grafana with a pre-provisioned queue dashboard. Built from source via the repo-root Dockerfile.
