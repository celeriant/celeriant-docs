---
title: Getting started
---

# Getting started

## Local dev stack (Docker)

Fastest path to a queue node plus Prometheus, Loki, and Grafana running on localhost:

```bash
git clone https://github.com/celeriant/celeriant-queue
cd celeriant-queue/deploy/local-cluster
docker compose up -d --build
```

First build is slow. Full Rust release build of celeriant-queue and all celeriant-db crates. Subsequent rebuilds use Docker layer cache.

| Service | URL |
|---|---|
| Queue native wire | `localhost:10100` |
| Metrics | `http://localhost:9090/metrics` |
| Grafana | `http://localhost:3001` (admin/admin) |
| Grafana queue dashboard | `http://localhost:3001/d/celeriant-queue` |
| Prometheus | `http://localhost:9091` |

::::warning No auth, no TLS on the queue port yet
Port 10100 is a raw TCP socket. No authentication, no TLS, and `org_id` is whatever the client claims it is. Auth + TLS are tracked (F-B3) and land later. Until then: bind loopback-only or keep the port inside a network you fully trust. Do not expose it to the internet.
::::

The compose file assumes `celeriant-queue/` and `celeriant-db/` are cloned under the same parent dir. The queue depends on celeriant-db crates via workspace path.

## Bare metal

```bash
cargo build --release -p celeriant_queue
./target/release/celeriant-queue --standalone \
  --data-root /var/lib/celeriant-queue \
  --num-shards 1 \
  --queue-port 10100
```

The binary accepts the entire Celeriant flag surface (TLS, S3, replication) plus three queue-specific flags:

| Flag | Default | Purpose |
|---|---|---|
| `--queue-port` | `10100` | TCP port for the queue's native wire |
| `--queue-max-frame-size` | `16777216` | Max request frame in bytes |
| `--queue-max-queues-per-org-per-shard` | `u32::MAX` | Per-tenant cap, per shard |

## First produce / consume

No CLI yet. The canonical wire-call shape lives in `celeriant_queue_integration_tests/tests/common/mod.rs::rpc`. Minimal Rust example:

```rust
use celeriant_queue_core::queue_config::QueueConfig;
use celeriant_queue_proto::{
    codec::{read_response, write_request_uncompressed},
    queue_key::QueueKey, requests::*, QueueRequest, QueueResponse,
};
use celeriant_wal::builtin_dict::BUILTIN_DICT_BYTES;
use celeriant_wire::codec::compression::DictCodec;
use celeriant_wire::network::wire_header::{WireHeader, PROTOCOL_VERSION_V2};
use futures_lite::AsyncWriteExt;
use glommio::{net::TcpStream, LocalExecutorBuilder};
use std::rc::Rc;

fn main() {
    LocalExecutorBuilder::default().spawn(|| async {
        let codec = Rc::new(DictCodec::new(BUILTIN_DICT_BYTES, 3).unwrap());
        let mut tcp = TcpStream::connect("127.0.0.1:10100").await.unwrap();
        tcp.set_nodelay(true).unwrap();

        let queue = QueueKey::new(/* org_id */ 1, /* queue_id */ 1);
        let dlq   = QueueKey::new(1, 999);

        // CreateQueue
        rpc(&mut tcp, &codec, QueueRequest::CreateQueue(CreateQueueRequest {
            correlation_id: Some(1), queue_key: queue, dlq_key: dlq,
            config: QueueConfig::default_standard(),
        })).await;

        // Produce
        let p = rpc(&mut tcp, &codec, QueueRequest::Produce(ProduceRequest {
            correlation_id: Some(2), queue_key: queue, client_id: 42,
            messages: vec![ProduceMessage {
                client_seq: 1, partition_key: None,
                headers: vec![], payload: b"hello".to_vec(),
                event_type_major: 1, event_type_minor: 0,
            }],
            expected_last_version: None,
        })).await;
        println!("produced: {p:?}");

        // Consume
        let c = rpc(&mut tcp, &codec, QueueRequest::Consume(ConsumeRequest {
            correlation_id: Some(3), queue_key: queue,
            consumer_id: 100, max_messages: 10, wait_ms: 0,
            consumer_group_id: None,
        })).await;
        println!("consumed: {c:?}");
    }).unwrap().join().unwrap();
}

async fn rpc(tcp: &mut TcpStream, codec: &DictCodec, req: QueueRequest) -> QueueResponse {
    write_request_uncompressed(tcp, &req, 1024 * 1024, PROTOCOL_VERSION_V2).await.unwrap();
    tcp.flush().await.unwrap();
    let header = WireHeader::from_reader(tcp, 16 * 1024 * 1024).await.unwrap();
    read_response(header, tcp, codec).await.unwrap()
}
```

The produce response's `assigned_versions` is `Vec<Option<u64>>`, one slot per message in order: `Some(version)` for a fresh append, `None` when that `client_seq` was already durable (idempotent duplicate, skipped). Retrying the whole batch after a dropped connection is safe.

For the full wire surface (Ack, Nack, Extend, Stats, TrimQueue, SnapshotNow, AssignRange, Unblock), see [Wire reference](/queue/wire-reference).

## What the dashboard shows

The Grafana dashboard (`celeriant-queue.json`) renders:

- **Throughput.** Produced, consumed, acked, nacked, parked per second.
- **Per-queue depth + in-flight.** Labelled by `(org_id, queue_id)`.
- **Operator health.** Parked, blocked, ack-hole-ranges per queue. The blocked panel turns red on the first non-zero value. A head-of-line block means trim is pinned. Send Unblock.
- **Tail position.** Monotonic `message_tail_version`. Slope is the produce rate.
- **Snapshot oversize skips.** Non-zero means a queue with pathological live-lease cardinality.
