---
title: Clients overview
---

# Clients overview

Celeriant speaks a binary protocol over TCP, with optional TLS and mTLS. You talk to it through a client library or the CLI; you do not hand-craft the wire format.

## What's official

| | Language / runtime | Best for |
| --- | --- | --- |
| **.NET client** | net8.0+ | Application services on .NET. The most complete and most documented client. |
| **Rust client (tokio)** | Rust, tokio | Async Rust services; pooled, multi-node aware. |
| **Rust client (glommio)** | Rust, glommio | Thread-per-core Rust services that already run on glommio. |
| **CLI / TUI** | any (native binary) | Operations, debugging, scripts, and an interactive terminal UI. |

## Feature matrix

Every client covers the core operations; the differences are at the edges.

| | .NET | Rust (tokio) | Rust (glommio) | CLI |
| --- | :--: | :--: | :--: | :--: |
| Write / read / delete / trim | yes | yes | yes | yes |
| Aggregate details | yes | yes | yes | yes |
| Register schema | yes | yes | yes | yes |
| Streaming list (orgs / types / aggregates) | yes | yes | yes | yes |
| Streaming read (auto-paginate) | yes | yes | yes | no |
| Watch (live subscribe) | yes | yes | yes | TUI only |
| Optimistic concurrency + idempotency | yes | yes | yes | yes |
| TLS / mTLS | yes | yes | yes | yes |
| API key + RSA-keypair identity | yes | yes | yes | yes |
| Compression | automatic | automatic | automatic | automatic |
| Route reads to followers | yes | yes | yes | no |

## Which one

- Building a service: the **.NET** or **Rust (tokio)** client. Both pool connections, follow leader redirects, and expose the same operations.
- Already thread-per-core on glommio: the **glommio** client, to stay on one runtime.
- Operating, scripting, or poking at data: the **CLI**, with the **TUI** when you want to watch a stream live.

Pick the client for your runtime; the concepts are identical across all of them. The pages here cover the [.NET client](/clients/dotnet), the [Rust client](/clients/rust), and the [CLI and TUI](/clients/cli).

:::info Pre-release
Packages are published with the open-source release. Until then you build the clients from the source tree.
:::
