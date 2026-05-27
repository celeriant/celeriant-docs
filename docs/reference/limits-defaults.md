---
title: Limits and defaults
---

# Limits and defaults

Server-side limits and their defaults. All are configurable; the flag name is in the right column. See [Configuration](/operations/configuration) for the full list and the matching `CELERIANT_` environment variables.

| Limit | Default | Flag |
| --- | --- | --- |
| Max client request size | 16 MiB | `--max-request-size` |
| Max response size | 64 MiB | `--max-response-size` |
| Max inter-node request size | 64 MiB | `--internode-max-request-size` |
| Max requested watch latency | 2000 ms | `--max-requested-latency-ms` |
| Max schema definition size | 16 KiB | `--max-schema-size-bytes` |
| List page size | 2000 entities | `--list-page-size` |
| Max concurrent list scans (per shard) | 16 | `--list-max-concurrent` |
| Max concurrent reads (per shard) | 64 | `--read-max-concurrent` |
| Slow-client / idle timeout | 30 s | `--client-connection-timeout-ms` |
| Max open files (per shard) | 1000 | `--max-open-files` |
| WAL file preallocation size | 1 GiB | `--shard-log-preallocate-bytes` |

## Other defaults worth knowing

- **Shards**: default to the CPU count (`--num-shards`).
- **Routing rule**: `aggregate_id` (`--routing-rule`). Fixed at cluster init.
- **Aggregate version**: 1-based. A version of 0 means "does not exist yet" for a [conditional create](/guides/handling-conflicts).
- **Client request/response sizes** are also capped on the client side; the client and server caps differ, and the client's defaults differ by language (the .NET client requests 30 s, the Rust client 2 s). See [Clients](/clients/overview).

These are not the cardinality limits people usually ask about: there is no fixed cap on the number of aggregates or events. Memory is bounded by the hot working set, not the total count. See [Durability and safety](/concepts/durability-and-safety).
