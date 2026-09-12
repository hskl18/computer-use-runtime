import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { type Browser, chromium } from "playwright";
import { registerSandbox } from "../apps/sandbox/index.ts";
import { Runtime } from "../apps/worker/runtime.ts";
import { BrowserSurface } from "../packages/browser/playwright.ts";
import { artifactHash } from "../packages/core/compiler.ts";
import {
  type Capability,
  capabilitySchema,
  type Run,
  type RunRequest,
} from "../packages/core/contracts.ts";

const fixturePort = 3211;
const repository = resolve(".");
const evaluationRoot = join(
  repository,
  ".local/e2e/runtime",
  new Date().toISOString().replaceAll(":", "-"),
);
const server = Fastify({ logger: false });
let capability: Capability;
const summaries: Record<string, unknown>[] = [];

before(async () => {
  const path = join(repository, "capabilities/lookup-savings-balance.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      "Runtime E2E prerequisite missing: complete a real discovery to create capabilities/lookup-savings-balance.json. This suite never seeds or fabricates a capability.",
    );
  }
  capability = capabilitySchema.parse(JSON.parse(raw));
  assert.equal(capability.provenance.artifactHash, artifactHash(capability));
  assert.equal(capability.provenance.backend, "codex");
  assert.equal(capability.provenance.model, "gpt-6-astra");
  await mkdir(evaluationRoot, { recursive: true });
  registerSandbox(server);
  await server.listen({ port: fixturePort, host: "127.0.0.1" });
});

after(async () => {
  await server.close();
  if (summaries.length)
    await writeFile(
      join(evaluationRoot, "manifest.json"),
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          evidenceKind: "real_runtime_integration_test",
          artifactHash: capability.provenance.artifactHash,
          discoveryRunId: capability.provenance.runId,
          operator: "Playwright-simulated trusted input in the runtime-owned browser, not a person",
          runs: summaries,
        },
        null,
        2,
      )}\n`,
    );
});

async function harness(name: string) {
  const root = join(evaluationRoot, name);
  await mkdir(join(root, "policies"), { recursive: true });
  await mkdir(join(root, "capabilities"), { recursive: true });
  await copyFile(
    join(repository, "policies/local-demo.json"),
    join(root, "policies/local-demo.json"),
  );
  await writeFile(
    join(root, "capabilities/lookup-savings-balance.json"),
    `${JSON.stringify(capability, null, 2)}\n`,
  );
  let browser: Browser | undefined;
  let surface: BrowserSurface | undefined;
  let launchedHeadless: boolean | undefined;
  const runtime = new Runtime(root, fixturePort, (policy, emit, inputs) => {
    surface = new BrowserSurface(policy, emit, inputs, async (options) => {
      launchedHeadless = options.headless;
      browser = await chromium.launch(options);
      return browser;
    });
    return surface;
  });
  return {
    name,
    root,
    runtime,
    browser: () => {
      assert.ok(browser, "Runtime must open its own browser first.");
      return browser;
    },
    surface: () => {
      assert.ok(surface);
      return surface;
    },
    launchedHeadless: () => launchedHeadless,
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

function start(h: Harness, options: Partial<RunRequest> = {}) {
  return h.runtime.start({
    mode: "replay",
    capabilityId: capability.id,
    inputs: { memberId: "M2002" },
    headless: true,
    ...options,
  });
}

async function waitForStatus(h: Harness, run: Run, status: Run["status"]): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const current = h.runtime.store.getRun(run.id);
    if (current?.status === status) return;
    if (
      current &&
      ["completed", "failed", "cancelled", "business_outcome"].includes(current.status)
    )
      assert.fail(`Expected ${status}; run finished: ${JSON.stringify(current.result)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Run did not reach ${status} before the deadline.`);
}

async function finish(h: Harness, run: Run, extra: Record<string, unknown> = {}) {
  const completed = await h.runtime.wait(run.id);
  assert.ok(completed);
  const events = h.runtime.store.events(run.id);
  assert.equal(completed.modelCalls, 0);
  assert.equal(completed.model, null);
  assert.equal(events.filter((event) => event.type.startsWith("model.")).length, 0);
  const replay = events.find((event) => event.type === "replay.started");
  assert.equal(replay?.data.artifactHash, capability.provenance.artifactHash);
  assert.equal(replay?.data.modelAccess, "disabled");
  if (extra.expectedOutputsVerified) assertSuccess(h.runtime.result(run.id));
  const summary = {
    test: h.name,
    runId: completed.id,
    scenario: completed.scenario,
    variant: completed.variant,
    status: completed.status,
    result: completed.result,
    modelEvents: 0,
    artifactHash: replay?.data.artifactHash,
    browserHeadless: h.launchedHeadless(),
    evidenceDirectory: join(h.root, ".local/runs", completed.id),
    ...extra,
  };
  const serialized = JSON.stringify({ summary, events }, null, 2);
  assert.equal(
    serialized.includes("M2002"),
    false,
    "Persisted evidence must redact invocation inputs.",
  );
  assert.equal(serialized.includes("8032.10"), false, "Persisted evidence must redact balances.");
  await writeFile(join(h.root, "evidence.json"), `${serialized}\n`);
  summaries.push(summary);
  return { completed, events, result: h.runtime.result(run.id) };
}

function assertSuccess(result: unknown) {
  assert.deepEqual(result, { status: "success", outputs: { balance: "8032.10", currency: "USD" } });
}

for (const variant of ["base", "union"] as const) {
  test(`real artifact replays changed input in ${variant} without model events`, async () => {
    const h = await harness(`success-${variant}`);
    try {
      const run = start(h, { variant });
      const { completed, result } = await finish(h, run, { expectedOutputsVerified: true });
      assert.equal(completed.status, "completed");
      assertSuccess(result);
      assert.deepEqual(completed.result, {
        status: "success",
        outputs: { balance: "[REDACTED]", currency: "[REDACTED]" },
      });
    } finally {
      await h.runtime.close();
    }
  });
}

for (const [scenario, code] of [
  ["not-found", "MEMBER_NOT_FOUND"],
  ["permission-denied", "ACCESS_DENIED"],
  ["validation-error", "INVALID_MEMBER_ID"],
] as const) {
  test(`${scenario} returns a business outcome`, async () => {
    const h = await harness(scenario);
    try {
      const { completed, result } = await finish(h, start(h, { scenario }));
      assert.equal(completed.status, "business_outcome");
      assert.ok(result?.status === "business_outcome");
      assert.equal(result.code, code);
    } finally {
      await h.runtime.close();
    }
  });
}

test("transient failure recovers once and returns the changed member output", async () => {
  const h = await harness("transient");
  try {
    const { events, result } = await finish(h, start(h, { scenario: "transient" }));
    assertSuccess(result);
    const recoveries = events.filter((event) => event.type === "recovery.started");
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0]?.data.attempt, 1);
    assert.equal(recoveries[0]?.data.action, "reload");
  } finally {
    await h.runtime.close();
  }
});

test("zero recovery budget fails before retrying", async () => {
  const h = await harness("recovery-exhausted");
  try {
    h.runtime.policy.maxRecoveries = 0;
    const { events, result } = await finish(h, start(h, { scenario: "transient" }));
    assert.ok(result?.status === "failure");
    assert.equal(result.code, "RECOVERY_EXHAUSTED");
    assert.equal(events.filter((event) => event.type === "recovery.started").length, 0);
  } finally {
    await h.runtime.close();
  }
});

test("slow native iframe navigation completes without a model", async () => {
  const h = await harness("slow");
  try {
    const { completed, result } = await finish(h, start(h, { scenario: "slow" }));
    assertSuccess(result);
    assert.ok((completed.durationMs ?? 0) >= 900);
  } finally {
    await h.runtime.close();
  }
});

for (const [scenario, code] of [
  ["app-error", "APP_ERROR"],
  ["duplicate-control", "TARGET_AMBIGUOUS"],
  ["session-expired", "HEADLESS_HANDOFF_UNAVAILABLE"],
] as const) {
  test(`${scenario} preserves its hard failure code`, async () => {
    const h = await harness(`failure-${scenario}`);
    try {
      const { completed, result } = await finish(h, start(h, { scenario }));
      assert.equal(completed.status, "failed");
      assert.ok(result?.status === "failure");
      assert.equal(result.code, code);
      assert.ok(result.screenshot);
    } finally {
      await h.runtime.close();
    }
  });
}

for (const [scenario, control] of [
  ["session-expired", "Resume session"],
  ["unexpected-dialog", "Dismiss notice"],
] as const) {
  test(`${scenario} pauses and resumes the same runtime-owned browser`, async () => {
    const h = await harness(`handoff-${scenario}`);
    try {
      const run = start(h, { scenario, headless: false });
      await waitForStatus(h, run, "paused");
      const browser = h.browser();
      const context = browser.contexts()[0];
      assert.ok(context);
      const page = context.pages()[0];
      assert.ok(page);
      const sessionId = h.surface().sessionId;
      const step = h.runtime.store.getRun(run.id)?.step;
      h.runtime.control(run.id, "take");
      assert.equal(h.runtime.store.getRun(run.id)?.status, "human");
      assert.equal(h.runtime.store.getRun(run.id)?.step, step);
      const workspace = page.frameLocator('iframe[title="Member workspace"]');
      await workspace.getByRole("button", { name: control, exact: true }).click();
      if (scenario === "session-expired")
        await workspace.getByRole("heading", { name: "Member detail", exact: true }).waitFor();
      else await workspace.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(browser.contexts()[0], context);
      assert.equal(context.pages()[0], page);
      assert.equal(h.surface().sessionId, sessionId);
      await h.surface().screenshot(join(h.root, "operator-resolved.png"));
      h.runtime.control(run.id, "resume");
      const { events, result } = await finish(h, run, {
        operator: "Playwright-simulated trusted input, not a person",
        sameBrowserContextAndPage: true,
        sessionId,
        expectedOutputsVerified: true,
      });
      assertSuccess(result);
      assert.deepEqual(
        events.filter((event) => event.type === "session.control").map((event) => event.data.owner),
        ["paused", "human", "automation"],
      );
      const action = events.find(
        (event) => event.type === "human.action" && event.data.control === control,
      );
      assert.ok(action);
      assert.equal(action.data.sessionId, sessionId);
      assert.equal(
        events.find((event) => event.type === "intervention.resumed")?.data.sessionId,
        sessionId,
      );
      assert.equal(
        events.find((event) => event.type === "session.opened")?.data.sessionId,
        sessionId,
      );
      assert.equal(events.filter((event) => event.type === "session.opened").length, 1);
      assert.ok(
        events.some(
          (event) => event.type === "action.completed" && event.sequence > action.sequence,
        ),
      );
    } finally {
      await h.runtime.close();
    }
  });
}

test("returning control without resolving the blocker fails explicitly", async () => {
  const h = await harness("handoff-unresolved");
  try {
    const run = start(h, { scenario: "session-expired", headless: false });
    await waitForStatus(h, run, "paused");
    h.runtime.control(run.id, "take");
    h.runtime.control(run.id, "resume");
    const { events, result } = await finish(h, run);
    assert.ok(result?.status === "failure");
    assert.equal(result.code, "HANDOFF_UNRESOLVED");
    assert.equal(events.filter((event) => event.type === "human.action").length, 0);
  } finally {
    await h.runtime.close();
  }
});

test("cancelling a paused run closes its browser and returns CANCELLED", async () => {
  const h = await harness("cancelled");
  try {
    const run = start(h, { scenario: "session-expired", headless: false });
    await waitForStatus(h, run, "paused");
    const browser = h.browser();
    h.runtime.control(run.id, "cancel");
    const { completed, result } = await finish(h, run);
    assert.equal(completed.status, "cancelled");
    assert.ok(result?.status === "failure");
    assert.equal(result.code, "CANCELLED");
    assert.equal(browser.isConnected(), false);
  } finally {
    await h.runtime.close();
  }
});
