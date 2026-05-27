---
title: Enabling per-event encryption
---

# Enabling per-event encryption

Encrypt the payload client-side with AES-GCM and the server stores ciphertext it cannot read. See [Encryption](/concepts/encryption).

## Write

Encrypt the bytes, put the 12-byte nonce in `Iv`, and the ciphertext in `EventValue`:

```csharp
using System.Security.Cryptography;

byte[] plaintext = Encoding.UTF8.GetBytes(json);
byte[] nonce     = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize); // 12 bytes
byte[] cipher    = new byte[plaintext.Length];
byte[] tag       = new byte[AesGcm.TagByteSizes.MaxSize];

using (var aes = new AesGcm(key, tag.Length))
    aes.Encrypt(nonce, plaintext, cipher, tag);

// store ciphertext followed by the 16-byte tag
byte[] stored = new byte[cipher.Length + tag.Length];
cipher.CopyTo(stored, 0);
tag.CopyTo(stored, cipher.Length);

await pool.WriteAsync(aggregateKey,
    events: [new AggregateEvent
    {
        ClientSeq = next,
        EventTypeMajor   = 1,
        EventTimestamp   = DateTimeOffset.UtcNow,
        EventValue       = stored,
        Iv               = nonce,
    }],
    clientId: writerId);
```

## Read

Reverse it client-side; the server hands back exactly what you stored:

```csharp
var stored       = e.EventValue;
var cipher       = stored.AsSpan(0, stored.Length - 16); // last 16 bytes are the GCM tag
var tag          = stored.AsSpan(stored.Length - 16);
byte[] plaintext = new byte[cipher.Length];
using (var aes = new AesGcm(key, 16))
    aes.Decrypt(e.Iv!, cipher, tag, plaintext);
```

## Keys are yours

The server never sees a key. Where keys live, how they rotate, and who can read them is your design; a server compromise yields ciphertext, not data. Note also that the event's metadata (type, timestamps, sequence) stays in the clear so the server can order and filter, so encryption hides the contents of an event, not that one occurred. And an encrypted event cannot be [schema-validated](/guides/schemas).
