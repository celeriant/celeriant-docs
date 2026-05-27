---
title: CLI and TUI
---

# CLI and TUI

The `celeriant` binary is also the command-line client: one-shot commands for scripts and operations, and an interactive TUI for exploring data and watching streams live.

## Connecting

Every command takes the same connection flags:

```bash
celeriant <command> \
  --server 127.0.0.1:10000 \   # or CELERIANT_SERVER
  --tls --ca-cert ca.crt \
  --client-cert client.crt --client-key client.key \
  --api-key "$CELERIANT_API_KEY"   # or --public-key / --private-key for RSA identity
```

`--server` defaults to `127.0.0.1:10000`. Add `--tls` and the cert flags for a TLS cluster; supply an `--api-key` or an RSA keypair when the server requires [identity](/concepts/identity).

## Commands

```bash
# read events from an aggregate
celeriant read --org 1 --type 1 --id 1 --from 1 [--to 100] \
  [--event-types 1 2] [--format json|table|compact]

# append an event
celeriant write --org 1 --type 1 --id 1 --event-type 1 \
  --data '{"sku":"A-1"}'  [--file payload.json] \
  [--allow-create] [--expected-version 4] [--enforce-idempotency] [--client-id <id>]

# retention
celeriant trim   --org 1 --type 1 --id 1 --keep-from 100
celeriant delete --org 1 --type 1 --id 1 [--allow-recreate] [--expected-version 4]

# inspect
celeriant aggregate-details --org 1 --type 1 --id 1

# discovery (streaming)
celeriant list-orgs        [--format table|json]
celeriant list-types       [--org 1]
celeriant list-aggregates  [--org 1] [--type 1] [--include-deleted]

# schema
celeriant register-schema --org 1 --type 1 --major 1 [--minor 0] \
  --schema-type json --file order.schema.json
```

`write`, `delete`, `trim`, and `register-schema` are leader operations and carry the same correctness controls as the libraries: `--expected-version` for [optimistic concurrency](/guides/handling-conflicts), `--enforce-idempotency` with `--client-id` for [idempotent retries](/guides/idempotency).

## The TUI

Run `celeriant` with no command for the interactive terminal UI: connect, browse orgs and aggregates, read and write events, and watch a stream update live. Watch is TUI-only; the one-shot CLI does not subscribe.

## Utilities

`celeriant dict train` builds a WAL compression dictionary from a corpus. Certificate and API-key generation is done with the server binary's own `cert` and `keys` subcommands, not this client CLI; see [TLS and mTLS](/operations/tls-mtls).
