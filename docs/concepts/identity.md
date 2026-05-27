---
title: Clients and identity
---

# Clients and identity

A client's identity is load-bearing: it is the `client` half of the `(aggregate, client)` key that makes [retries idempotent](/concepts/idempotent-writes), and it is what [access control](/reference/error-codes) is checked against. Identity is who the client is. It is separate from [mTLS](/operations/tls-mtls), which secures the transport but does not say who is on the other end.

## Two ways to identify

**API key.** A shared secret the client sends; the server checks it against a stored hash. Keys can be read-write or read-only. Simplest to operate; rotate it like any secret.

**Public key.** The client holds a keypair and proves possession by signing a server nonce on connect. The client's id is derived deterministically from its public key, so the same key always maps to the same client id. No registration step: present a new public key and you are a new client.

## Keep your client id stable

This is the part that bites people. Idempotency tracks the highest sequence number it has seen per `(aggregate, client)`. If a writer's identity changes (a regenerated key, a fresh ephemeral key per process), the server sees a new client, the idempotency history does not apply, and a retried write can land twice.

So: a long-lived backend writer should hold a stable key (or a stable API key) across restarts. Treat it like any other piece of durable service config.

## Local-first clients

In the [local-first pattern](/concepts/local-first-sync), each browser or edge client typically generates its own keypair, so each one is its own identity with its own per-aggregate sequence. That is usually what you want: every device owns its stream.

## When it goes wrong

The identity handshake surfaces as the `Identify*` [error codes](/reference/error-codes) (10001-10004): an expired nonce, a signature that does not verify, a `clientId` in a write that does not match the identified client, or identity required but not sent.

:::info Pre-release
The identity model is functional but pre-1.0; the handshake details can still change.
:::
