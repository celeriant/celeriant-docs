---
title: Running a single node
---

# Running a single node

Standalone mode: one process, no replication, no S3 election. For development and for workloads that accept single-machine durability.

```bash
celeriant \
  --standalone \
  --data-root /var/lib/celeriant \
  --client-port 10000 \
  --num-shards 4
```

Every flag also has a `CELERIANT_`-prefixed environment variable (`--data-root` is `CELERIANT_DATA_ROOT`, and so on), which is what you use in containers. See [Configuration](/operations/configuration).

## The data directory

`--data-root` must sit on a filesystem that honors `O_DIRECT`. At boot the server writes a probe file and refuses to start if the filesystem silently downgrades to buffered I/O; the error tells you so. ext4 and XFS are known good. The directory holds one subdirectory per shard, each with its preallocated WAL files.

## Shards

`--num-shards` defaults to the CPU count. One core owns one shard, single-threaded. For development, a handful is plenty; in production, leave it at the core count unless you have measured a reason not to.

## Durability in standalone

A write is `fdatasync`'d to the local disk before it is acknowledged, so an acknowledged write survives a process crash or power loss on hardware that honors flush. What it does not survive is that disk failing: there is no second copy. If you need to survive a node loss, run a [two-node cluster](/operations/two-node-cluster).

## Containers

The storage engine uses `io_uring`, whose syscalls the default Docker seccomp profile blocks, so a container needs `--security-opt seccomp=unconfined` and `--ulimit memlock=-1:-1`. There is no published image yet; build it from the two-stage `Dockerfile` in the source tree, which runs the release build for you:

```bash
docker build -t celeriant .
docker run --security-opt seccomp=unconfined --ulimit memlock=-1:-1 \
  -p 10000:10000 -v celeriant-data:/var/lib/celeriant \
  celeriant --standalone --data-root /var/lib/celeriant --num-shards 4
```

:::info Pre-release
Binaries and a published container image ship with the open-source release. Until then you build from source.
:::
