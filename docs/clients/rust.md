---
title: Rust client
---

# Rust client

Use `celeriant_client_tokio` for async services on tokio.

## Connect (tokio)

The pool is built from a fluent `PoolOptions`:

```rust
let pool = CeleriantPool::new(
    PoolOptions::new("localhost:10000")
        .with_seed_addresses(vec!["node2:10000".into()])
        .with_max_connections(10)
        .with_route_reads_to_followers(false),
);
```

Note the defaults differ from the .NET client: connection and request timeouts are **2 seconds** here, not 5 and 30. Raise them with `.with_request_timeout(...)` if your operations need longer.

## Operations

The `CeleriantPoolApi` trait is the surface:

```rust
pool.read(request).await?;
pool.write(request).await?;
pool.delete(request).await?;
pool.trim_start(request).await?;
pool.aggregate_details(request).await?;
pool.register_schema(request).await?;
pool.watch(request, options).await?;

// convenience for the common single-aggregate write
pool.write_events(aggregate_key, events, client_id).await?;
pool.write_events_with(aggregate_key, events, client_id, WriteEventsOptions {
    allow_create: true,
    expected_version: Some(version),   // optimistic concurrency
    enforce_client_idempotency: true,
}).await?;
```

`expected_version` is the OCC guard (the .NET client spells the same thing `expectedVersion`). `client_id` is a `u128` and every write takes it explicitly; the client never invents one. Keep it stable for [idempotency](/guides/idempotency). Request and response types come from `celeriant_msg` and mirror the other clients, with `u128` where .NET uses `Guid`.

## Errors

No exceptions; every call returns `Result<T, ClientError>`. `ClientError` distinguishes the cases you handle:

```rust
match pool.write(request).await {
    Ok(_) => {}
    Err(ClientError::NotLeader { .. }) => { /* pool retries; surfaced if exhausted */ }
    Err(ClientError::IdentityRequired) => { /* identify first */ }
    Err(ClientError::Server(server)) => { /* inspect `server` for OCC, idempotency, schema, etc. */ }
    Err(e) => return Err(e.into()),
}
```

## TLS and identity

`ClientTlsConfig::new(client_config, server_name)` wires rustls; `ClientIdentityConfig::from_api_key(...)` or `::from_key_pair(public, private)` set identity, attached with `PoolOptions::with_tls` / `with_identity`. See [Identity and authentication](/concepts/identity).
