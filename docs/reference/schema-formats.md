---
title: Schema formats
---

# Schema formats

A registered schema is keyed to an event type and enforced at write time. See [Schema validation](/concepts/schemas) for the concept and [Registering and evolving schemas](/guides/schemas) for the recipe.

## The key

A schema is registered against a `SchemaKey`: the org, the aggregate type, and the event type's major and minor version.

```
org_id / aggregate_type_id / event_type_major / event_type_minor
```

Registering per `(major, minor)` is what lets multiple versions of an event type validate side by side while you migrate.

## Supported formats

`SchemaType` selects the format:

| `SchemaType` | Format |
| --- | --- |
| `Json` | JSON Schema |
| `Avro` | Avro schema |
| `Protobuf` | Protocol Buffers |

The schema definition is submitted as a string and must be under the server's schema-size limit (16 KiB by default, `--max-schema-size-bytes`). A malformed schema is rejected at registration with `RegisterSchemaInvalid`; a write whose payload does not conform is rejected with `WriteSchemaValidationFailed`. See the [error codes](/reference/error-codes).

### Schema-string format per type

The string the server expects differs by `SchemaType`:

- **`Json`** — the JSON Schema document itself, e.g. `{"type":"object","properties":{"amount":{"type":"integer"}},"required":["amount"]}`.
- **`Avro`** — the Avro schema JSON, e.g. `{"type":"record","name":"Order","fields":[{"name":"amount","type":"long"}]}`. (Avro binary is schemaless on the wire, so a payload is rejected only when its bytes fail to decode against this schema.)
- **`Protobuf`** — **not** `.proto` source text. Submit `base64(FileDescriptorSet):MessageName` — the base64 of a serialized protobuf `FileDescriptorSet` (as produced by `protoc --descriptor_set_out`), a colon, then the fully-qualified message name, e.g. `CqYB...base64...:Order`.

## Two things to remember

- **Validation reads the payload**, so it does not apply to an [encrypted](/concepts/encryption) event; the server cannot read those bytes. Per event type, validate or encrypt, not both.
- **Schemas are additive.** You register new versions; you do not edit a registered one. Re-registering an existing `(type, major, minor)` is rejected with `RegisterSchemaAlreadyExists`.
