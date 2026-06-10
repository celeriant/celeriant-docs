---
title: The audit chain
---

# The audit chain

Every event is hash-chained to the one before it with BLAKE3. Change, insert, or remove a past event and the chain no longer recomputes. Tampering is not prevented, it is made detectable, which is the property an audit trail actually needs.

## How the chain works

Each event's hash is computed over its own contents plus its predecessor's hash. The events form a chain where every link depends on the entire history before it. Alter event 50 and every hash from 50 onward changes; the recomputed chain stops matching the stored one at exactly the point of tampering.

This only means something because the log is [append-only and immutable](/concepts/events-and-the-log). If events could be edited in place and re-hashed, the chain would prove nothing. Immutability enforces it; the chain lets you prove it.

## Verifying

The chain lives inside the write-ahead log, not the read API. The server uses it in one place: divergence detection during replication. When leadership moves or a node rejoins after a partition, the first incoming batch's predecessor hash must match the local chain tip; a mismatch means the logs forked, and walking the chain back finds where. Batches are also checked for internal continuity before they replicate or land in S3. Boot does not re-verify the chain; a node loads its persisted tip and trusts it.

For an audit, pull the log and recompute the chain with a script, comparing against a reference the attacker could not also rewrite: the other node's copy, a backup, or a head hash you recorded elsewhere. A match proves the history intact; the first mismatch localizes the edit. The chain is tamper-evidence, not a signature: it shows that history was altered, not who altered it. See [Verifying the audit chain](/guides/verifying-audit-chain).

## Why it matters

For compliance and forensics, "we believe the records are unaltered" is weaker than "we can prove it." The chain turns the audit log from a thing you trust into a thing you check. It sits alongside the other [durability and safety](/concepts/durability-and-safety) guarantees.
