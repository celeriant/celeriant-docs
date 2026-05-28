---
title: Modeling aggregates and event types
---

# Modeling aggregates and event types

Two decisions shape everything downstream: where you draw the aggregate boundary, and how you version event types. Get them roughly right up front; both are expensive to change later.

## Drawing the aggregate boundary

An [aggregate](/concepts/aggregates) is the unit of ordering and of [optimistic concurrency](/concepts/optimistic-concurrency). The rule of thumb: an aggregate is the smallest thing that has an invariant to protect. One order, one account, one device, one game match.

- **Too big** (one aggregate per tenant): every write to anything in that tenant contends on one version, and you serialize unrelated work.
- **Too small** (splitting one logical thing across aggregates): an invariant that should be one atomic write now spans aggregates, and you depend on them sharing a [shard](/concepts/consistency-boundaries) or on coordination you did not want.

Aim for the boundary that makes your common write a single-aggregate, conditional write.

## Routing and co-commit

If two aggregates must sometimes change together atomically (accounts in a transfer, a hold and a draft on one customer), they must land on the same shard. The server's `--routing-rule` decides which `id` is fed into `id % num_shards`:

- `org_id`: a tenant's aggregates all share a shard. Default choice when invariants are per-tenant.
- `aggregate_type_id`: a type's aggregates all share a shard. Useful if you co-commit across types of the same kind.
- `aggregate_id`: each aggregate is routed independently. You can still co-commit, but only between ids you have deliberately chosen so `a % shards == b % shards`. Random UUIDs will scatter and break this.

Pick the rule that lines up with the invariants you actually enforce together, *then* design your id allocator to match. The trap people fall into: keep the default `aggregate_id` routing, allocate ids with UUIDs, then discover months later that no multi-aggregate write ever lands. See [Consistency boundaries](/concepts/consistency-boundaries) and [Atomic multi-aggregate writes](/guides/multi-aggregate-writes).

## Versioning event types

An event type is a `(major, minor)` pair. Pick a discipline and hold it:

- **minor** bump for a backward-compatible change: a new optional field that old consumers can ignore.
- **major** bump for a breaking change: a removed or retyped field. Old and new majors coexist in the log; your consumers handle both until you have migrated them.

Register a [schema](/concepts/schemas) per `(type, major, minor)` so the server enforces the shape. Treat event types as a published contract, because once an event is in the log it is there forever; you cannot edit history, only append a new version and migrate forward.

## Keep payloads as facts

Model events as things that happened (`OrderShipped`), not as commands or CRUD diffs (`SetStatus`). A log of facts replays into any read model you later decide you need; a log of setters locks you into the one projection you imagined on day one.
