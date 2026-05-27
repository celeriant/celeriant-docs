---
title: Configuration reference
---

# Configuration reference

Every option is both a command-line flag and an environment variable: `--data-root` is `CELERIANT_DATA_ROOT`, `--num-shards` is `CELERIANT_NUM_SHARDS`, and so on. Flags suit a hand-run binary; the env vars suit containers. This page lists the ones you operate with; the binary's `--help` is the exhaustive list.

## Core

| Flag | Default | Notes |
| --- | --- | --- |
| `--data-root` | `data` | Data directory. Must be on an `O_DIRECT`-capable filesystem. |
| `--listen-address` | `0.0.0.0` | Bind address. |
| `--client-port` | `10000` | Client connections. |
| `--num-shards` | CPU count | One core per shard. |
| `--routing-rule` | `aggregate_id` | `org_id`, `aggregate_type_id`, or `aggregate_id`. Fixed at cluster init; changing it means re-sharding. Decides which aggregates can be [co-committed](/concepts/consistency-boundaries). |
| `--standalone` | `false` | Single node, no replication or S3. |
| `--log-level` | `info` | `trace`, `debug`, `info`, `warn`, `error`. |

## Cluster and failover

| Flag | Default | Notes |
| --- | --- | --- |
| `--replication-port` | `10001` | Leader-to-follower replication and heartbeats. |
| `--advertised-client-address` | derived | What clients are told to reach; set behind a proxy or LB. |
| `--advertised-replication-address` | derived | What the peer is told to reach. |
| `--heartbeat-interval-ms` | `500` | Leader heartbeat cadence. |
| `--heartbeat-lease-duration-ms` | `1500` | Silence before the follower's lease expires. |
| `--s3-lease-duration-ms` | `30000` | Durable leader-lease TTL. See [leader election](/operations/leader-election-s3). |
| `--max-clock-drift-ms` | `500` | Slack added to lease checks. |

## S3

| Flag | Default | Notes |
| --- | --- | --- |
| `--s3-enabled` | `false` | Required for a cluster. Needs region and bucket. |
| `--s3-region` / `--s3-bucket` | none | The bucket must support conditional writes. |
| `--s3-access-key-id` / `--s3-secret-access-key` | none | Or the usual AWS credential chain. |
| `--s3-subfolder` | none | Isolate multiple clusters in one bucket. |
| `--s3-endpoint-override` | none | For MinIO and other S3-compatible stores. |
| `--s3-allow-http` / `--s3-skip-signature` | `false` | Local testing only. |

## Security

| Flag | Default | Notes |
| --- | --- | --- |
| `--tls-mode` | `disabled` | `disabled` or `strict`. See [TLS and mTLS](/operations/tls-mtls). |
| `--tls-ca-cert` / `--tls-node-cert` / `--tls-node-key` | none | The trust root and node identity. |
| `--tls-client-auth` | `require` | `require`, `optional`, `none`. |
| `--require-client-identity` | `false` | Force the [identity](/concepts/identity) handshake. |

## Storage and memory

| Flag | Default | Notes |
| --- | --- | --- |
| `--memory-consumption-percent` | `80` | Share of RAM for caches (1-95). |
| `--memory-budget-bytes` | auto | Explicit override. |
| `--shard-log-preallocate-bytes` | `1GiB` | Size of each WAL file. |
| `--wal-compression-level` | `3` | zstd level for the WAL. |
| `--compaction-check-interval-secs` | `7200` | How often to scan for reclaimable space. |
| `--compaction-temp-dir` | shard dir | Must be on the same filesystem as `--data-root`. |

## Limits and observability

| Flag | Default | Notes |
| --- | --- | --- |
| `--max-request-size` | `16 MiB` | Per client request. |
| `--max-response-size` | `64 MiB` | Per response. |
| `--max-requested-latency-ms` | `2000` | Cap on a [watch](/concepts/watch) latency request. |
| `--metrics-enabled` | `true` | Prometheus `/metrics` and `/health`. |
| `--metrics-port` | `9090` | See [Monitoring](/operations/monitoring). |
