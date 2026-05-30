---
title: Sticky routing and ordering
---

# Sticky routing and ordering

Two orthogonal mechanisms:

1. **Sticky parallel routing.** Partition by `partition_key`. Same-key messages route to the same consumer in a group. Different keys route to different consumers. Scales horizontally.
2. **`ordering_required`.** At most one consumer with outstanding leases. Strict serialised processing. Pulsar's "Exclusive" flavor. Does not scale beyond one consumer.

You usually want sticky. You occasionally want `ordering_required`. You never want both. `ordering_required` makes the sticky filter moot.

## Sticky routing

Producers attach a `partition_key: Option<u128>` on each message. The projection hashes it with blake3 and takes the first 2 bytes little-endian. A `u16` ring slot in `0..=0xFFFF`.

Consumers register ranges with `AssignRange { range_lo, range_hi, consumer_group_id, consumer_id }`. The handler emits a `RangeAssign` control event. The fold appends the assignment.

`plan_consume` for a consumer in a group:

1. Walks versions from `trim_cursor` to `message_tail_version`.
2. For each version with a partition_key, looks up the assigned consumer for that ring slot.
3. Returns only versions whose ring slot is in a range owned by the asking `(group, consumer)`.

Versions with `partition_key = None` (the producer didn't set one) are eligible to any consumer in the group.

## The draining protocol

When you reassign a range from consumer A to consumer B, A may still hold live leases on versions whose partition_key falls in that range. Without coordination, B could start consuming the same partition while A is still processing. Out-of-order delivery within a key.

Celeriant Queue handles this with a mandatory drain. On `RangeAssign` to a new owner, the fold records `pending_reassignments[range] = prior_owner`. The new owner's plan_consume is blocked from versions in that range until A's last in-range lease drains (Ack, Nack, or expiry).

The integration test `sticky_range_reassign_drains_before_new_owner_consumes` is the canonical demonstration. A holds 3 leases, range reassigns to B, B's consume returns empty until A acks, then B can claim a new partition_key'd message.

## `ordering_required`

Set `ordering_required = true` in `QueueConfig`. `plan_consume` enforces: if ANY other consumer has a live lease OR a pending Lease write in flight, return empty.

The "pending Lease write" check is load-bearing. Two consumers can race plan_consume on separate connections. If you only checked folded leases, both could pass the gate and both get assignments before either Lease event has committed. The projection tracks `pending_lease[version] = consumer_id` so the second consumer's plan_consume sees the first's reservation and bails. See [INVARIANTS.md](https://github.com/celeriant/celeriant-queue/blob/main/docs/INVARIANTS.md) #23 and #37.

When `ordering_required = true`, `dlq_strategy = Skip` is rejected at queue creation. A skip would let a later message overtake the head-of-line position. The valid choices are `Block` or `BlockAndDlq`. Both stop the line and preserve strict order.

## Choosing

1. **No ordering requirement, many keys, want throughput.** Sticky routing across N consumers. The default. Read [DLQ and poison handling](/queue/dlq-and-poison) for Skip vs Block.
2. **Strict serial processing (a command stream for a state machine).** `ordering_required = true`, one consumer at a time, `dlq_strategy = BlockAndDlq` so a poison message stops the line AND gets archived.
3. **Partition-level ordering (per-key ordering, parallel across keys).** Sticky routing. Same partition_key always lands on the same consumer. The draining protocol preserves order across rebalances.
