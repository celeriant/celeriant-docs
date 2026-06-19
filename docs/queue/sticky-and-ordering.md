---
title: Sticky routing and ordering
---

# Sticky routing and ordering

Two mechanisms with very different status:

1. **`ordering_required`.** SHIPPED. At most one consumer with outstanding leases. Strict serialised processing. Pulsar's "Exclusive" flavor. Does not scale beyond one consumer.
2. **Sticky parallel routing.** ROADMAP, not shipped for v1. Partition by `partition_key`, same-key messages to the same consumer in a group, parallel across keys. The wire verb and the projection machinery exist but carry unfixed correctness holes (below). Do not build on it yet.

If you need ordering today, use `ordering_required`. Sticky parallel returns in the scale phase.

## Sticky routing (roadmap)

::::warning Parked for v1, do not rely on it
Sticky parallel routing is parked by the CHARTER for v1. The `AssignRange` verb, the `partition_key` field, and the drain-on-reassignment fold are all present in the code, but three correctness holes are open and unfixed:

- **Drain deadlock.** A range's drain check never tests lease expiry, so a dead prior owner's expired lease wedges the range forever.
- **Range-split bypass.** Prior-owner detection is exact-bounds equality; splitting a range triggers no drain, so stale assignments accumulate.
- **Consumer identity ignores the group.** The ordering/drain identity compares the bare `consumer_id` and ignores `consumer_group_id`.

These get fixed together when sticky returns. The design below is recorded so the intent is clear, not as a feature you can depend on.
::::

The intended design:

Producers attach a `partition_key: Option<u128>` on each message. The projection hashes it with blake3 and takes the first 2 bytes little-endian. A `u16` ring slot in `0..=0xFFFF`.

Consumers register ranges with `AssignRange { range_lo, range_hi, consumer_group_id, consumer_id }`. The handler emits a `RangeAssign` control event. The fold appends the assignment.

`plan_consume` for a consumer in a group:

1. Walks versions from `trim_cursor` to `message_tail_version`.
2. For each version with a partition_key, looks up the assigned consumer for that ring slot.
3. Returns only versions whose ring slot is in a range owned by the asking `(group, consumer)`.

Versions with `partition_key = None` (the producer didn't set one) are eligible to any consumer in the group.

## The draining protocol (intended)

When you reassign a range from consumer A to consumer B, A may still hold live leases on versions whose partition_key falls in that range. Without coordination, B could start consuming the same partition while A is still processing. Out-of-order delivery within a key.

The intended design is a mandatory drain. On `RangeAssign` to a new owner, the fold records `pending_reassignments[range] = prior_owner`. The new owner's plan_consume is blocked from versions in that range until A's last in-range lease drains (Ack, Nack, or expiry).

This is exactly where the open holes live: the drain check never tests lease expiry (deadlock on a dead prior owner), and a range split slips past the exact-bounds prior-owner check entirely. Until those are fixed, the drain does not hold under reassignment, which is why sticky parallel is parked.

## `ordering_required`

Set `ordering_required = true` in `QueueConfig`. `plan_consume` enforces: if ANY other consumer has a live lease OR a pending Lease write in flight, return empty.

The "pending Lease write" check is load-bearing. Two consumers can race plan_consume on separate connections. If you only checked folded leases, both could pass the gate and both get assignments before either Lease event has committed. The projection tracks `pending_lease[version] = consumer_id` so the second consumer's plan_consume sees the first's reservation and bails. See [INVARIANTS.md](https://github.com/celeriant/celeriant-queue/blob/main/docs/INVARIANTS.md) #23 and #37.

When `ordering_required = true`, `dlq_strategy = Skip` is rejected at queue creation. A skip would let a later message overtake the head-of-line position. The valid choices are `Block` or `BlockAndDlq`. On an `ordering_required` queue both HALT the line: `plan_consume` stops at the blocked head and delivers nothing past it until you send `Unblock`. Strict order preserved. Note this halt is specific to `ordering_required` — on a plain queue, Block only pins trim and skips the blocked version while later messages keep flowing. See [DLQ and poison handling](/queue/dlq-and-poison).

## Choosing

What you can rely on today:

1. **No ordering requirement, want throughput.** Plain queue, fan out across N consumers in the group, no `partition_key`. Read [DLQ and poison handling](/queue/dlq-and-poison) for Skip vs Block.
2. **Strict serial processing (a command stream for a state machine).** `ordering_required = true`, one consumer at a time, `dlq_strategy = BlockAndDlq` so a poison message stops the line AND gets archived.

Partition-level ordering (per-key ordering, parallel across keys) is what sticky routing is for. It is parked for v1 — see the warning above. Until it ships, the only in-order option is `ordering_required`, which serialises the whole queue, not per key.
