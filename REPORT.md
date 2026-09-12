# Architecture

A Next.js console and CLI call a long-lived Fastify worker that owns Chromium, run state, and local SQLite storage.
Discovery invokes a real model through controlled tools; the core replay module has no provider dependency.
Playwright provides accessibility snapshots, masked screenshots, semantic targeting, and browser execution.
Recorded runs used gpt-6-astra through Codex CLI 0.153.4 with ChatGPT authentication.
The explicit Responses API adapter uses separate API credentials and has mocked tests only.
[Source-linked diagrams](docs/architecture.md) describe the implemented boundaries.

# Artifact schema

The Zod contract records schema and contract versions, application family and entry path, typed inputs/outputs, ordered actions, declarative outcomes, and model/run provenance.
Targets use roles, labels, text, or table row/header semantics with optional iframe scope.
Input references parameterize actions without embedding invocation values.
The compiler accepts successfully executed actions and requires typed output reads plus a final input-bound equality checkpoint.
An immutable SHA-256 revision identifies exact content; a separate latest pointer selects future defaults.
Replay can pin a revision and validates its digest and input contract before interaction.
The digest detects content changes; it is not an authorization signature.

# Determinism & error handling

Replay follows the recorded seven-step sequence with host-side guards, bounded waits, and bounded frame reloads, without model decisions or selector repair.
Business results distinguish invalid input, missing members, and denied access.
Application errors, ambiguous targets, policy violations, unresolved handoff, and checkpoint failures stop explicitly.
Failure paths retain redacted observations and masked images when capture is possible.
Raw typed outputs are checked locally against independent fixture expectations, returned temporarily to the caller, and masked in persistence.
The two final discoveries each made nine action attempts: seven completed and two rejected before compilation.
A click that leaves the accessibility snapshot and frame URLs unchanged is rejected during discovery, so a no-op never becomes a recorded step.
Their exact-revision CLI replays used different inputs, returned the expected outputs, and emitted zero model/provider events.
The local gates passed 35 core/provider, 9 browser, 15 runtime, and 4 console tests plus TypeScript, lint, and production build.
See the [evidence index](evidence/README.md) for run IDs and exact hashes.

# Heterogeneity & multi-tenant

The target has an iframe, legacy tables, dialogs, slow responses, and explicit failure states.
The second layout reverses rows and columns; the same discovered revision replayed correctly through semantic targeting.
This validates a layout variation in one synthetic application family.
The current frame and completion instructions remain specific to that family; another web application needs a descriptor and completion contract, while desktop or terminal targets need another surface and target schema.

For reuse across tenants, a future registry would bind a vendor family/version and approved base capability hash to each tenant's origin, policy, and versioned selector overrides.
Preflight would check the application fingerprint; checkpoints or detected drift would stop replay and require reviewed rediscovery or a versioned override.
Tenant identity, credentials, worker isolation, storage keys, quotas, and promotion decisions must be scoped independently.
This repository implements local per-run browser contexts and immutable revisions, not that tenant registry or production isolation.

# Escalation & handoff

Ownership transitions from automation to paused to human, then back to automation or closed.
A blocked run retains its original browser context and page while its automation promise waits.
The console or CLI claims that headed session; returning control triggers inspection before continuing.
Trusted click/change/submit events are captured while human ownership is active, with input values masked.
Integration tests resolved session expiry and an unexpected HTML dialog in the same context/page, verified the session ID and captured actions, resumed, and checked raw outputs.
Those operator inputs were simulated by Playwright, not performed by a person.
Separate tests cover unresolved return, headless refusal, timeout, cancellation, and worker restart handling.

# Safety

Policy restricts network origin/path, action types, click names, time/step budgets, and recovery rules.
Six allowed click names narrow discovery's search space and encode the fixture's authorization boundary; this is not an unbiased benchmark.
Risky names override the allowlist, and a live-browser test confirms transfer activation is blocked before a DOM change.
Password fields, popups, downloads, and service workers are rejected or disabled.
Model application tools accept typed operations rather than browser or shell code.
Astra uses Codex's sandboxed JavaScript orchestration host; native environments are absent and inherited MCP inventory is empty.
That host also supplies upstream orchestration utilities, so four application tools does not mean four total model tools.

A real injection run confirms the imported note reached the model and the correct task completed without an unregistered application call.
This is one observed case, not a general prompt-injection guarantee.
All structured reads are masked for model responses and persistence; text and image masks are fixture-specific.
The local API and trusted operator model are unsuitable as production authentication or authorization.

# Cuts

What exists is a verified local implementation with real model trajectories and model-free replay evidence.
It omits real accounts, bank writes, distributed scheduling, remote operator streaming, desktop control, and deployed tenant isolation.
An initial failed discovery is preserved alongside the later successful runs rather than hidden.
The recorded runs used ChatGPT subscription access through Codex; the metered API adapter exists and shares the same tools, but has never made a live call.
There is no controlled comparative benchmark supporting model superiority.
Nothing here has been deployed, and the evidence covers one synthetic application only.
