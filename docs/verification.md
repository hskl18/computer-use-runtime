# Verification status

Local verification completed on 2026-09-11 America/Los_Angeles (2026-09-12 UTC).
Tests run on the project's synthetic application using installed Chromium.
No real account or external site was operated.

## Acceptance gates

| Gate | Observed evidence | Result |
| --- | --- | --- |
| Static/build | `pnpm check`: TypeScript, Biome, 35 core/provider tests, Next.js production build | Passed |
| Browser surface | `pnpm test:browser`: 9 tests, semantic targeting, delayed iframe navigation, risky control refusal, ownership | Passed |
| Runtime | `pnpm test:runtime`: 15 cases using the exact real discovery revision | Passed |
| Console | `pnpm test:console`: 4 desktop/mobile tests, raw-output replay, historical revision, failure image, take/cancel | Passed |
| Model discovery | Normal and prompt-injection runs, each with 8 completed actions, 8 model responses, 1 rejected action, 1 masked image supplied | Passed |
| Model boundary | ChatGPT authentication, gpt-6-astra, empty inherited MCP inventory, no native environment; registered application calls only | Observed in both final discoveries |
| Exact replay | Both final discovery hashes replayed through the CLI using different inputs; expected raw outputs independently asserted | Passed, zero model/provider events |
| Layout variation | Same normal-discovery hash replays reversed rows/columns; injection-discovery hash also replays the union layout | Passed |
| Business/recovery | Invalid ID, not-found, denied access, delayed navigation, one reload, and exhausted recovery budget | Passed |
| Hard failure | App error, ambiguous controls, unresolved handoff, headless refusal, cancellation; core checkpoint mismatch check | Passed |
| Handoff | Real headed context/page retained, captured trusted input and stable session ID, resumed outputs verified | Passed with Playwright-simulated operator |
| Evidence integrity | Generated file digests, exact artifact hashes, redacted logs and masked image inspection | See separate review record |

The [evidence index](../evidence/README.md) links actual run IDs, artifacts, event streams, and screenshots.
Tests that exercise failure states pass only when the expected failure code and behavior occur.
A completed test is not necessarily a successful business run.
The earlier static-only audit is superseded by this runtime evidence.

## Independent expectations and measurement

The private-to-the-model verification code checks synthetic outputs: `M1001 → 1245.67 USD`, `M2002 → 8032.10 USD`, and `M3003 → 0.00 USD`.
The discovery model receives parameter names/types and redacted UI observations, not this expectation table or fixture source.
Verification retrieves raw outputs from the temporary local result endpoint and compares them before retaining only pass/fail assertions.
Persisted `[REDACTED]` values alone do not establish output correctness.

`run.step` counts attempted actions, including rejected requests.
Completed steps are counted from `action.completed` events; exported assertions derive both counts from the stream.
Final discovery runs have nine attempts and seven completed steps, yielding seven-step artifacts.
The two rejected attempts per run are an ambiguous table cell and a click that left the page unchanged; neither is compiled.
Model responses are recorded upstream responses, not necessarily one action per response.
Supplying a screenshot establishes input delivery, not visual reasoning.
One injection case and one application-family variation cannot establish broad robustness or a model benchmark.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
pnpm check
pnpm evaluate
pnpm exec tsx scripts/verify-replay.ts --revision 69e7bebf68e6755b40304d3e338c2a2c3e806d40883b27f501b3bc6c3ba5941f
# Optional new live subscription calls:
pnpm verify:discovery
pnpm verify:discovery --scenario prompt-injection --member M2002
```

The runtime suite starts its own fixture on port 3211. The browser and console suites need the local services on 3101 and 3100, so start `pnpm dev` before `pnpm evaluate`.
The console suite creates its own replay failure if historical failure evidence is absent.
The included real capability permits model-free evaluation after a fresh checkout; a new discovery requires compatible Codex and an existing ChatGPT login.
The subscription path was verified in this environment; no live direct API call was made.

## Release boundary

Nothing here has been deployed or published.
Tenant isolation, real-bank compatibility, comparative model superiority, and future subscription entitlement are not inferred from these checks.
