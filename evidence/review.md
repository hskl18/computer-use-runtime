# Evidence review

Reviewed locally on 2026-09-12 by the coding agent.
This record is separate from generated manifests and does not represent human publication approval.

## Integrity and provenance

All 57 file digests in `files.sha256` were reverified with `shasum -a 256 -c` from the repository root.
Every capability digest was recomputed independently from file content and matched its recorded `artifactHash`.
Attempt and completion counts were recomputed from persisted events rather than the run's attempt counter.

Each final discovery has nine attempts, seven completed actions, and two rejections.
The rejections are an ambiguous table cell and a click that left the application unchanged.
Both discoveries produced seven-step artifacts, and the compiled steps contain no action that failed or had no effect.

The three CLI replay assertions confirm expected raw outputs, exact pinned hashes, successful CLI exit, and zero model or provider events.
Raw output checks happened while the temporary result handles were valid; this review does not infer raw correctness from masked saved results.

The runtime export contains 15 real integration cases against the injection discovery hash.
Console evidence covers actual local browser operation and includes separate result assertions.
The original local paths in runtime summaries are retained as provenance; only named JSON evidence and PNG images were copied into this directory.
No browser profile, database, credential symlink, local Codex configuration, or unrestricted trace archive was copied.

## Privacy and visual inspection

Structured JSON and JSONL evidence was scanned for all three synthetic member IDs and all fixture balances.
None appear. The only occurrence of a member ID anywhere under `evidence/` is in this directory's README, which states which synthetic member each run used.
The 16 exported PNG files hold 12 distinct images, matched by SHA-256.
A sample was opened and inspected directly: the member detail screen after operator handoff shows the member ID cell masked, and the exhausted-recovery failure screenshot shows only the fixture's error state.
Failure states, session expiry, dialog intervention, masked member fields, and console evidence controls were visible and legible.
Console launch forms intentionally show synthetic example inputs; they are not private customer data.
Persisted output values shown by the console remain masked.

Secret scanning and fixture masks are bounded checks, not universal privacy guarantees.
Upstream dependency license notices are recorded in `THIRD_PARTY_NOTICES.md`.

## Verification and interpretation

`pnpm check` passed TypeScript, Biome on 49 files, 35 core/provider tests, and the Next.js production build.
Browser tests passed 9/9, runtime tests passed 15/15, and the console suite passed 4/4, for 63 tests total.
Both live discoveries and all three pinned replays were run against the current code, not carried over from an earlier build.

The retained initial discovery failure and the rejected requests in successful discoveries remain visible.
The selection is an acceptance evidence set, not a complete benchmark sample.
Handoff inputs were simulated by Playwright in a real retained browser context and page.
No real person, external account, direct API billing, cross-tenant deployment, or model-superiority claim is established.
