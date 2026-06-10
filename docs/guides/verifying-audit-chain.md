---
title: Verifying the audit chain
---

# Verifying the audit chain

The [BLAKE3 chain](/concepts/audit-chain) is maintained inside the write-ahead log: each WAL entry's hash covers its predecessor's hash and the entry's content. It is a property of the stored log, not a field the read API returns, so you do not verify it by reading events with the client.

What checks it automatically today: replication, and only replication.

- **Divergence detection on failover.** When leadership moves or a node rejoins after a partition, the first incoming batch's predecessor hash must match the local chain tip. A mismatch proves the two logs forked, and the chain walk finds exactly where.
- **Batch continuity.** Replication batches are validated as an unbroken chain before they are applied or uploaded to S3.

What does not happen: a booting node loads its persisted chain tip and trusts it. There is no end-to-end re-verification of history on recovery, no standalone verifier tool, and no client-facing API to fetch or recompute the chain.

For an audit, pull the data and recompute the chain with a script, comparing against a reference the attacker could not also rewrite: the second node's copy of the log, a backup taken before the suspected edit, or a head hash you recorded in an independent system. The chain is what makes that comparison conclusive. And it is tamper-evidence, not a signature: it shows that history was altered, not who altered it. If you need third-party-provable integrity, anchor the head outside Celeriant on a schedule.

:::info Pre-release
A standalone verifier and a client-side verification path are on the roadmap; this guide will carry the worked code when they ship.
:::
