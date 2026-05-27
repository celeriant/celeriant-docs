---
title: Schema validation
---

# Schema validation

Register a schema for an event type and the server rejects any event that does not conform, at write time, before it can enter the log. A bad event never lands in the first place.

## Server-side, not client-side hope

Client-side validation is a suggestion: one service that skips it, one bug, and malformed events are in your log forever. Celeriant validates on the server, so the guarantee holds no matter who is writing. An event that fails validation is rejected with [`WriteSchemaValidationFailed`](/reference/error-codes); nothing is appended.

This is the piece Kafka makes you pay Confluent for: broker-side schema enforcement. Here it is part of the store.

## Formats

Register a schema in JSON Schema, Avro, or Protobuf, keyed to an event type. Validation is opt-in per type: register a schema and that type is enforced; leave it unregistered and that type is unvalidated, which is fine for payloads you do not need to police.

Validation reads the payload, so it does not apply to an [encrypted](/concepts/encryption) event; the server never sees that plaintext. For a given event type, validate it or encrypt it, not both.

## Versioning

Event types carry a `(major, minor)` version (see [Events and the log](/concepts/events-and-the-log)). The convention is semantic: bump **minor** for a backward-compatible change (a new optional field), bump **major** for a breaking one (a removed or retyped field). Register a schema per `(type, major, minor)`, so old and new shapes validate side by side while you migrate consumers.

Registration itself can fail with [`RegisterSchemaAlreadyExists`](/reference/error-codes) or `RegisterSchemaInvalid`. See [Registering and evolving schemas](/guides/schemas).
