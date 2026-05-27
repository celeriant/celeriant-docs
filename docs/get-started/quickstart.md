---
title: Quickstart
---

# Quickstart

Run a node, append an event, read it back. Five minutes.

:::info Pre-release
Celeriant is pre-1.0. The server binary and container image will ship with the open-source release; until then these steps are the shape of the workflow, not a download link. See [when not to use it](/introduction/when-not-to-use).
:::

## 1. Start a node

Standalone mode runs a single process with no replication and no S3. It is for development, not production.

```bash
celeriant \
  --standalone \
  --data-root /var/lib/celeriant \
  --num-shards 1 \
  --client-port 10000
```

The data root must sit on an `O_DIRECT`-capable filesystem (ext4 or XFS). For production, run a [two-node cluster](/operations/two-node-cluster) instead.

## 2. Append and read (.NET)

Add the client (see [Install a client](/get-started/install-client)), then:

```csharp
using System;
using System.Text;
using Celeriant.Client;

await using var pool = new CeleriantPool(new CeleriantPoolOptions
{
    Address = "localhost:10000",
});

// org / aggregate-type / aggregate-id
var key = new AggregateKey(
    orgId:           Guid.Parse("11111111-1111-1111-1111-111111111111"),
    aggregateTypeId: Guid.Parse("22222222-2222-2222-2222-222222222222"),
    aggregateId:     Guid.Parse("33333333-3333-3333-3333-333333333333"));

// append one event, creating the aggregate if it does not exist
await pool.WriteAsync(
    key,
    events: [new AggregateEvent
    {
        ClientSeq = 1,
        EventTypeMajor   = 1,
        EventTypeMinor   = 0,
        EventTimestamp   = DateTimeOffset.UtcNow,
        EventValue       = """{ "hello": "world" }"""u8.ToArray(),
    }],
    allowCreate: true);

// read it back from the start of the stream
var response = await pool.ReadAsync(new ReadRequest
{
    AggregateKey = key,
    Filters      = ReadFilters.From(1),
});

foreach (var batch in response.EventBatches)
    foreach (var e in batch.Events)
        Console.WriteLine(Encoding.UTF8.GetString(e.EventValue));
```

That write is durable before the call returns: fsync'd to disk, and on a cluster, replicated to the follower first.

## Next steps

- [Your first aggregate](/get-started/first-aggregate): conditional writes and idempotency, the parts that matter.
- [Optimistic concurrency](/concepts/optimistic-concurrency): the conditional write, in depth.
- [Clients overview](/clients/overview): .NET, Rust, and the CLI.
