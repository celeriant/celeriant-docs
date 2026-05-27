---
title: Registering and evolving schemas
---

# Registering and evolving schemas

Register a schema for an event type and the server rejects non-conforming events at write time. See [Schema validation](/concepts/schemas).

## Register

```csharp
await pool.RegisterSchemaAsync(new RegisterSchemaRequest
{
    ClientId  = adminClientId,
    SchemaKey = new SchemaKey
    {
        OrgId           = orgId,
        AggregateTypeId = ordersType,
        EventTypeMajor  = 1,
        EventTypeMinor  = 0,
    },
    SchemaType = SchemaType.Json,   // Json, Avro, or Protobuf
    Schema     = """
    {
      "type": "object",
      "required": ["sku", "qty"],
      "properties": {
        "sku": { "type": "string" },
        "qty": { "type": "integer", "minimum": 1 }
      }
    }
    """,
});
```

A schema is keyed to `(org, aggregate type, major, minor)`. From then on, a write of that event type whose payload does not conform is rejected with `SchemaValidationException` (error 2022), before it enters the log.

## Evolve

Register a new schema for the new version rather than mutating the old one:

- a **minor** bump for a backward-compatible change (new optional field),
- a **major** bump for a breaking one.

Both versions stay registered and valid, so producers and consumers migrate on their own schedule. Re-registering an existing `(type, major, minor)` fails with `SchemaErrorException` (`RegisterSchemaAlreadyExists`, 2020); a malformed schema fails with `RegisterSchemaInvalid` (2021).

## Encrypted events

The server validates by reading the payload, so it cannot validate an [encrypted](/guides/encryption) event. For a given event type, choose one: register a schema, or encrypt it. Not both.
