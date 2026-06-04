---
title: Correctness testing
---

# Correctness testing

A database that moves money is only worth what its correctness evidence is worth. Anyone can claim "no split-brain, no lost writes." The claim is free. The proof is a harness that spends all day trying to break those exact guarantees on a real cluster and failing.

So that is what Celeriant has. Not a wall of green unit tests asserting that a function returns what it was told to return. A dedicated chaos harness, `celeriant-chaos`, that runs a live two-node cluster under continuous client load, injects real faults at the OS and network layer, and then checks the durable, on-disk truth against a battery of safety and liveness invariants. If any invariant trips, the run fails. Loudly.

This page is the honest account of what that harness does, what it proves, and where the gaps still are.

## Not a simulation

`celeriant-chaos` does not mock the network or stub the disk. It drives the same binary you would deploy, on two real nodes, talking to a real S3-compatible store (MinIO), over real TCP. Faults are injected the way they actually happen in production: signals to the process, packet rules in the kernel, the clock moved out from under the node, the disk filled until writes get `ENOSPC`.

During every scenario, thousands of concurrent writers (4000 bench tasks by default) hammer the cluster the whole time the faults are landing. Correctness is not checked on a quiet system that was nudged once. It is checked on a saturated one, mid-fault, with writes in flight.

The trade is honest and stated up front in the [gaps](#what-this-is-not) section: this is real-cluster fault injection, not a deterministic in-process simulator. Different tool, different strengths.

## The nemesis

Every fault is a real one, applied to a real node:

- **SIGKILL** - hard crash. No cleanup, no graceful step-down, no chance to release a lease. The power-cord pull.
- **SIGTERM** - graceful stop. Tests that the planned path is clean and the chaotic path is safe, separately.
- **SIGSTOP / SIGCONT** - process pause and resume. This is the zombie-leader test: freeze the leader for longer than its lease, let the follower take over, then thaw the old leader and watch it discover it has been deposed. This is the exact failure mode (a paused process acting past its lease) that lease-based systems get wrong.
- **Network partition** - `nftables` rules that drop traffic on a specific host and port, including asymmetric partitions where packets flow one way but not the other. The replication link and the S3 link are partitioned independently, because they fail independently.
- **Clock skew** - the node's system clock shoved forward, to attack the clock-drift fence directly.
- **Disk full** - the data volume filled to within tens of MiB of capacity so the WAL hits `ENOSPC` mid-write.
- **S3 outage** - MinIO actually stopped and restarted, not just firewalled. Short outages and minute-long ones.

## The scenarios

More than twenty named scenarios compose those faults into the situations that actually take databases down. The sharp ones:

- **Leader SIGKILL under load** - hard-kill the current leader mid-bench. The follower must promote, serve writes, and lose nothing acknowledged.
- **Three back-to-back leader kills** - kill and restart the leader three times in a row, fast. Forces repeated real failovers and checks that leadership genuinely changes hands each time rather than the same node bouncing back before the peer can promote.
- **Asymmetric partition** - packets one direction only, the case that manufactures split-brain in systems with sloppy fencing.
- **Partition leader from S3, link to follower intact** - the leader can still replicate to its follower but cannot reach the lease. It must keep serving, not fence itself spuriously.
- **Kill follower and S3 simultaneously** - the catastrophic path. Both durability fallbacks removed at once. The leader must refuse to acknowledge writes it cannot make durable, rather than lie.
- **SIGSTOP the leader past the lease TTL** - the fencing test described above.
- **Clock skew, disk full, rolling restart, rapid partition flap** - the long tail of operational reality.
- **Exactly-once audits under fault** - dedicated scenarios that drive idempotent writes through an S3 outage, and through a partition-then-kill-S3 blackout, then audit that every `(client, aggregate, sequence)` landed exactly once. No duplicates from retries, no gaps from drops.

## The invariants

A scenario passes only if every one of these holds against the captured run and the post-run disk state. Each has a name in the harness; these are the ones that matter:

**Safety - the guarantees that must never break:**

- **ExactlyOneLeader** - across both nodes, leadership summed over time is exactly one. A tick with zero or two leaders is a violation. Chaos scenarios that exercise failover allow a bounded, measured split-brain window during the handoff and fail if it exceeds the budget.
- **NoSameEpochDivergence** - two nodes never commit different data under the same lease epoch. This is the cardinal split-brain safety property, checked against the durable log, not the metrics.
- **Divergent-tip fork detection** - after the cluster is quiesced, the harness SSHes into both nodes and compares each shard's WAL **tip hash**, not just its sequence number. Two nodes at the same sequence with different tip hashes is a silent fork, and a sequence-number comparison would pass it. This check catches it, and the harder fork-wedge case where a lagging node's prefix does not actually match the leader's history.
- **NoTruncateDroppedSelfAcked** - when a node rolls back divergent log entries during recovery, it may never drop a write it had already acknowledged to a client. Acknowledged means durable, permanently, even across a rollback. This is the no-lost-writes invariant.

**Liveness - the system must also make progress, not just stay safe by stalling:**

- **FailoverWithinBudget** - the measured write-outage window during a leader failure must be under budget.
- **EventualConvergence / WalSeqAdvanced** - a lagging node must either catch up to the leader or be provably still advancing. "Stuck at a non-zero diff" fails; "still catching up" passes.
- **DistinctLeaderHosts / FinalLeaderWroteDuringBench** - the failover must actually happen and the promoted leader must actually serve client writes. Guards against scenarios that trivially pass because nothing moved.
- **BenchThroughputFloor / BenchErrorsBounded** - sustained throughput stays above a floor and client errors stay within a bound, the whole time, through the faults.

**Stability envelope:** every run also bounds leader elections, S3 fallbacks, heartbeat failures, shard panics, node restarts, and role flips. A scenario declares the maximum disruption it expects; exceeding it fails the run even if the safety invariants held. A failover that was supposed to happen once and happened five times is a bug, even if no data was lost.

## Distrusting its own read path

The strongest check in the suite refuses to trust Celeriant to grade its own homework.

The exactly-once audit first reads back through the server's normal `read()` API to find aggregates that look like they are missing sequence numbers. Then, for every flagged entry, it throws that answer away and goes to ground truth: it SSHes into **both** data nodes, runs `celeriant-wal-inspect` directly on the raw WAL files, parses the per-batch records to extract the set of client sequences actually on disk, and reclassifies each "missing" sequence against what is physically stored.

The server's read path has its own bugs that over-report missing data by roughly five times. The disk-truth verifier exists because a correctness audit that trusts the same component it is auditing is not an audit. Ground truth is the bytes on the platters of two machines, read by a separate tool.

## Soak

A single pass is a spot check. Real corruption hides in the tail.

The harness runs in soak mode: repeat the entire scenario set in a loop for as long as you point it at, twenty-four hours and up, each iteration in its own report directory. It either aborts on the first failing iteration or records failures and keeps grinding, your choice. Bugs that surface once every few hundred failovers surface here.

## What this is not

Stated plainly, because correctness claims with the gaps hidden are worth nothing:

- **It is not a deterministic simulation.** There is no in-process, single-threaded, seed-replayable simulator (the TigerBeetle VOPR / FoundationDB style) yet. The harness drives real wall-clock nodes, so a failure is reproduced by re-running the scenario, not by replaying a seed bit-for-bit. Deterministic simulation is on the roadmap; it is not here today.
- **It has not been audited by a third party.** No external Jepsen engagement has been run. The harness is adversarial and the invariants are the right ones, but it is the author's harness checking the author's code. Independent verification is worth pursuing and has not happened.
- **It runs on one cluster topology.** Two data nodes plus S3, on a fixed test cluster. It does not yet sweep hardware, kernel versions, or larger node counts.

None of that is a reason to discount the evidence. It is the difference between "we tested it" and a precise claim about what was tested, how, and what remains. Take the invariants above and the fault list as the actual state of correctness testing, and weigh the gaps as real.
