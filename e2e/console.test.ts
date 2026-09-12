import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Page } from "playwright";
import type { Capability, Run, RunEvent } from "../packages/core/contracts.ts";

const origin = "http://127.0.0.1:3100";

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${origin}/api${path}`);
  assert.equal(response.ok(), true, `GET ${path} must succeed`);
  return response.json();
}

async function createReplay(page: Page, scenario: "normal" | "app-error" | "session-expired") {
  const capabilities = await api<Capability[]>(page, "/capabilities");
  const capability = capabilities[0];
  assert.ok(
    capability,
    "A real discovery artifact must exist; this test never seeds capabilities or calls a model",
  );
  const response = await page.request.post(`${origin}/api/runs`, {
    headers: { "x-runtime-client": "console" },
    data: {
      mode: "replay",
      capabilityId: capability.id,
      capabilityHash: capability.provenance.artifactHash,
      inputs: { memberId: "M2002" },
      scenario,
      headless: scenario !== "session-expired",
    },
  });
  assert.equal(response.ok(), true, await response.text());
  return response.json() as Promise<Run>;
}

async function waitForRun(page: Page, id: string, statuses: Run["status"][]) {
  const deadline = Date.now() + 15000;
  let run = await api<Run>(page, `/runs/${id}`);
  while (!statuses.includes(run.status) && Date.now() < deadline) {
    await delay(100);
    run = await api<Run>(page, `/runs/${id}`);
  }
  assert.ok(
    statuses.includes(run.status),
    `Run ${id} did not reach ${statuses.join(" or ")}: ${JSON.stringify(run)}`,
  );
  return run;
}

const terminalStatuses: Run["status"][] = ["completed", "failed", "business_outcome", "cancelled"];

test("mobile history exposes prior failures, screenshot evidence, and incremental events", {
  timeout: 30000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const runs = await api<Run[]>(page, "/runs");
    let failure = runs.find(
      (run) => run.mode === "replay" && run.result?.status === "failure" && run.result.screenshot,
    );
    if (!failure) {
      const created = await createReplay(page, "app-error");
      failure = await waitForRun(page, created.id, terminalStatuses);
      assert.equal(failure.status, "failed");
      assert.equal(failure.result?.status, "failure");
      assert.ok(failure.result?.status === "failure" && failure.result.screenshot);
    }
    await page.goto(origin);
    await page.waitForLoadState("networkidle");
    const history = page.getByLabel("Recent runs", { exact: true });
    assert.equal(await history.isVisible(), true);
    await history.selectOption(failure.id);
    await page
      .locator(".run-summary .mono")
      .getByText(failure.id.slice(0, 8), { exact: true })
      .waitFor();
    await page.getByText("Failure screenshot", { exact: true }).click();
    const screenshot = page.getByRole("img", {
      name: "Failure screenshot of the synthetic application, with sensitive values masked",
    });
    await screenshot.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>(".result-block .evidence-image img");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.match((await screenshot.getAttribute("src")) ?? "", new RegExp(failure.id));
    const incremental = await page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === `/api/runs/${failure.id}/events` &&
        Number(url.searchParams.get("after")) > 0
      );
    });
    const recorded = await api<RunEvent[]>(page, `/runs/${failure.id}/events`);
    assert.equal(
      Number(new URL(incremental.url()).searchParams.get("after")),
      recorded.at(-1)?.sequence,
    );
    assert.equal(await page.locator(".event-count").innerText(), `${recorded.length} events`);
    await mkdir(".local/e2e", { recursive: true });
    await page.screenshot({ path: ".local/e2e/console-mobile-failure.png", fullPage: true });
    await page.getByRole("tab", { name: "Capability", exact: true }).click();
    if (failure.capabilityId) {
      const capability = await api<Capability>(page, `/runs/${failure.id}/capability`);
      await page.locator(".artifact-view pre").waitFor();
      assert.deepEqual(
        JSON.parse(await page.locator(".artifact-view pre").innerText()),
        capability,
      );
    } else {
      await page
        .getByRole("heading", { name: "No recorded capability for this run", exact: true })
        .waitFor();
    }
    await page.getByRole("tab", { name: "Architecture", exact: true }).click();
    await page
      .getByRole("heading", { name: "The model discovers. The runtime executes.", exact: true })
      .waitFor();
    assert.ok((await page.locator("body").evaluate((body) => body.scrollWidth)) <= 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("historical run inspector displays its exact recorded capability", {
  timeout: 30000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const runs = await api<Run[]>(page, "/runs");
    let recorded = runs.find((run) => run.status === "completed" && run.capabilityId);
    if (!recorded) {
      const created = await createReplay(page, "normal");
      recorded = await waitForRun(page, created.id, terminalStatuses);
      assert.equal(recorded.status, "completed", JSON.stringify(recorded));
    }
    const capability = await api<Capability>(page, `/runs/${recorded.id}/capability`);
    await page.goto(`${origin}/?run=${recorded.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Capability", exact: true }).click();
    await page.locator(".artifact-view pre").waitFor();
    assert.deepEqual(JSON.parse(await page.locator(".artifact-view pre").innerText()), capability);
    assert.equal(
      await page
        .getByText(
          "The exact artifact recorded for this run. Inputs are bound at invocation time.",
          { exact: true },
        )
        .isVisible(),
      true,
    );
    await mkdir(".local/e2e", { recursive: true });
    await page.screenshot({ path: ".local/e2e/console-recorded-artifact.png", fullPage: true });
  } finally {
    await browser.close();
  }
});

test("console launches a real capability replay with a new member and zero model events", {
  timeout: 30000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const capabilities = await api<Capability[]>(page, "/capabilities");
    assert.ok(
      capabilities.length,
      "A real discovery artifact must exist; this test does not seed capabilities",
    );
    await page.goto(origin);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Member ID", { exact: true }).fill("M2002");
    await page.getByLabel("Scenario", { exact: true }).selectOption("normal");
    await page.getByLabel("Application variant", { exact: true }).selectOption("union");
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/runs` && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Replay", exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.ok(), true, await response.text());
    const created: Run = await response.json();
    assert.equal(created.mode, "replay");
    assert.equal(created.capabilityId, capabilities[0]?.id);
    await page
      .locator(".run-summary .mono")
      .getByText(created.id.slice(0, 8), { exact: true })
      .waitFor();
    await page.getByText("Checkpoint passed", { exact: true }).waitFor();
    const finished = await api<Run>(page, `/runs/${created.id}`);
    assert.equal(finished.status, "completed", JSON.stringify(finished));
    assert.equal(finished.modelCalls, 0);
    const rawResult = await page.request.get(`${origin}/api/runs/${created.id}/result`, {
      headers: { "x-runtime-client": "console" },
    });
    assert.equal(rawResult.ok(), true);
    assert.deepEqual(await rawResult.json(), {
      status: "success",
      outputs: { balance: "8032.10", currency: "USD" },
    });
    const events = await api<RunEvent[]>(page, `/runs/${created.id}/events`);
    assert.equal(events.filter((event) => event.type.startsWith("model.")).length, 0);
    await page.waitForFunction(
      (expected) => document.querySelector(".event-count")?.textContent === `${expected} events`,
      events.length,
    );
    assert.equal(
      await page.locator(".timeline-step").count(),
      events.filter((event) => event.type === "action.completed").length,
    );
    await page.getByText("Checkpoint passed", { exact: true }).waitFor();
    assert.equal(await page.locator(".run-summary .mono").innerText(), created.id.slice(0, 8));
    assert.deepEqual(errors, []);
    await mkdir(".local/e2e", { recursive: true });
    await page.screenshot({ path: ".local/e2e/console-replay.png", fullPage: true });
    await writeFile(
      ".local/e2e/console-replay.json",
      `${JSON.stringify({ evidenceKind: "console_browser_integration", runId: created.id, artifactHash: (await api<Capability>(page, `/runs/${created.id}/capability`)).provenance.artifactHash, mode: finished.mode, status: finished.status, modelEvents: 0, expectedOutputsVerified: true, scenario: finished.scenario, variant: finished.variant }, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
});

test("paused replay exposes its intervention image and console takeover can be cancelled", {
  timeout: 30000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let runId: string | undefined;
  try {
    const created = await createReplay(page, "session-expired");
    runId = created.id;
    const paused = await waitForRun(page, runId, ["paused", ...terminalStatuses]);
    assert.equal(paused.status, "paused", JSON.stringify(paused));
    await page.goto(`${origin}/?run=${runId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Take control", exact: true }).waitFor();
    await page.getByText("Intervention screenshot", { exact: true }).click();
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>(".handoff-panel .evidence-image img");
      return image?.complete && image.naturalWidth > 0;
    });
    const image = page.getByRole("img", {
      name: "Intervention screenshot of the synthetic application, with sensitive values masked",
    });
    assert.equal(await image.isVisible(), true);
    assert.match((await image.getAttribute("src")) ?? "", new RegExp(runId));
    await page.getByRole("button", { name: "Take control", exact: true }).click();
    await page.getByRole("button", { name: "Return control", exact: true }).waitFor();
    assert.equal((await api<Run>(page, `/runs/${runId}`)).status, "human");
    await mkdir(".local/e2e", { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: ".local/e2e/console-intervention.png", fullPage: true });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const cancelled = await waitForRun(page, runId, terminalStatuses);
    assert.equal(cancelled.status, "cancelled", JSON.stringify(cancelled));
    await page.getByText("Intervention recorded", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Take control", exact: true }).count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Return control", exact: true }).count(),
      0,
    );
    const events = await api<RunEvent[]>(page, `/runs/${runId}/events`);
    assert.equal(events.filter((event) => event.type.startsWith("model.")).length, 0);
    assert.ok(
      events.some((event) => event.type === "session.control" && event.data.owner === "human"),
    );
    await writeFile(
      ".local/e2e/console-intervention.json",
      `${JSON.stringify({ evidenceKind: "console_browser_integration", runId, screenshotLoaded: true, takeoverVerified: true, terminalStatus: cancelled.status, operator: "Console controls automated by Playwright; no human browser interaction", modelEvents: 0 }, null, 2)}\n`,
    );
  } finally {
    if (runId) {
      const run = await api<Run>(page, `/runs/${runId}`);
      if (!terminalStatuses.includes(run.status)) {
        const response = await page.request.post(`${origin}/api/runs/${runId}/control`, {
          headers: { "x-runtime-client": "console" },
          data: { action: "cancel" },
        });
        assert.equal(response.ok(), true, await response.text());
        await waitForRun(page, runId, terminalStatuses);
      }
    }
    await browser.close();
  }
});
