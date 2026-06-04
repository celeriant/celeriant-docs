---
title: Implementing idempotent writes
---

# Implementing idempotent writes

Make a write safe to retry, so a timeout never becomes a double-write. See [Idempotent retries](/concepts/idempotent-writes) for the concept.

There are two kinds of writer, and they need very different amounts of machinery. Most of this guide covers the harder one: a service (a BFF) doing conditional writes. It follows the reference account service (`celeriant_reference` in the server repo) almost line for line: an HTTP API over Celeriant, with a Postgres projection for reads. The easier kind is the [offline client](#the-offline-client), covered at the end. If that is what you are building, most of this machinery falls away.

## Two keys, two owners

There are two idempotency layers, and they are easy to mix up:

- **`ClientSeq` is Celeriant's key.** The server keeps the highest sequence seen per `(aggregate, clientId)` and rejects any write whose lowest sequence is at or below it. This is what stops a retried write from appending twice. It answers one question only: *did this sequence already land?*
- **`EventId` is your key.** An opaque id you stamp on the event, derived from the request (an HTTP `Idempotency-Key`, an upstream message id). Celeriant stores it and hands it back on replay; it never looks inside it. You use it to recognise your own requests, so a retried request can get back its *original response* instead of just "yes, that landed".

Celeriant's layer protects the log. Your layer protects the caller. You need both, because "the event is already there" (2002) carries no result, and your caller asked for a result.

## The two prerequisites

1. A **stable client id** per writer. Every write takes it explicitly; the client never invents one. Keep it stable across restarts (treat it like durable service config; see [identity](/concepts/identity)).
2. A **monotonic `ClientSeq`** per event, with `enforceClientIdempotency: true`. Issue sequences in order; a multi-event write is judged by its lowest sequence, so every event in a write must be new.

## Derive the sequence from your own events

`ClientSeq` must survive restarts, so do not mint it from a process-local counter. The reference derives it from the stream itself: the projection row stores the last sequence, and catch-up advances it while replaying new batches.

```csharp
foreach (var batch in response.EventBatches)
{
    version = batch.AggregateVersion;
    bool mine = batch.ClientId == ServiceClientId;     // only your own sequence space counts
    foreach (var evt in batch.Events)
    {
        if (mine && evt.ClientSeq > maxClientSeq)
            maxClientSeq = evt.ClientSeq;
        balance = Apply(balance, evt);
    }
}
```

The filter is the part people miss. Every writer numbers its own events, so another writer's sequences mean nothing in your space. Track the max over *your* batches only, then write with `maxClientSeq + 1`.

## The write loop

This is the deposit operation from the reference, whole, because every arm matters:

```csharp
public async Task<WriteResult> Deposit(Guid accountId, int amountCents, Guid? requestId)
{
    var proj = await CatchUp(accountId);               // projection + replay of new events

    // your idempotency layer: was this request already served?
    if (requestId is Guid rid && cache.TryGet(rid, accountId, out var hit))
        return hit;

    long clientSeq = proj.MaxClientSeq + 1;
    bool reDerive = false;

    for (int attempt = 1; attempt <= MaxRetries; attempt++)
    {
        if (attempt > 1)
        {
            await Backoff(attempt);
            proj = await CatchUp(accountId);           // refreshes the version AND warms the cache
            if (requestId is Guid r && cache.TryGet(r, accountId, out var h))
                return h;                              // prior attempt landed; original response rebuilt
            if (reDerive) { clientSeq = proj.MaxClientSeq + 1; reDerive = false; }
        }

        if (amountCents <= 0)
            throw new ValidationException("Amount must be positive.");
        long newBalance = proj.BalanceCents + amountCents;   // re-decide on fresh state, every attempt

        try
        {
            await pool.WriteAsync(Key(accountId),
                events: [new AggregateEvent
                {
                    ClientSeq      = clientSeq,        // Celeriant's idempotency key
                    EventId        = requestId,        // YOUR idempotency key, carried on the event
                    EventTypeMajor = 1,
                    EventTimestamp = DateTimeOffset.UtcNow,
                    EventValue     = payload,
                }],
                clientId: ServiceClientId,
                expectedVersion: proj.Version,         // fresh from THIS attempt's catch-up
                allowCreate: true,
                enforceClientIdempotency: true);

            var result = new WriteResult(newBalance, proj.Version + 1);
            // Caches before the projection bump: the bump kills the replay path
            // for same-key siblings, so the cache must already answer by then.
            if (requestId is Guid r2)
            {
                cache.Set(r2, accountId, result);
                cache.SetSeqOwner(accountId, clientSeq, r2);
            }
            await UpdateProjectionOptimistically(accountId, result, proj.Version, clientSeq);
            return result;
        }
        catch (WriteOccException) when (attempt < MaxRetries)
        {
            reDerive = true;     // the world changed: new decision, new sequence
        }
        catch (RequestTimeoutException) when (attempt < MaxRetries)
        {
            // ambiguous: hold clientSeq; catch-up at the top refreshes expectedVersion
        }
        catch (InflightDuplicateWriteException) when (attempt < MaxRetries)
        {
            // prior attempt fsynced but not yet confirmed replicated; success now could
            // be a false ack if the leader fails over. Hold clientSeq, back off, retry.
        }
        catch (IdempotencyViolationException)
        {
            // someone landed this sequence: a timed-out prior attempt of OURS, or a
            // sibling request that raced us to the same number. Verify before claiming success.
            proj = await CatchUp(accountId);
            if (requestId is Guid r3 && cache.TryGet(r3, accountId, out var h2))
                return h2;                                  // ours: original response rebuilt
            var owner = cache.SeqOwner(accountId, clientSeq);
            if (owner == requestId)
                return new WriteResult(proj.BalanceCents, proj.Version);  // ours
            if (owner is not null) { reDerive = true; continue; }         // a sibling took it
            throw new ConflictException("unverifiable; retry the request"); // never guess
        }
    }

    throw new OccExhaustedException("account was modified concurrently; retries exhausted");
}
```

Walking the arms:

- **Success**: warm the caches, then update the projection optimistically (guarded, so it never goes backwards). The order matters: the projection bump is what stops catch-up replaying this event for anyone else, so the cache must already hold the answer when it lands.
- **Conflict (2003)**: the world changed and your write was not applied. This is a new decision: catch up, re-check the business rules against fresh state, take a fresh `ClientSeq`. See [handling conflicts](/guides/handling-conflicts).
- **Timeout**: ambiguous; your write may or may not have landed. Hold the `ClientSeq` and go again. The catch-up at the start of the next attempt also refreshes `expectedVersion`; the next section explains why that matters.
- **Inflight duplicate (2013)**: a prior attempt is fsynced but not yet confirmed replicated. Treating it as success now could be a false ack. Hold the `ClientSeq`, back off, retry; it resolves into either 2002 or a clean write.
- **Idempotency violation (2002)**: this sequence already landed. Was it your event or a sibling's? Verify, then either return the response (yours), re-derive and go around again (a sibling took your number), or refuse to guess. The next two sections explain why.

### Why the timeout arm works

The server checks the version guard **before** idempotency. Follow what that does to a timed-out write that actually landed: the version has moved, so resending the identical request always returns a conflict (2003), never a 2002. If you then follow the conflict rule and re-derive a fresh sequence, you deposit twice. That is the exact double-write all of this exists to prevent.

The loop avoids it because every retry catches up first. The `expectedVersion` is fresh; the `ClientSeq` is held. Now the server can give a straight answer. If the prior attempt landed, the guard passes and idempotency returns 2002: done. If it never landed, both checks pass and the write lands now. The point: after a timeout you cannot tell whether the version moved because of your write or someone else's. Hold the sequence, refresh the version, and the server tells you.

The rule in one line: **conflict means re-derive; timeout means hold the sequence and refresh the version.**

### Why re-deriving on conflict is safe

A 2003 means the server rejected the write. Nothing was appended; your sequence was never used. Taking a fresh one cannot duplicate anything. And you have to take one: if another request on the same client id used your sequence first, the held one will only ever bounce.

The risky case is a timeout followed by a conflict. After the timeout you do not know whether your write landed. Re-derive at that point, and if it had landed, you write it again under a new sequence. The loop guards against this with its ordering: every retry catches up and checks the request cache *before* it re-derives. If the earlier attempt landed, the cache check catches it and returns. Re-derive only runs after that. Keep that order if you restructure the loop.

Here is why the verification exists. The client id is config-driven and shared by every concurrent request in the service, so two requests can pick the same sequence. Usually the version guard sorts it out: the loser gets a 2003, not a false "already landed". The exception is a loser whose 2003 was lost to a timeout. It retries the held sequence, which its sibling has meanwhile used, and gets a 2002 about someone else's event. Take that at face value and you report success for a write that never happened.

So a 2002 is never taken at face value. The reference keeps a second small map, `(aggregate, clientSeq) -> EventId`, warmed during catch-up replay and on every successful write. On a 2002, look up who owns the sequence. Yours: done. A sibling's: your event never landed, re-derive and go around again. Unknown: refuse to guess and return a retryable conflict. A false failure costs a retry; a false success loses the write. For this to work every event needs an `EventId`, so the reference mints one per request when the caller does not send an `Idempotency-Key`.

## Reconstructing the response

2002 says "already landed" and nothing else. Your caller did not ask whether it landed; they asked for the new balance. This is the `EventId`'s job: stamp it on the event, and keep a small cache keyed `(eventId, aggregateId)` holding the response that write produced.

Two things populate the cache:

- the handler itself, after a successful write (covers same-instance retries immediately);
- catch-up, which warms it for any replayed event that carries an `EventId` and is recent:

```csharp
// age batches against the tip of this read, in server time. Comparing against the
// local clock would let skew silently disable warming.
var tipTs = response.EventBatches[^1].ServerTimestamp;
bool warm = tipTs - batch.ServerTimestamp < CacheTtl;
// ... inside the replay loop:
if (warm && evt.EventId is Guid eid)
{
    cache.Set(eid, accountId, new WriteResult(balance, batch.AggregateVersion));
    if (mine) cache.SetSeqOwner(accountId, evt.ClientSeq, eid);   // who owns this sequence
}
```

The replay path covers a retry that lands on a *different* instance, or on the same instance after a crash. The event is in the stream, catch-up replays it, the cache fills, and the retried request returns the original result without writing anything.

Again: this cache does not prevent double-writes. The server's `(clientId, ClientSeq)` check does that. The cache only restores the lost response.

## The 90-second window

The reference cache TTL is 90 seconds, and the warm-on-replay above only fires for batches younger than that. This is the limit of the request-level guarantee, so know exactly where it ends.

A retry of the same request key arriving after the TTL finds nothing. The cache entry expired, and catch-up cannot re-warm it: the projection already folded that event, and catch-up replays only what is newer. The handler then derives a fresh `ClientSeq` and writes a **second** event. Celeriant's side held (it really is a new sequence). Your request-level promise is what expired.

Choose the window deliberately:

- **Size the TTL to the retry source.** 90 seconds covers transport-level retries: your gateway, your HTTP client's backoff. It does not cover a user resubmitting tomorrow.
- **Persist the mapping** if you must honour late retries: store `(eventId, result)` durably next to the projection instead of in memory.
- **Scan on miss** as a last resort: the `EventId` is on the event, so a read of the aggregate's history can find it, at the cost of that read.

Whatever you pick, make the window a stated property of your API rather than a surprise.

## Transfers: two aggregates, one request

A transfer writes `TransferredOut` to one account and `TransferredIn` to another in a single write request. The server validates every aggregate in the request (version guard first, then idempotency) before appending anything, so the write is all-or-nothing; you never get one leg.

The idempotency machinery extends naturally. Each leg carries its own per-aggregate `ClientSeq`. Both events carry the *same* request `EventId`. Response reconstruction needs a cache hit on **both** `(eventId, account)` pairs before trusting it; on a partial hit, fall back to catching up both accounts and returning their current state.

## The offline client

Everything above is the BFF shape. Its hard parts come from two things: concurrent requests sharing one client id, and the version guard sitting in front of idempotency. An offline-first client (mobile app, browser) has neither.

- **The local queue is the outbox.** Assign `ClientSeq` from a local monotonic counter and persist the event *with* its sequence in one transaction to durable local storage (SQLite on device, IndexedDB in the browser) before any network attempt. A crash or restart re-reads the queue with its numbers intact; nothing is ever renumbered. This is the replay-trap fix below, built in from the start.
- **One client id, one thread.** The client id is the device's [identity](/concepts/identity), and a single sync loop drains the queue in order. With no sibling requests sharing the id, a 2002 can only ever refer to your own event: no `EventId` verification, no false-success edge.
- **No version guard on sync.** Offline writes are unconditional (no `expectedVersion`); conflicts are resolved in the projection instead (see [the offline exception](/concepts/reads-and-ordering#the-offline-exception)). With no OCC check in front, the 2003 arm does not exist, so the re-derive rule does not exist. Hold the sequence is the only rule left.

The whole sync loop is:

1. Take the next unsynced event (or a run of them, in order) from the local queue.
2. Write with `enforceClientIdempotency: true` and no `expectedVersion`.
3. Success or 2002: mark the events synced locally and advance. A 2002 here just means a previous ack got lost; the events are in the log.
4. Timeout: resend the same events with the same sequences.
5. Inflight duplicate (2013): back off, resend the same.

Note what disappeared. No catch-up before each attempt: there is no version to refresh. No response reconstruction: the client's own state lives locally, and the server's ack just means "synced". No 90-second window: the local queue holds the dedup state for as long as it takes. Marking events synced does not even need to be atomic with the ack: crash after the ack but before the mark, and the restart resends, gets a 2002, and marks it then.

One rule still applies: a multi-event write is checked by its lowest sequence, so sync in queue order and never skip ahead.

## The replay trap

All of the above assumes one logical event maps to one stable `ClientSeq`. Restarts break that if you regenerate sequences from scratch on boot: an outbox worker that crashes mid-batch and renumbers from a reset counter re-issues already-written events under fresh sequences, and dedup never fires. `ClientSeq` must be deterministic from durable state, never from a counter you bump per attempt. Three patterns that work:

1. Derive it from the stream, as this guide does: your own max sequence is recoverable by replay, and the projection persists it between catch-ups.
2. Derive it from a persistent upstream source: the outbox row's primary key, the upstream message id.
3. Persist the next sequence *with* the data the write is generated from, in the same transaction, so crash recovery rereads it.

The wrong pattern is the default one: a runtime counter that does not survive a crash.
