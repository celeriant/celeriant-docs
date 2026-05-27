---
title: Install a client
---

# Install a client

Pick the client for your runtime. They expose the same operations; see [Clients overview](/clients/overview) for the comparison.

:::info Pre-release
Packages are published with the open-source release. Until then, reference the client projects from the source tree.
:::

## .NET

net8.0 or newer. Once published:

```bash
dotnet add package Celeriant.Client
```

```csharp
using Celeriant.Client;
await using var pool = new CeleriantPool(new CeleriantPoolOptions { Address = "localhost:10000" });
```

See the [.NET client](/clients/dotnet).

## Rust

```toml
[dependencies]
celeriant_client_tokio = "*"   # or celeriant_client_glommio for glommio services
```

```rust
let pool = CeleriantPool::new(PoolOptions::new("localhost:10000"));
```

See the [Rust client](/clients/rust).

## CLI

The `celeriant` binary is also the command-line client and an interactive TUI:

```bash
celeriant read --org 1 --type 1 --id 1 --from 1
```

See the [CLI and TUI](/clients/cli).

Next: [your first aggregate](/get-started/first-aggregate).
