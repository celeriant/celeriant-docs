---
title: Identity and authentication
---

# Identity and authentication

These are two different questions, and conflating them causes real bugs:

- **Access** is the API key's job: prove you hold a valid credential (authentication), and scope what it lets you do, read-write or read-only (authorization).
- **Identity** is who the client is: the `client` half of the `(aggregate, client)` key that makes [retries idempotent](/concepts/idempotent-writes). It grants nothing; it names you.

An API key carries no identity. A client id carries no permissions. Both are separate from [mTLS](/operations/tls-mtls), which secures the transport but does not say who is on the other end.

## Authentication: API keys

A shared secret the client sends; the server checks it against a stored hash and grants read-write or read-only access. That is all it does. It never maps to a client id.

This makes rotation boring, which is the point. Swap the key on whatever schedule security wants; idempotency is untouched, because the dedup history is keyed by client id, not by credential. A writer holding a stale key fails loudly with `AuthInvalidKey` (10006). Loud failures are the good kind.

## Identity: where your client id comes from

Two options.

**Choose it yourself.** Every write takes an explicit `clientId`, a 128-bit value; a UUID is the natural choice. If the connection never did an identity handshake, the server takes the field at face value. Fine for trusted backend writers, but be clear about what you are not getting: any client can claim any id.

**Prove it with a keypair.** The client holds an RSA keypair and signs a server nonce on connect. The client id is derived deterministically from the public key, so the same key always maps to the same id, and nobody can claim your id without your private key. No registration step: present a new public key and you are a new client. Once a connection is identified, the server enforces the binding; a write whose `clientId` does not match the verified identity is rejected with `IdentifyMismatch` (10003).

The handshake is opt-in per connection unless the server runs with `--require-client-identity`, which refuses anonymous connections outright (`IdentifyRequired`, 10004). If your clients are untrusted - browsers, edge devices, anything outside your network - keypairs plus that flag are the only combination that means anything. A self-chosen UUID is identity by politeness.

## Keep your client id stable

This is the part that bites people, and the failure is silent. Idempotency tracks the highest `ClientSeq` per `(aggregate, client)`. If a writer's identity changes - a regenerated keypair, a fresh GUID or ephemeral key per process - the server sees a new client and applies its retried write as a brand-new event. No error. The duplicate just lands. You find it later when the projection numbers do not add up.

So: a long-lived backend writer holds the same client id, and the same keypair if it uses one, across restarts. Persist them the same way you persist a database password. The client libraries never generate a client id for you; every write asks for it explicitly. Supply the same value every time.

Stable also means shared. A horizontally scaled service (many replicas behind a load balancer) is *one* writer with *one* client id. Not one per pod, never one per request. Replicas sharing an id is the supported shape: optimistic concurrency serialises them, and the [idempotency guide](/guides/idempotency#scaling-out-many-replicas-one-client-id) covers the one verification it requires. A fresh id per pod or per request makes the server walk the aggregate's history for every never-seen `(aggregate, client)` pair, and erodes the dedup the id exists to provide. If identity is enforced, the fleet shares one service keypair, mounted as a secret.

Note what is not on that list: API key rotation. Keys and identity are independent, so rotating a credential never creates a duplicate. Regenerating a keypair is a fresh identity though; drain the old writer first (wait until no retries are outstanding) before you switch.

## Local-first clients

In the [local-first pattern](/concepts/local-first-sync), each browser or edge client typically generates its own keypair, so each one is its own identity with its own per-aggregate sequence. That is usually what you want: every device owns its stream, and the keypair stops devices from impersonating each other.

## When it goes wrong

Identity problems surface as the `Identify*` [error codes](/reference/error-codes) (10001-10004): an expired nonce, a signature that does not verify, a `clientId` in a write that does not match the identified client, or identity required but not sent. Authentication problems are the `Auth*` codes (10005-10007): key required but missing, key wrong, or key read-only when the request needed write.

:::info Pre-release
The identity model is functional but pre-1.0; the handshake details can still change.
:::
