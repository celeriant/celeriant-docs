---
title: Upgrading
---

# Upgrading

A two-node cluster upgrades with no read downtime by taking one node at a time. Reads never stop; writes pause once, briefly, at the single leader handoff. You fail over to the node you leave running, replace the other, let it catch up and rejoin, then repeat.

## Rolling upgrade

1. Confirm the cluster is healthy: exactly one `celeriant_node_role` reporting leader, no replication pressure. See [Monitoring](/operations/monitoring).
2. Stop the **follower**. The leader keeps serving; while the follower is down it replicates to S3, so writes stay durable (at higher latency).
3. Replace the follower's binary and start it. It reads the lease, pulls what it missed, and rejoins.
4. Wait until it has caught up and replication pressure is back to zero.
5. Now stop the **leader**. The follower takes the lease and becomes leader once the old lease expires, up to the S3 lease TTL (`--s3-lease-duration-ms`, 30 s by default). This is the one write pause in the procedure; reads continue on the follower throughout.
6. Replace and restart the old leader; it rejoins as the follower.

Doing the follower first means only one failover happens, in step 5, and it is a clean lease handoff.

## Single node

A standalone node cannot upgrade without a write outage, because there is no second node to fail over to. Stop it, replace the binary, start it; it validates and replays its WAL on boot. Plan the window.

## Before you upgrade across versions

:::warning Pre-release
Celeriant is pre-1.0. The wire format and on-disk format can change between releases, and there is no backward-compatibility guarantee yet. Do not assume a new node reads an old node's WAL, or that an old client talks to a new server. Read the release notes for each version, test the upgrade on a copy, and keep a [backup](/operations/backup-recovery) you have restored at least once. Mixed-version clusters are not supported during the rolling step beyond the brief window of the restart itself.
:::

Once there is a 1.0 with a stability guarantee, this section gets the compatibility matrix it deserves.
