---
title: Wire protocol
---

# Wire protocol

This is reference material for people writing a client or debugging the wire. If you use the [.NET](/clients/dotnet) or [Rust](/clients/rust) client, you never touch this.

## Transport

Clients connect over TCP, optionally wrapped in TLS or mTLS (see [TLS and mTLS](/operations/tls-mtls)). `TCP_NODELAY` is set; the protocol is request/response, plus a server-push stream for [watch](/concepts/watch).

## Framing and serialization

Messages are length-prefixed binary frames, serialized with MessagePack. A frame is bounded by the server's `--max-request-size` (16 MiB default) inbound and `--max-response-size` (64 MiB default) outbound. `u128` identifiers (org, type, aggregate, client) are 16 bytes on the wire; the .NET client surfaces them as `Guid`. Event payloads are opaque bytes the protocol does not interpret.

## Compression

Compression is automatic. Clients compress requests and decompress responses transparently against a shared dictionary, rather than picking an algorithm per request. The WAL itself is zstd-compressed with a trainable dictionary (see `celeriant dict train`); you do not choose compression per write.

## The identify handshake

When the server runs with `--require-client-identity`, the client's first message must be an `Identify`. Two modes:

- **API key.** The client sends a base64 key; the server compares its SHA-256 against stored hashes. Send it only over TLS, since the key is otherwise in the clear.
- **RSA public key.** The client sends its public key, a nonce (current epoch ms), and an RSASSA-PKCS1v1.5-SHA256 signature over the nonce. The server verifies the signature and checks the nonce is fresh. The client's id is derived deterministically as `SHA-256(DER public key)[..16]`, so the same key is always the same client.

Identity is distinct from the TLS handshake: TLS authenticates the connection, identify establishes who the client is for idempotency. Only the RSA mode produces a server-verified client id; the API-key mode authenticates without one. See [Identity and authentication](/concepts/identity). Failures return the `Identify*` codes in the [error reference](/reference/error-codes).

:::info Pre-release
The binary protocol is internal and unversioned pre-1.0; it can change between releases. Build against a client library, not the raw wire, unless you are prepared to track it.
:::
