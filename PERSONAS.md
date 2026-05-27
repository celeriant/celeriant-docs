# Celeriant docs personas

Internal. Not published (lives at the repo root, outside `docs/`). This is the rubric every doc page is written and reviewed against. If a sentence fails a persona below, fix the sentence.

## The cardinal rule

Write for a reader who knows distributed systems but knows **nothing about Celeriant, our other projects, or our company**. Never name a thing the reader cannot be expected to know: no `colorsquare`, no `utilitydelta.io`, no internal repo names, no person's name as if they're famous. If an example helps, describe the *kind* of system ("a collaborative drawing canvas," "a field app with no signal"), not our instance of it. Acronyms and product jargon get defined on first use or linked.

---

## 1. Developer  ·  "How do I use this?"

**Who:** A senior backend or platform engineer who will write code against Celeriant. Comfortable with distributed systems, event sourcing, their language's async model.

**On the docs they want:** to get a node running, append and read events, handle concurrency conflicts, build a projection, wire up a client. Copy-paste code that compiles. The exact method signature.

**Assume:** they know what an event, an aggregate, and a projection are in general. They know their language.

**Do NOT:** teach event-sourcing 101; explain what CQRS is from scratch; pad with motivation. Give them the mechanism and the code.

**Fails for them:** prose where they wanted a snippet; a code sample that won't compile or omits imports; a method referenced but never shown in full; hand-waving where they need the precise contract (version semantics, error codes, retry rules).

## 2. Architect / principal engineer  ·  "Is this the right choice, and which pattern?"

**Who:** Makes or owns the build-vs-buy and which-datastore decision. Budget authority. Skeptical; has been burned by hype.

**On the docs they want:** what Celeriant is and is not, when NOT to use it, the two usage patterns and which fits their system, the guarantees, the performance evidence, how it compares to what they run now (Kafka, Postgres).

**Assume:** they evaluate tradeoffs for a living. They will not accept an unqualified absolute or a benchmark with no method.

**Do NOT:** oversell; bury the disqualifiers; state guarantees as marketing ("never lose data") instead of mechanism ("fdatasync'd on both nodes before ack"). Do not make them reverse-engineer which usage pattern their system needs.

**Fails for them:** an overclaim they can puncture in one reply; a missing "when not to use"; a benchmark with no batch size / load level; comparison pages that misrepresent Kafka or Postgres; the live-vs-local-first choice left implicit.

## 3. SRE / operational engineer  ·  "How do I deploy, run, and watch it?"

**Who:** Will stand up the cluster and keep it alive at 3am. Cares about failure modes, observability, recovery, upgrades.

**On the docs they want:** deployment topology and tradeoffs, the two-node + S3 model, TLS/mTLS setup, the full config reference, metrics and health, backup/recovery, rolling upgrades, what each error means, what happens when a node dies.

**Assume:** they run production systems. They want specifics: ports, flags, permissions, exact failure behavior.

**Do NOT:** be vague about failure modes; promise HA without explaining the dependency (S3 in the failover path); skip the "what happens when half the cluster is down" question.

**Fails for them:** an Operations page that is a summary instead of a runbook; HA claims with no failure-window detail; missing config keys; no troubleshooting.

---

## The two usage patterns (the architect's first fork)

Every page that touches writes should be clear which pattern it describes.

- **Pattern A — live writes with optimistic concurrency.** Online services append to the global log; conditional writes arbitrate concurrent writers at write time. Most of the docs assume this.
- **Pattern B — local-first sync.** Clients/services buffer events locally (possibly offline) and replay them onto the global log on reconnect. No OCC; last-write-wins. Served by the local-first HTTP gateway. Fits offline-capable apps, per-device/per-user streams, edge services.

## Voice

Opinionated, no-bullshit, 20-year veteran. Problem-first; numbers over adjectives; no hedging; no fake balance; colons and semicolons, never em dashes; short paragraphs; blunt endings allowed.
