---
title: Optimistic concurrency
---

# Optimistic concurrency

A write to an aggregate can be conditional: append these events only if the aggregate is still at the version I read. If another writer moved it in the meantime, the write is rejected whole and nothing is appended. This is the operation event sourcing needs and the one Kafka cannot do.

:::note
This is the live, connected write model (Pattern A). Offline clients that buffer events and sync on reconnect use [local-first sync](/concepts/local-first-sync) instead: last-write-wins, no optimistic concurrency. See [the two ways to use it](/introduction/usage-patterns).
:::

## How it works

Every aggregate has a version: the index of its latest event batch. When you read an aggregate you learn its current version. When you write, you pass the version you expect:

```csharp
await pool.WriteAsync(
    key,
    events: [orderShipped],
    expectedVersion: 4,        // commit only if still at version 4
    enforceClientIdempotency: true);
```

If the aggregate is at version 4, the write lands and the aggregate moves to 5. If it is at 5 because someone else already appended, the call throws `OptimisticConcurrencyViolation` ([error 2003](/reference/error-codes)) and the log is untouched. There is no partial write and no lost event.

Omit `expectedVersion` and the write is unconditional: it appends to the end no matter what. Use that only when you genuinely do not care about contention.

A brand-new aggregate has no version yet. Pass `allowCreate: true` to create it on first write. To guarantee you are the one creating it, and not racing another writer who got there first, set `expectedVersion: 0`: that succeeds only when the aggregate does not yet exist.

## The read-retry loop

Conflict handling is mechanical. Read the aggregate, rebuild your state, decide, write with the version you read. On a conflict, do it again:

```csharp
while (true)
{
    var state = await LoadAggregate(key);   // reads the stream, folds state, captures state.Version
    if (!state.CanShip()) throw new InvalidOperationException();

    try
    {
        await pool.WriteAsync(key, [new OrderShipped()],
            expectedVersion: state.Version,
            enforceClientIdempotency: true);
        break;                                       // committed
    }
    catch (WriteOccException)
    {
        // someone else moved the aggregate; loop and re-decide
    }
}
```

A conflict is not an error in your domain; it means the world changed and your decision needs re-checking against the new state. See the [Handling concurrency conflicts](/guides/handling-conflicts) guide.

## Across several aggregates

A single write can carry conditional writes to more than one aggregate, and they commit atomically: all of them, or none. The aggregates must live on the same shard. This is how you enforce an invariant that spans aggregates (a transfer that debits one account and credits another) without a distributed transaction. See [Consistency boundaries](/concepts/consistency-boundaries).

Cross-shard atomic writes are deliberately not supported. If you need them, your shard routing is modelling the wrong boundary.

## Related

- [Idempotent retries](/concepts/idempotent-writes): why retrying a conflicted write is safe.
- [Consistency boundaries](/concepts/consistency-boundaries): what is atomic and what is not.
