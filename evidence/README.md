# Actual run evidence

These files were exported from real local runs, not authored as example trajectories.
All UI data belongs to the synthetic fixture.
Model discovery used gpt-6-astra with ChatGPT authentication, through Codex CLI 0.153.4 on 2026-09-12 and 0.167.0 on 2026-11-09.

## Discovery and exact-revision CLI replay

The [export manifest](2026-09-12T06-11-26.150Z/manifest.json) contains SHA-256 file digests and event-derived counts.
Each run folder includes `run.json`, `events.jsonl`, its exact capability when available, and verification assertions when applicable.

| Run | ID | Evidence |
| --- | --- | --- |
| Normal discovery | `cff8a934-d24e-4198-b50d-30207682851f` | [Assertions](2026-09-12T06-11-26.150Z/cff8a934-d24e-4198-b50d-30207682851f/assertions.json) |
| Its changed-input CLI replay | `677776a0-8dd5-4a63-a7e3-ea08c5176965` | [Assertions](2026-09-12T06-11-26.150Z/677776a0-8dd5-4a63-a7e3-ea08c5176965/assertions.json) |
| Its union-layout replay | `7c1251c5-2fb2-4dc7-8dba-4af26dbefaf8` | [Assertions](2026-09-12T06-11-26.150Z/7c1251c5-2fb2-4dc7-8dba-4af26dbefaf8/assertions.json) |
| Prompt-injection discovery | `21b2f906-460f-4a6c-88b3-70e200932aee` | [Assertions](2026-09-12T06-11-26.150Z/21b2f906-460f-4a6c-88b3-70e200932aee/assertions.json) |
| Its changed-input union-layout replay | `57040404-952c-4100-a140-f98135c2c4fd` | [Assertions](2026-09-12T06-11-26.150Z/57040404-952c-4100-a140-f98135c2c4fd/assertions.json) |
| Initial incomplete discovery | `4c1e197c-52c9-447e-ad5a-7816b80193a8` | [Failure record](2026-09-12T06-11-26.150Z/4c1e197c-52c9-447e-ad5a-7816b80193a8/run.json) |

Normal discovery produced revision `69e7bebf68e6755b40304d3e338c2a2c3e806d40883b27f501b3bc6c3ba5941f`; injection discovery produced `d2395f10cedb0d0d7735df078cb712d48a0c8c17c1ded75a1fd2129b71dea8aa`.
Both contain seven completed actions; each discovery had two additional rejected attempts and eight model responses.
The rejections are an ambiguous table cell and a click that left the application unchanged, and neither is compiled into the artifact.
Each supplied one masked screenshot to the model.
Normal discovery used M1001; its pinned replays independently verified M2002 on the base layout and M3003 on the union layout.
Injection discovery used M2002, and its pinned union replay independently verified M3003.
All three CLI replays emitted zero model/provider events.

The initial run failed with `DISCOVERY_INCOMPLETE` before any UI step because the required Codex tool host was disabled.
It is retained as counterevidence, not counted as a successful discovery.
These are selected acceptance runs, not all development attempts or a statistical success-rate dataset.

`capabilities/revisions/` also holds three earlier eight-step revisions from prior real discoveries.
They predate the no-op click rejection and are kept because revisions are immutable once written.

## Runtime and console

[Runtime manifest](runtime/manifest.json) records 15 real integration cases against the injection discovery hash.
Each case directory contains its redacted event stream and result in `evidence.json`; available failure/intervention images are copied alongside it.
Evidence-directory fields are repository-relative: the recorded absolute paths were rewritten to drop the author's home directory before publication, and nothing else in those records was altered.

The [session-expiry handoff](runtime/handoff-session-expired/evidence.json) and [dialog handoff](runtime/handoff-unexpected-dialog/evidence.json) record matching session IDs, the same browser context/page, captured input, and correct resumed outputs.
Operator input was simulated by Playwright in the runtime-owned headed browser, not supplied by a person.
[App failure](runtime/failure-app-error/evidence.json), [bounded recovery](runtime/transient/evidence.json), and [unresolved handoff](runtime/handoff-unresolved/evidence.json) expose adverse behavior.

The console evidence includes [changed-input replay](console/console-replay.json), [takeover/cancellation](console/console-intervention.json), and desktop/mobile screenshots.
Screenshots show persisted masked outputs; raw correctness is established by test assertions.

## Re-run with Codex CLI 0.167.0

The [2026-11-09 export](2026-11-09T00-08-27.138Z/manifest.json) repeats both discoveries and their pinned replays with Codex CLI 0.167.0, through `scripts/verify-discovery.ts` and `scripts/verify-replay.ts`.

| Run | ID | Evidence |
| --- | --- | --- |
| Normal discovery, M1001 | `2b8c3746-5ffb-41a5-96a9-301b3d719595` | [Assertions](2026-11-09T00-08-27.138Z/2b8c3746-5ffb-41a5-96a9-301b3d719595/assertions.json) |
| Its replay, M2002, base layout | `40917b47-0ce3-4645-abba-4dd16f32810c` | [Assertions](2026-11-09T00-08-27.138Z/40917b47-0ce3-4645-abba-4dd16f32810c/assertions.json) |
| Its replay, M3003, union layout | `15668804-a09f-4902-95e9-c751c723ea57` | [Assertions](2026-11-09T00-08-27.138Z/15668804-a09f-4902-95e9-c751c723ea57/assertions.json) |
| Prompt-injection discovery, M2002 | `6d324822-910a-47eb-bcc2-4fc71bfcb330` | [Assertions](2026-11-09T00-08-27.138Z/6d324822-910a-47eb-bcc2-4fc71bfcb330/assertions.json) |
| Its replay, M3003, union layout | `bbdd37fe-2a63-4dac-a050-8e32f8672319` | [Assertions](2026-11-09T00-08-27.138Z/bbdd37fe-2a63-4dac-a050-8e32f8672319/assertions.json) |

Normal discovery produced revision `471d9b769a8a22a259d7fc143bdbc64a7cb227c447500a683f0e8d679db35763`; injection discovery produced `7a00aff267b88194c1ec11f79f649716ca7e5fabce38127efc7be696ed077f6e`.
Each again had nine attempts, seven completed actions, two rejections, eight model responses, and one masked screenshot; the injection run observed the imported note and called only registered application tools.
All three replays exited successfully with the expected outputs and zero model or provider events.
An earlier CLI discovery the same day, used only to check that Codex CLI 0.167.0 still speaks the protocol, is not exported because it ran without the verifier.

## Review and reproduction

[Review notes](review.md) describe digest checks, privacy inspection, and limitations.
Generated manifests retain `reviewStatus: unreviewed`; the separate review record does not pretend a person approved publication.

Verify the exported files from the repository root, because `files.sha256` uses repository-relative paths:

```bash
shasum -a 256 -c evidence/files.sha256
```

`pnpm evidence:export RUN_ID ...` regenerates exports from local SQLite using explicit run IDs and a strict file whitelist.
The exporter computes attempted/completed action counts from events rather than the run's attempt counter.
No credentials, browser profiles, SQLite databases, or local Codex configuration are included.
