---
title: Install the server
---

# Install the server

Celeriant is a single Rust binary, Linux only. For development you run one [standalone node](/operations/single-node); for production you run a [two-node cluster](/operations/two-node-cluster).

:::info Pre-release
Prebuilt binaries and a published container image ship with the open-source release. Until then you build from source.
:::

## Build from source

```bash
git clone https://github.com/celeriant/celeriant-db
cd celeriant-db
cargo build --release -p celeriant
# binary at ./target/release/celeriant
```

A recent stable Rust toolchain. The build needs no exotic system libraries.

## Run a node

```bash
./target/release/celeriant \
  --standalone \
  --data-root /var/lib/celeriant \
  --client-port 10000
```

`--data-root` must be on an `O_DIRECT`-capable filesystem (ext4 or XFS); the server checks at boot and refuses to start otherwise. Every flag has a `CELERIANT_` environment variable; see [Configuration](/operations/configuration).

## Or in a container

The storage engine uses `io_uring`, so the container needs `--security-opt seccomp=unconfined` and `--ulimit memlock=-1:-1`. Build the image from the two-stage `Dockerfile` in the source tree:

```bash
docker build -t celeriant .
docker run --security-opt seccomp=unconfined --ulimit memlock=-1:-1 \
  -p 10000:10000 -v celeriant-data:/var/lib/celeriant \
  celeriant --standalone --data-root /var/lib/celeriant
```

For a full local cluster with S3 (MinIO) and Grafana, use the `deploy/local-cluster` Compose stack; see [Running a two-node cluster](/operations/two-node-cluster).

Next: [install a client](/get-started/install-client).
