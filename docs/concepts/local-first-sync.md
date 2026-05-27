---
title: Local-first sync
---

# Local-first sync

Most of these docs assume your services are online and append to the global log directly, arbitrating concurrent writers with [optimistic concurrency](/concepts/optimistic-concurrency). Local-first sync is the other write model: write locally first, sync later. It is one of the [two ways to use Celeriant](/introduction/usage-patterns).

## How it works

1. Each client or service keeps a local event buffer: in the browser, on the device, or in a per-service store. Writes go there first, so the app stays responsive even with no network.
2. When connectivity returns, the buffered events are replayed onto the global Celeriant log.
3. Reading the merged log back converges local state with everyone else's.

## No optimistic concurrency, by design

OCC exists to arbitrate concurrent writers fighting over one aggregate at write time. In the local-first model there is no write-time contention: the writer was offline and alone when it produced its events. Reconciliation happens at sync time instead, and the rule is last-write-wins.

If your domain needs richer conflict resolution than last-write-wins, that is application logic you build on top of the log (CRDTs, domain merges, whatever fits), not something the write path enforces. Celeriant gives you an ordered, durable log to build that on; it does not impose a merge policy beyond last-write-wins.

## The gateway

`celeriant-localfirst` is the HTTP and Server-Sent-Events gateway built for this pattern. Browser and edge clients talk to it over HTTP, each with its own [identity](/concepts/identity), and it reads, writes, and streams changes from the global log on their behalf. A collaborative canvas, an offline-first field app, or a per-user document all sit naturally on top of it.

## When to use it

Offline-capable apps, per-device or per-user streams, collaborative local-first tools, and edge or intermittently-connected services. If your writers are online backend services contending over shared aggregates, you want [Pattern A](/concepts/optimistic-concurrency) instead.

:::info Pre-release
The local-first gateway is functional and end-to-end tested, but pre-1.0 like the rest of Celeriant. The HTTP surface can still change.
:::
