---
title: Celeriant documentation
slug: /
hide_title: true
---

# Celeriant

An append-only event store for the write side of CQRS. Distributed, strictly ordered, built in Rust.

Celeriant enforces business invariants at write time across many streams: optimistic concurrency, idempotent retries, per-aggregate ordering, and cluster-wide durability. 1,057,417 durable writes a second across 60,000 connections, p99 108 ms end-to-end over mTLS, every write fsync'd on both nodes before the ack. See [Performance](/reference/performance).

## Start here

- **[Quickstart](/get-started/quickstart):** run a node and append your first event in five minutes.
- **[What is Celeriant](/introduction/what-is-celeriant):** the problem it solves, and how.
- **[When not to use it](/introduction/when-not-to-use):** read this before you adopt anything.
- **[Concepts](/concepts/event-sourcing):** CQRS, aggregates, events.

:::info Pre-release
Celeriant is pre-1.0. The wire format can still change between releases, and the open-source binaries ship with the Apache-2.0 release. If you need stability today, see [when not to use it](/introduction/when-not-to-use).
:::
