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

The single-aggregate `WriteAsync` takes its correctness controls as named parameters: `expectedVersion` for [optimistic concurrency](/guides/handling-conflicts), and `clientId` plus `enforceClientIdempotency` for [idempotent retries](/guides/idempotency). `clientId` is required on every write; the client never invents one. Keep it stable per writer, and remember a fleet of service replicas is one writer with one id (see [scaling out](/guides/idempotency#scaling-out-many-replicas-one-client-id)).

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

`ClientTlsConfig` has `Create(host)` for server-only TLS and `WithClientCertificate(...)` / `WithClientCertificateFromPem(...)` for mTLS. `ClientIdentityConfig` has `FromApiKey(...)`, `FromRsaKeyPair(...)`, and `FromClientId(...)`. TLS secures the transport; identity is who you are for idempotency. See [Identity and authentication](/concepts/identity).

## Errors

Operations throw `CeleriantErrorException` and, for known conditions, typed subclasses you can catch directly:

```csharp
try { await pool.WriteAsync(/* ... */); }
catch (WriteOccException)             { /* 2003: version moved, re-read and retry */ }
catch (IdempotencyViolationException) { /* 2002: the seq landed, durably. Verify it is yours, then treat as success */ }
catch (InflightDuplicateWriteException) { /* 2013: in flight, not yet durable: hold the seq, retry */ }
catch (SchemaValidationException)     { /* 2022: payload failed its schema */ }
```

Others include `AggregateNotFoundException`, `AggregateRecreateNotAllowedException`, and `NotLeaderException`. To handle everything in one place, catch `CeleriantErrorException` and switch on `e.Error.ErrorCode`; the full list is the [error codes reference](/reference/error-codes).

## Resolving a 2002 from the stream

A 2002 proves the sequence was consumed, not that *your* event consumed it: with concurrent requests sharing one client id, a sibling may have taken the number first. The stream settles it. Point-read the contested sequence and compare the `EventId`:

```csharp
async Task<SeqOwnership> WhoOwnsSeq(Guid accountId, long clientSeq, Guid requestId)
{
    var resp = await pool.ReadAsync(Key(accountId), new ReadFilters(fromAggregateVersion: 1)
        .ClientSeqRange(clientSeq, clientSeq)     // matched on batch metadata:
        .IncludeClientId(ServiceClientId));       // non-matching batches are skipped unread
    var evt = resp.EventBatches.SelectMany(b => b.Events)
        .FirstOrDefault(e => e.ClientSeq == clientSeq);
    if (evt is null) return SeqOwnership.Unwritten;
    return evt.EventId == requestId ? SeqOwnership.Ours : SeqOwnership.Sibling;
}
```

The sequence filters are evaluated against batch metadata, so the server skips every batch except the one holding the sequence without reading its events. Yours means the prior attempt landed: success. A sibling's means your event never landed: take a fresh sequence and write again. The full retry loop this slots into is in the [idempotency guide](/guides/idempotency#the-write-loop), with the reference implementation in `celeriant_reference` in the server repo.
