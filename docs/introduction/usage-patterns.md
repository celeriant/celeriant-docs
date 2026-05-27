---
title: Two ways to use it
---

# Two ways to use it

Celeriant supports two write patterns with different consistency models. Pick the one that matches how your clients reach the log, because the choice changes how concurrency is handled and what guarantees you get. If your writers are online backend services, that is Pattern A; reach for Pattern B only when you have offline or edge clients.

## Pattern A: live writes with optimistic concurrency

Your services are online and append events directly to the global log. A write can be conditional: commit only if the aggregate is still at the version you read. That is how you enforce an invariant across concurrent writers at write time. State is reprojected on the read side afterward.

Use it when multiple writers contend for the same aggregates and correctness depends on arbitrating that contention. This is the pattern most of these docs assume. See [Optimistic concurrency](/concepts/optimistic-concurrency).

## Pattern B: local-first, sync on reconnect

Your clients or services write events into a local buffer first, possibly offline, and replay them onto the global log when connectivity returns. There is no optimistic concurrency: every event was already written locally with nothing to contend against, so the merge is last-write-wins.

It fits apps that must keep working offline: a shared canvas where the last colour on each cell wins, a field-data app on a device with no signal, an editor that syncs when the laptop comes back. It also fits per-device or per-user streams and edge services. See [Local-first sync](/concepts/local-first-sync).

## Choosing

| | Pattern A: live + OCC | Pattern B: local-first sync |
| --- | --- | --- |
| Connectivity | online | offline-capable |
| Concurrency control | optimistic, at write time | none; last-write-wins on sync |
| Source of contention | many writers, shared aggregates | each client owns its local stream |
| Typical use | backend services enforcing invariants | apps, devices, edge, collaborative local-first |
| How clients connect | a Celeriant client library (.NET, Rust), over TCP | the local-first HTTP gateway, over HTTP and SSE |

You can run both in one system: backend services on Pattern A, edge and client apps on Pattern B, against the same log.
