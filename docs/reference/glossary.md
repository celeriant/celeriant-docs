---
title: Glossary
---

# Glossary

Terms as Celeriant uses them. Where another database uses the same word differently, that is noted.

**Aggregate**
: An independent event stream, addressed by `org_id / aggregate_type_id / aggregate_id`. Events within an aggregate are strictly ordered, with no gaps and no concurrent writers. The unit of ordering and of optimistic concurrency.

**Aggregate version**
: The index of an aggregate's latest event batch. What you pass as `expectedVersion` to make a write conditional.

**Event**
: An immutable, typed, ordered fact appended to an aggregate. Carries a payload (opaque bytes), an event type, timestamps, and sequence numbers.

**Event batch**
: Events the server grouped together on write. Each batch has a 1-based index and shared metadata (client id, server timestamp). An aggregate's version is its latest batch index.

**Event type**
: A `(major, minor)` pair. Major is for breaking schema changes, minor for backward-compatible ones. Tied to the [schema registry](/concepts/schemas).

**Client sequence (`ClientSeq`)**
: A per-writer monotonic index for events on an aggregate. With idempotency enabled, the server uses it to reject duplicates. See [Idempotent retries](/concepts/idempotent-writes).

**Optimistic concurrency (OCC)**
: Appending only if the aggregate is still at the version you read. On conflict the write is rejected whole. See [Optimistic concurrency](/concepts/optimistic-concurrency).

**Consistency boundary**
: The set of aggregates a single write commits atomically. In Celeriant that can be several aggregates, as long as they share a shard. See [Consistency boundaries](/concepts/consistency-boundaries).

**Shard**
: A partition of the keyspace owned by one core. An aggregate's shard is `id % shard_count` (a modulo, not a hash), where `id` is the org, type, or aggregate id picked by the routing rule set at cluster init. Ordering and atomic multi-aggregate writes hold within a shard, so the routing rule is how you co-locate aggregates that must be written together.

**Watch**
: A subscription to change notifications as writes land, per aggregate, type, or org. A watch tells you what changed; you then read the new events. See [Watch and subscribe](/concepts/watch).

**Leader / follower**
: The two nodes of a cluster. The leader takes writes and replicates to the follower; both fdatasync before the leader acknowledges. See [Two-node cluster](/operations/two-node-cluster).

**Lease**
: The right to be leader, arbitrated by an S3 conditional write. Failover is a lease handoff. See [Leader election and S3 leases](/operations/leader-election-s3).

**Audit chain**
: A cryptographic hash (BLAKE3) linking each event to its predecessor, making tampering detectable. See [The audit chain](/concepts/audit-chain).

**Projection / read model**
: A queryable view built by folding the event log, kept in a read store like Postgres. The read side of CQRS. See [Building a read model](/guides/building-a-projection).
