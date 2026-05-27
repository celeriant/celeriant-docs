---
title: Verifying the audit chain
---

# Verifying the audit chain

The [BLAKE3 chain](/concepts/audit-chain) is maintained inside the write-ahead log: each WAL entry's hash covers its predecessor's hash and the entry's content. It is a property of the stored log, not a field the read API returns, so you do not verify it by reading events with the client.

Verification is operational, and it happens in three places:

- **On boot.** Each node validates its WAL as it recovers it. A broken chain is detected here and surfaced as an error rather than served as if it were intact.
- **Across the two nodes.** The leader and follower hold independent copies of the log. Comparing them detects tampering on one that an attacker did not also make, identically, on the other.
- **Against a backup or an external anchor.** A copy taken before the suspected tampering, or a head hash you recorded in an independent system, is the trusted reference the chain is checked against.

That last point is the whole game: a hash chain detects alteration only relative to something the attacker could not also rewrite. The chain is tamper-evidence, not a signature; it shows that history was altered, not who altered it. If you need third-party-provable integrity, anchor the head somewhere outside Celeriant on a schedule.

:::info Pre-release
There is no client-facing API to recompute or fetch the chain today, and no standalone verifier tool yet. The chain is checked on recovery; a client-side verification path is on the roadmap, and this guide will carry the worked code when it ships.
:::
