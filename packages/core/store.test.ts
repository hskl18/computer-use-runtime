import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compileCapability } from "./compiler.ts";
import type { Run } from "./contracts.ts";
import { Store } from "./store.ts";
import { compileOptions } from "./test-fixtures.ts";

test("historical runs and pinned invocations retain their exact capability after a new discovery", (context) => {
  const root = mkdtempSync(join(tmpdir(), "computer-use-store-"));
  const store = new Store(root);
  context.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const first = compileCapability({ ...compileOptions(), runId: "first-fixture" });
  const second = compileCapability({ ...compileOptions(), runId: "second-fixture" });
  store.saveCapability(first);
  store.event("first-fixture", "capability.saved", { artifactHash: first.provenance.artifactHash });
  store.saveCapability(second);
  assert.deepEqual(store.capability(first.id), second);
  assert.deepEqual(store.capability(first.id, first.provenance.artifactHash), first);
  assert.deepEqual(store.runCapability("first-fixture"), first);
  assert.equal(store.capability("wrong-id", first.provenance.artifactHash), undefined);
  assert.equal(store.capability(first.id, "../outside"), undefined);
  assert.equal(store.runCapability("missing-run"), undefined);
});

test("restart fails unfinished runs even when they are older than the recent-run page", (context) => {
  const root = mkdtempSync(join(tmpdir(), "computer-use-restart-"));
  let store: Store | undefined = new Store(root);
  context.after(() => {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  const run: Run = {
    id: "old-active",
    mode: "replay",
    goal: "Fixture",
    status: "running",
    backend: "deterministic",
    model: null,
    startedAt: now,
    updatedAt: now,
    step: 0,
    modelCalls: 0,
    scenario: "normal",
    variant: "base",
  };
  store.saveRun(run);
  for (let index = 0; index < 101; index++)
    store.saveRun({ ...run, id: `completed-${index}`, status: "completed" });
  assert.equal(
    store.listRuns().some((item) => item.id === run.id),
    false,
  );
  store.close();
  store = undefined;
  store = new Store(root);
  assert.equal(store.getRun(run.id)?.status, "running", "opening the database must not touch runs");
  store.failStaleRuns();
  assert.equal(store.getRun(run.id)?.status, "failed");
  assert.deepEqual(store.getRun(run.id)?.result, {
    status: "failure",
    code: "WORKER_RESTARTED",
    message: "The worker restarted. The previous browser session cannot be safely resumed.",
    step: 0,
  });
});
