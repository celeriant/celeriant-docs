---
title: Appending events
---

# Appending events

The recipe for writing one or more events to an aggregate.

## One event

```csharp
using System;
using System.Text;
using Celeriant.Client;

await using var pool = new CeleriantPool(new CeleriantPoolOptions
{
    Address = "localhost:10000",
});

var key = new AggregateKey(orgId, ordersType, orderId);
var writerId = myStableWriterId;   // one id per writer, held across restarts

await pool.WriteAsync(
    key,
    events: [new AggregateEvent
    {
        ClientSeq = 1,
        EventTypeMajor   = 1,
        EventTypeMinor   = 0,
        EventTimestamp   = DateTimeOffset.UtcNow,
        EventValue       = Encoding.UTF8.GetBytes("""{ "sku": "A-1", "qty": 2 }"""),
    }],
    clientId: writerId,
    allowCreate: true);
```

You set the client-side fields: `ClientSeq` (your per-writer sequence, used for [idempotency](/guides/idempotency)), the event type, the timestamp, and the payload bytes. `EventValue` is opaque to the server; you choose the encoding. The server assigns the server-side index on write.

In real code you usually build events from typed payloads with the serializer helper instead of hand-packing bytes:

```csharp
var evt = AggregateEventExtensions.Create(
    1,                            // event type major
    new OrderPlaced("A-1", 2),    // typed payload, serialized for you
    JsonEventSerializer.Default,  // an IEventSerializer
    clientSeq: 1);
```

The explicit object-initializer form is shown above so the fields are visible; the bytes are opaque to the server either way.

`allowCreate: true` creates the aggregate on its first event. Leave it `false` to require that the aggregate already exists.

## Several events at once

Pass more than one event; they land together as one batch, in order, and the batch is one durable unit:

```csharp
var now = DateTimeOffset.UtcNow;
await pool.WriteAsync(key,
    events:
    [
        new AggregateEvent { ClientSeq = 1, EventTypeMajor = 1, EventTimestamp = now, EventValue = Encoding.UTF8.GetBytes("""{ "event": "created" }""") },
        new AggregateEvent { ClientSeq = 2, EventTypeMajor = 2, EventTimestamp = now, EventValue = Encoding.UTF8.GetBytes("""{ "event": "lineAdded" }""") },
    ],
    clientId: writerId,
    allowCreate: true);
```

## Make it conditional, make it idempotent

Two more parameters turn the safety on:

```csharp
await pool.WriteAsync(key, events,
    clientId: writerId,
    expectedVersion: 4,             // OCC: commit only if the aggregate is still at version 4
    enforceClientIdempotency: true);  // dedup retries by (clientId, ClientSeq)
```

For why and how, see [Handling concurrency conflicts](/guides/handling-conflicts) and [Implementing idempotent writes](/guides/idempotency).
