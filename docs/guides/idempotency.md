---
title: Implementing idempotent writes
---

# Implementing idempotent writes

Make a write safe to retry, so a timeout never becomes a double-write. See [Idempotent retries](/concepts/idempotent-writes) for the concept.

Two kinds of writer need very different amounts of machinery. Most of this guide covers the harder one: a service (a BFF) doing conditional writes. It follows the reference account service (`celeriant_reference` in the server repo) almost line for line: an HTTP API over Celeriant with a read projection.

The reference ships two interchangeable projection backends, both safe to run as a fleet of replicas behind a load balancer: `account_service_pg.rs` (Postgres read model) and `account_service_mem.rs` (in-memory, each replica folds the stream itself). The write loop is identical in both. Where the dedup bookkeeping differs, this guide shows both.

The easier kind of writer is the [offline client](#the-offline-client), covered at the end. If that is what you are building, most of this machinery falls away.

## Two keys, two owners

There are two idempotency layers, and they are easy to mix up:

- **`ClientSeq` is Celeriant's key.** The server keeps the highest sequence seen per `(aggregate, clientId)` and rejects any write whose lowest sequence is at or below it. This is what stops a retried write from appending twice. It answers one question only: did this sequence already land?
- **`EventId` is your key.** An opaque id you stamp on the event, derived from the request (an HTTP `Idempotency-Key`, an upstream message id). Celeriant stores it and hands it back on replay; it never looks inside it. You use it to recognise your own requests, so a retried request can get back its original response instead of just "yes, that landed".

Celeriant's layer protects the log. Your layer protects the caller. You need both, because "the event is already there" (2002) carries no result, and your caller asked for a result.

## The two prerequisites

1. A **stable client id** per writer. Every write takes it explicitly; the client never invents one. Keep it stable across restarts (treat it like durable service config; see [identity](/concepts/identity)).
2. A **monotonic `ClientSeq`** per event, with `enforceClientIdempotency: true`. Issue sequences in order; a multi-event write is judged by its lowest sequence, so every event in a write must be new.

## Derive the sequence from your own events

`ClientSeq` must survive restarts, so do not mint it from a process-local counter. The reference derives it from the stream itself: the projection stores the last sequence next to its cursor, and catch-up advances both while replaying new batches.

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

The filter is the part people miss. Every writer numbers its own events, so another writer's sequences mean nothing in your space. Track the max over your batches only, then write with `maxClientSeq + 1`.

## The write loop

This is the deposit operation from the reference, whole, because every arm matters:

```csharp
public async Task<WriteResult> Deposit(Guid accountId, int amountCents, Guid requestId)
{
    // catch-up returns fresh state AND answers "did this request already land?"
    var (proj, hit) = await CatchUp(accountId, requestId);
    if (hit is WriteResult done)
        return done;

    long clientSeq = proj.MaxClientSeq + 1;
    bool reDerive = false;

    for (int attempt = 1; attempt <= MaxRetries; attempt++)
    {
        if (attempt > 1)
        {
            await Backoff(attempt);
            (proj, hit) = await CatchUp(accountId, requestId);
            if (hit is WriteResult landed)
                return landed;                     // prior attempt landed; original response rebuilt
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
            // index entry no later than the cursor bump; see Reconstructing the response
            await RecordWrite(accountId, requestId, result, proj.Version, clientSeq);
            return result;
        }
        catch (WriteOccException)
        {
            reDerive = true;     // the world changed: new decision, new sequence
        }
        catch (RequestTimeoutException)
        {
            // ambiguous: hold clientSeq; catch-up at the top refreshes expectedVersion
        }
        catch (InflightDuplicateWriteException)
        {
            // prior attempt accepted but not yet confirmed durable; success now could
            // be a false ack if the leader fails over. Hold clientSeq, back off, retry.
        }
        catch (IdempotencyViolationException)
        {
            // someone landed this sequence: a timed-out prior attempt of OURS, or a
            // sibling request that raced us to the same number. The stream knows which.
            switch (await WhoOwnsSeq(accountId, clientSeq, requestId))
            {
                case SeqOwnership.Ours:                          // prior attempt landed: success
                    (proj, hit) = await CatchUp(accountId, requestId);
                    return hit ?? new WriteResult(proj.BalanceCents, proj.Version);
                case SeqOwnership.Sibling:                       // our event never landed
                    reDerive = true;
                    continue;
                default:                                         // never guess
                    throw new ConflictException("unverifiable; retry the request");
            }
        }
    }

    throw new OccExhaustedException("account was modified concurrently; retries exhausted");
}
```

Walking the arms:

- **Success**: record the result in the dedup index, then bump the projection cursor (guarded, so it never goes backwards). The order matters: the cursor bump stops catch-up replaying this event for anyone, so the index must already hold the answer when it lands. [Reconstructing the response](#reconstructing-the-response) shows what `RecordWrite` is in each projection shape.
- **Conflict (2003)**: the world changed and your write was not applied. This is a new decision: catch up, re-check the business rules against fresh state, take a fresh `ClientSeq`. See [handling conflicts](/guides/handling-conflicts).
- **Timeout**: ambiguous; your write may or may not have landed. Hold the `ClientSeq` and go again. The catch-up at the start of the next attempt also refreshes `expectedVersion`; the next section explains why that matters.
- **Inflight duplicate (2013)**: a prior attempt was accepted but is not yet confirmed durable: still queued before fsync, or fsynced but not yet replicated. Treating it as success now could be a false ack. Hold the `ClientSeq`, back off, retry. It resolves into either 2002 or a clean write.
- **Idempotency violation (2002)**: this sequence already landed, but with concurrent requests sharing one client id, possibly not by you. Read the contested sequence back from the stream. Your `EventId` on it means the prior attempt landed: success. A sibling's means your event never landed: re-derive and go around again. The next two sections explain why.

### Why the timeout arm works

The server checks the version guard **before** idempotency. Follow what that does to a timed-out write that actually landed: the version has moved, so resending the identical request always returns a conflict (2003), never a 2002. Follow the conflict rule and re-derive a fresh sequence, and you deposit twice. That is the exact double-write all of this exists to prevent.

The loop avoids it because every retry catches up first. The `expectedVersion` is fresh; the `ClientSeq` is held. Now the server can give a straight answer. If the prior attempt landed, the guard passes and idempotency returns 2002; once the ownership check below confirms the landed event is yours, you are done. If it never landed, both checks pass and the write lands now.

After a timeout you cannot tell whether the version moved because of your write or someone else's. Hold the sequence, refresh the version, and the server tells you.

**Conflict means re-derive. Timeout means hold the sequence and refresh the version.**

### Why re-deriving on conflict is safe

A 2003 means the server rejected the write. Nothing was appended; your sequence was never used. Taking a fresh one cannot duplicate anything. And you have to take one: if another request on the same client id used your sequence first, the held one will only ever bounce.

The risky case is a timeout followed by a conflict. After the timeout you do not know whether your write landed. Re-derive at that point, and if it had landed, you write it again under a new sequence. The loop guards against this with its ordering: every retry catches up and checks the dedup index before it re-derives. If the earlier attempt landed, the index catches it and returns. Keep that order if you restructure the loop.

Here is why the verification exists. The client id is shared by every concurrent request in the service, so two requests can pick the same sequence. Usually the version guard sorts it out: the loser gets a 2003, not a false "already landed". The exception is a loser whose 2003 was lost to a timeout. It retries the held sequence, which its sibling has meanwhile used, and gets a 2002 about someone else's event. Take that at face value and you report success for a write that never happened.

So a 2002 is never taken at face value. There is no bookkeeping to maintain for this. The stream itself knows who owns the sequence, and a 2002 is an error path, so the read is paid only when something already went wrong. The reference (`verify.rs`) asks with a point read: filter the stream down to the one batch holding the contested sequence and compare its `EventId` to yours.

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

The sequence filters match on batch metadata, so the server skips every other batch without reading its events. If the event is yours, you are done. If a sibling owns it, your event never landed: re-derive and go around again. If the sequence is missing entirely (a single-aggregate 2002 should make this impossible), refuse to guess and return a retryable conflict. A false failure costs a retry; a false success loses the write.

Every event needs an `EventId` for this to work, so the reference mints one per request when the caller does not send an `Idempotency-Key`. And because the answer comes from the stream, it is correct on any replica. No per-instance state to go cold.

## Reconstructing the response

2002 says "already landed" and nothing else. Your caller did not ask whether it landed; they asked for the new balance. This is the `EventId`'s other job: stamp it on the event, and keep a small index keyed `(eventId, aggregateId)` holding the response that write produced, for a recent window (the reference uses 90 seconds).

One rule makes the index safe across a fleet of replicas: **it lives wherever your projection cursor lives, and it moves with the cursor.** Catch-up replays only events newer than the cursor. Once the cursor passes an event, replay never sees it again: whoever advances the cursor must index the event in the same motion, or nobody ever will.

With an **in-memory projection**, each replica folds the stream itself, and the fold maintains the index in the same pass that applies each event (`account_service_mem.rs`):

```csharp
// inside the fold, under the same lock as the cursor. A batch's AGE is
// measured in server time (batch vs tip of this read), so clock skew cannot
// misjudge it; only the REMAINING lifetime runs on the local monotonic clock.
var tipTs = response.EventBatches[^1].ServerTimestamp;
var age = TimeSpan.FromMilliseconds(tipTs - batch.ServerTimestamp);
// ... per event:
balance = Apply(balance, evt);
if (age < DedupWindow && evt.EventId is Guid eid)
    recent[eid] = new Entry(balance, batch.AggregateVersion,
                            expiresAt: clock.Now + (DedupWindow - age));
```

The write path inserts its own entry with the **full** window. The writer's cursor bump means this replica never re-folds its own event, so this entry is the only record it will ever have. Its lifetime must come from the write itself. Derive it from the fold's tip instead, and an idle account's entry is born mostly spent; a retry minutes later double-writes inside the stated window.

A retry landing on any replica is caught: that replica either already folded the original event (index hit), or folds it during this request's own catch-up. Replicas share nothing but the stream.

With a **Postgres projection**, the cursor is shared, so the index must be a table beside it, written atomically with the cursor bump (`account_service_pg.rs`; this is the `RecordWrite` from the loop above):

```sql
WITH proj AS (
    UPDATE account_balances
    SET balance_cents = $1, last_version = $2, last_client_seq = $3, updated_at = now()
    WHERE account_id = $4 AND last_version = $5
)
INSERT INTO request_responses (event_id, aggregate_id, balance_cents, aggregate_version, expires_at)
VALUES ($6, $4, $1, $2, now() + interval '90 seconds')
ON CONFLICT (event_id, aggregate_id) DO UPDATE
SET balance_cents = EXCLUDED.balance_cents,
    aggregate_version = EXCLUDED.aggregate_version,
    expires_at = GREATEST(request_responses.expires_at, EXCLUDED.expires_at);
```

One statement, so no replica can observe the bump without the row. Catch-up's replay loop persists its window the same way, atomically with its own cursor upsert. The lookup costs no extra round trip: it rides the query that already reads the projection row, as a `LEFT JOIN` on `request_responses`.

The half-shared configuration is the broken one. Share the cursor (Postgres) but keep the index per-replica (in memory). Replica A writes the event, indexes it locally, bumps the shared cursor. The retry lands on replica B, whose catch-up starts past the event and replays nothing. B's index is cold, so B derives a fresh `ClientSeq` and deposits again. No error fires anywhere; a re-derived sequence never collides. Share both or share neither.

This index does not prevent double-writes. The server's `(clientId, ClientSeq)` check does that. The index only restores the lost response.

The index stores no request fingerprint, so it cannot tell two different operations apart. Reuse an `Idempotency-Key` for a different operation inside the window and you get the first operation's response back instead of performing the second. A key names one user intent; that is the caller's side of the contract. A production API that cannot trust its callers should store a hash of the request alongside the key and reject reuse with a different payload.

## The 90-second window

The reference's dedup window is 90 seconds, and the index only holds entries younger than that. This is the limit of the request-level guarantee, so know exactly where it ends.

A retry of the same request key arriving after the window finds nothing. The index entry expired, and replay cannot restore it: the projection already folded that event, and catch-up replays only what is newer. The handler derives a fresh `ClientSeq` and writes a **second** event. Celeriant's side held; it really is a new sequence. Your request-level promise is what expired.

Choose the window deliberately:

- **Size the window to the retry source.** 90 seconds covers transport-level retries: your gateway, your HTTP client's backoff. It does not cover a user resubmitting tomorrow.
- **Widen the horizon** if you must honour late retries. In the Postgres shape the index is already a durable table; pushing `expires_at` out is a one-line change you pay for in table size.
- **Scan on miss** as a last resort. The `EventId` is on the event, so a read of the aggregate's recent history can find it, at the cost of that read per miss. Bound the scan with the `minServerTimestamp` filter, anchored on the newest server timestamp your fold has seen minus the window. Never the local clock, for the same skew reason as above.

Whatever you pick, make the window a stated property of your API rather than a surprise.

## Transfers: two aggregates, one request

A transfer writes `TransferredOut` to one account and `TransferredIn` to another in a single write request. The server validates every aggregate in the request (version guard first, then idempotency) before appending anything, so the write is all-or-nothing. You never get one leg.

The machinery extends naturally. Each leg carries its own per-aggregate `ClientSeq`. Both events carry the same request `EventId`.

All-or-nothing is what makes reconstruction work. An index hit on **either** `(eventId, account)` pair proves the whole transfer landed, so on a partial hit (one entry expired) return success and rebuild the missing leg from current state. Do not fall through to the write: it would mint fresh sequences and land a second transfer with no error to catch it.

With no hit on either leg, write. A 2002 there is settled by the point read, with the same all-or-nothing logic: your `EventId` on either leg's sequence proves the transfer landed, a sibling owning a leg proves it did not.

## Scaling out: many replicas, one client id

Everything above already works for a horizontally scaled service: a k8s Deployment behind a load balancer, autoscaled. Two decisions have to be made correctly, and the reference has made both.

**The client id names the service, not the replica.** One config-driven id, shared by every replica (or one service keypair mounted as a Secret, if [identity](/concepts/identity) is enforced). Not one per pod. Never one per request.

- Per request is the expensive trap. The first idempotent write for a `(aggregate, clientId)` pair the server has never seen makes it walk the aggregate's history backwards to find that client's last sequence. For a brand-new client that walk goes all the way back, just to learn "nothing". A fresh client id per request turns every write into that scan and churns the server's per-client cache for everyone else. The `EventId` field exists precisely so you never need this.
- Per pod buys almost nothing. OCC serialises concurrent writers regardless of whose sequence space they use, and the 2002 verification works identically either way. What it costs: the same first-touch scan per pod per aggregate, identity churn as the autoscaler cycles pods, and a lost backstop. Two replicas processing the same retried request concurrently collide on the sequence, and the server rejects one. That collision only happens when they share the id.

**The dedup index obeys the colocation rule.** [Reconstructing the response](#reconstructing-the-response) is the whole fleet-safety story. In-memory projection: every replica folds the stream, so every replica can answer every retry. Postgres projection: cursor and index share a table and move atomically. The one configuration that double-writes is the half-shared one.

Nothing else coordinates. Replicas do not know about each other. The stream (plus, in the Postgres shape, the projection store they already share) is the only common ground, and the error paths resolve against the stream by point read.

Consistent-hash routing by aggregate id is worth adding as an optimisation: each aggregate folds on one replica, memory is not duplicated, index hits stay local. It is not load-bearing. Reshuffles, failovers, and retries landing on the "wrong" replica are absorbed by replay. The `reference_account_service` integration test in the server repo drives two replicas of each shape through cross-replica retries, concurrent duplicates, and sibling races, and pins exactly-once for all of them.

## The offline client

Everything above is the BFF shape. Its hard parts come from two things: concurrent requests sharing one client id, and the version guard sitting in front of idempotency. An offline-first client (mobile app, browser) has neither.

- **The local queue is the outbox.** Assign `ClientSeq` from a local monotonic counter and persist the event with its sequence in one transaction to durable local storage (SQLite on device, IndexedDB in the browser) before any network attempt. A crash or restart re-reads the queue with its numbers intact; nothing is ever renumbered. This is the replay-trap fix below, built in from the start.
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
3. Persist the next sequence with the data the write is generated from, in the same transaction, so crash recovery rereads it.

The wrong pattern is the default one: a runtime counter that does not survive a crash.
