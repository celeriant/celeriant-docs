---
title: TLS and mTLS
---

# TLS and mTLS

TLS is off by default and turned on as a mode. Once on, you choose how hard you check the client.

## Turning it on

```bash
celeriant \
  --tls-mode strict \
  --tls-ca-cert    /etc/celeriant/ca.crt \
  --tls-node-cert  /etc/celeriant/node.crt \
  --tls-node-key   /etc/celeriant/node.key \
  --tls-client-auth require
```

`--tls-mode` is `disabled` (plaintext, the default) or `strict` (TLS only, plaintext refused). The node presents `--tls-node-cert` and trusts `--tls-ca-cert`.

## Client auth modes

`--tls-client-auth` decides how the server treats client certificates:

- `require` (default once TLS is on): full mTLS. Clients must present a cert signed by the trusted CA.
- `optional`: verify a cert if one is presented, otherwise allow the connection.
- `none`: server-authenticated TLS only; client certs are not requested.

## Splitting client and cluster trust

By default both the client port and the replication port trust the same CA. To run a separate PKI for cluster-internal traffic, set `--tls-intracluster-ca-cert`: the replication listener then trusts only that CA, while the client listener trusts `--tls-ca-cert`. You can also give the client port its own certificate with `--tls-client-cert` / `--tls-client-key` while replication keeps the node cert.

## Hot reload

`--tls-cert-reload-interval-secs` polls the cert files every N seconds and reloads on change, so you rotate certificates without a restart. It is `0` (off) by default.

## Generating certs and keys

The binary ships the tooling. `celeriant cert` writes a CA and node and client certificates (`ca.crt`, `ca.key`, `node.crt`, `node.key`, `client-<name>.crt` and `.key`); keep every `.key` at mode `0600`. `celeriant keys generate` creates API keys (a primary and secondary, read-write and read-only), stored hashed in `<data-root>/api_keys.toml`. The server never stores or logs a plaintext API key.

## TLS is not identity

mTLS proves the connection is encrypted and the client holds a trusted cert. It does not establish who the client is for idempotency and access control; that is the separate [identity](/concepts/identity) handshake. Enforce it with `--require-client-identity`. If you use API-key identity, you must run with TLS, because keys travel in the clear otherwise; `--insecure-allow-plaintext-auth` lifts that guard for local development only.
