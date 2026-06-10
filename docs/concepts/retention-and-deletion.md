---
title: Retention and deletion
---

# Retention and deletion

The log is [append-only](/concepts/events-and-the-log): you never edit an event in place. But "append-only" does not mean "grows forever and nothing can ever be removed." Two operations remove data, and they are how you bound storage and honor erasure.

## Trim

`TrimStart` drops a prefix of an aggregate's events, keeping everything from a version onward. You give it `KeepFromAggregateVersion`; events before that become unreadable, and reads start from there.

Use it for retention: an aggregate whose early history no longer matters keeps a bounded tail. Trimming does not rewrite the events that remain; it removes old ones.

## Delete

`Delete` removes a whole aggregate. Two flags decide what may happen after:

- `AllowRecreate`: whether the same key can be written again as a new aggregate.
- `AllowSequenceContinuation`: if recreated, whether its event sequence continues from where the deleted one left off, or restarts.

Delete is guarded by `ExpectedVersion` like any conditional write, so you do not race a concurrent writer.

## Logical now, physical later

Trim and delete are soft: they append a tombstone that makes the events unreadable to clients immediately, but the original bytes stay on disk until compaction rewrites the segment and drops them. Compaction runs in the background, gated by `--compaction-check-interval-secs` (2 hours by default) and a minimum reclaimable ratio (20% by default). So reclamation is deferred and conditional: a low-churn segment holding one subject's data can sit on disk for a while after the delete.

## PII and the right to erasure

Model for erasure up front: keep an entity's PII in its own aggregate (a `user-profile` stream holding name, email, address) and reference it by id from business events. Erasure is then one `Delete` of that aggregate; the order history stays intact and useful. Scatter PII through business events instead and you cannot redact it, because the log is immutable. The only path left is deleting whole streams you wanted to keep.

For the erasure itself, the logical-physical distinction matters: delete and trim make the events unreadable at once, but the bytes are physically gone only after compaction. For a hard erasure deadline, force or await compaction rather than assuming the delete reclaimed the disk, and account for two more things:

- **Other copies.** A two-node cluster has the data on both nodes, S3 may hold transient fallback batches, and you may have taken [backups](/operations/backup-recovery) or run downstream consumers. Erasure has to reach those too; the store removes its copies, not the ones you exported.
- **Crypto-shredding as an alternative.** If you [encrypt](/concepts/encryption) a subject's events under a per-subject key, destroying that key renders the events unreadable everywhere at once, including in backups, without rewriting the log. For targeted erasure across copies you do not control, this is often cleaner than chasing every replica.

## The audit-chain tension

Deletion shrinks the log; it does not edit history within a retained range, so the [audit chain](/concepts/audit-chain) over what remains still verifies. What hash-chaining does not do is stop a stream being deleted wholesale, which is exactly what makes erasure possible. Tamper-evidence within a stream and the ability to erase a stream are different properties, and Celeriant gives you both.
