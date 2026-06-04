---
title: .NET client
---

# .NET client

The `Celeriant.Client` package, for net8.0 and up. Connect through a pool, then read, write, watch, and list.

## Connect

```csharp
using Celeriant.Client;

await using var pool = new CeleriantPool(new CeleriantPoolOptions
{
    Address               = "localhost:10000",
    SeedAddresses         = ["node2:10000"],   // optional failover seeds
    MaxConnections        = 10,                 // per node
    RequestTimeout        = TimeSpan.FromSeconds(30),
    RouteReadsToFollowers = false,              // true offloads reads to a follower
});
```

The pool is the single object your app holds. It manages connections per node and follows leader redirects on writes, so a `NotLeader` from the server is retried for you against the leader.

## Operations

| Method | Purpose |
| --- | --- |
| `WriteAsync(WriteRequest)` | Multi-aggregate atomic write. |
| `WriteAsync(key, events, clientId, allowCreate, expectedVersion?, enforceClientIdempotency)` | Single-aggregate convenience overload. |
| `ReadAsync(ReadRequest)` | One page of an aggregate's events. |
| `ReadAllAsync(key, filters?)` | `IAsyncEnumerable` that auto-paginates the whole stream. |
| `AggregateDetailsAsync(AggregateDetailsRequest)` | Version and metadata without the events. |
| `DeleteAsync(DeleteRequest)` / `TrimStartAsync(TrimStartRequest)` | Remove a stream / drop old events. |
| `RegisterSchemaAsync(RegisterSchemaRequest)` | Register an event-type schema. |
| `WatchAsync(WatchRequest)` | Open a `WatchConnection` (dedicated; dispose it). |
| `ListOrgsAsync` / `ListAggregateTypesAsync` / `ListAggregatesAsync` | Streaming discovery. |

The single-aggregate `WriteAsync` takes its correctness controls as named parameters: `expectedVersion` for [optimistic concurrency](/guides/handling-conflicts), and `clientId` plus `enforceClientIdempotency` for [idempotent retries](/guides/idempotency). `clientId` is required on every write; the client never invents one. Keep it stable per writer.

A worked write and read is in the [Quickstart](/get-started/quickstart); the [Guides](/guides/appending-events) cover each operation as a recipe.

## TLS and identity

```csharp
var options = new CeleriantPoolOptions
{
    Address     = "localhost:10010",
    TlsConfig   = ClientTlsConfig.WithClientCertificateFromPem("celeriant.example", "client.crt", "client.key"),
    IdentityConfig = ClientIdentityConfig.FromRsaKeyPair(publicKeyBase64, privateKeyBase64),
};
```

`ClientTlsConfig` has `Create(host)` for server-only TLS and `WithClientCertificate(...)` / `WithClientCertificateFromPem(...)` for mTLS. `ClientIdentityConfig` has `FromApiKey(...)`, `FromRsaKeyPair(...)`, and `FromClientId(...)`. TLS secures the transport; identity is who you are for idempotency and access control. See [Clients and identity](/concepts/identity).

## Errors

Operations throw `CeleriantErrorException` and, for known conditions, typed subclasses you can catch directly:

```csharp
try { await pool.WriteAsync(/* ... */); }
catch (WriteOccException)             { /* 2003: version moved, re-read and retry */ }
catch (IdempotencyViolationException) { /* 2002: already landed, durable: treat as success */ }
catch (InflightDuplicateWriteException) { /* 2013: in flight, not yet durable: hold the seq, retry */ }
catch (SchemaValidationException)     { /* 2022: payload failed its schema */ }
```

Others include `AggregateNotFoundException`, `AggregateRecreateNotAllowedException`, and `NotLeaderException`. To handle everything in one place, catch `CeleriantErrorException` and switch on `e.Error.ErrorCode`; the full list is the [error codes reference](/reference/error-codes).
