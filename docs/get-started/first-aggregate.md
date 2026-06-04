---
title: Your first aggregate
---

# Your first aggregate

The [Quickstart](/get-started/quickstart) appended one event. This goes one step further into the parts that make Celeriant worth using: conditional writes and idempotency. The examples are .NET; the shape is the same in every client.

## Create and append

An aggregate is addressed by `org / type / id` and comes into being on its first write:

```csharp
var key = new AggregateKey(orgId, ordersType, orderId);
var writerId = myStableWriterId;   // one id per writer, held across restarts

await pool.WriteAsync(key,
    events: [new AggregateEvent
    {
        ClientSeq      = 1,
        EventTypeMajor = 1,
        EventTimestamp = DateTimeOffset.UtcNow,
        EventValue     = Encoding.UTF8.GetBytes("""{ "sku": "A-1", "qty": 2 }"""),
    }],
    clientId: writerId,
    allowCreate: true);
```

## Read it back, get the version

```csharp
var details = await pool.AggregateDetailsAsync(new AggregateDetailsRequest { AggregateKey = key });
long version = details.MaxAggregateVersion;   // where the aggregate is now
```

## Write conditionally

The point of an event store: append only if nobody moved the aggregate since you read it. Pass the version you expect, and turn on `enforceClientIdempotency` so a retry cannot double-write:

```csharp
await pool.WriteAsync(key,
    events: [new AggregateEvent
    {
        ClientSeq      = 2,
        EventTypeMajor = 2,
        EventTimestamp = DateTimeOffset.UtcNow,
        EventValue     = Encoding.UTF8.GetBytes("""{ "event": "shipped" }"""),
    }],
    clientId: writerId,
    expectedVersion: version,
    enforceClientIdempotency: true);
```

If another writer got there first, this throws `WriteOccException` and nothing is appended. That is the guarantee you came for.

## Next

- [Handling concurrency conflicts](/guides/handling-conflicts): the read-decide-write loop and the four ways a retry resolves.
- [Implementing idempotent writes](/guides/idempotency): why `clientId` must be stable.
- [Building a read model](/guides/building-a-projection): how you query, since Celeriant is the write side.
