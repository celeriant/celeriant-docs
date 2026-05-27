---
title: Encryption
---

# Encryption

Event payloads can be encrypted per event with AES-GCM. The client encrypts before sending; the server stores ciphertext it cannot read.

## The server never holds your keys

You encrypt the payload client-side and send the ciphertext plus its initialization vector. The server stores those opaque bytes and the IV, and hands them back unchanged on read. It never sees plaintext and never sees a key. Decryption happens client-side too. Key management, rotation, and access are yours; a compromise of the server does not hand over readable data.

## What is and is not encrypted

The **payload** is encrypted. The event's metadata is not: the type, the timestamps, and the sequence numbers stay in the clear, because the server needs them to order, filter, and serve reads without decrypting anything. So encryption protects the contents of an event, not the fact that an event of a given type occurred at a given time on a given aggregate. Model accordingly: if the existence or timing of an event is itself sensitive, that is not something payload encryption hides.

The server also cannot [schema-validate](/concepts/schemas) an encrypted payload, because it cannot read the bytes. For a given event type, choose one: server-side validation, or encryption.

## Per event, by choice

Encryption is per event, so you can encrypt the sensitive streams and leave the rest plain. See [Enabling per-event encryption](/guides/encryption) for the client-side pattern, and [Durability and safety](/concepts/durability-and-safety) for where encryption sits among the other guarantees.
