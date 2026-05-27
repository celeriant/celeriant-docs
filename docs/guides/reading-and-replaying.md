---
title: Reading and replaying a stream
---

# Reading and replaying a stream

Read an aggregate's events in order and fold them into state. See [Reads and ordering](/concepts/reads-and-ordering) for the model.

## Read from the start

```csharp
var response = await pool.ReadAsync(new ReadRequest
{
    AggregateKey = key,
    Filters      = ReadFilters.From(1),
});

foreach (var batch in response.EventBatches)
    foreach (var e in batch.Events)
        Apply(e); // fold into your state
```

`ReadFilters` is a value type. `ReadFilters.From(n)` starts at batch index `n` (clamped to a minimum of 1); narrow it further with a `with` expression, not builder methods:

```csharp
var filters = ReadFilters.From(1) with
{
    ToAggregateVersion = 100,        // inclusive upper bound
    IncludeEventTypes = [1, 2, 3],  // only these event types
    MinEventTimestamp = since,      // client-timestamp lower bound
};
```

## Page through a large aggregate

`ReadAsync` returns a `NextAggregateVersion` cursor when there is more. Drive it yourself, or let the client do it:

```csharp
// automatic pagination: streams the whole aggregate in bounded memory
await foreach (var batch in pool.ReadAllAsync(key, ReadFilters.From(1)))
    foreach (var e in batch.Events)
        Apply(e);
```

`ReadAllAsync` leases one connection for the duration and follows the cursor for you. Prefer it for replaying a full stream.

## Replaying to rebuild state

Folding the stream from the start is how you rebuild a projection or an aggregate's in-memory state from nothing:

```csharp
var order = new OrderState();
await foreach (var batch in pool.ReadAllAsync(key, ReadFilters.From(1)))
    foreach (var e in batch.Events)
        order = order.Apply(e);
// `order` now reflects every event ever written to this aggregate
```

To stay current after the initial replay, follow the live tail with a [watch](/guides/subscribing). For a read model that catches up then follows, see [Building a read model](/guides/building-a-projection).
