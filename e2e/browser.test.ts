import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { type Browser, chromium, type Page } from "playwright";
import { BrowserSurface } from "../packages/browser/playwright.ts";
import {
  type Action,
  type Inputs,
  policySchema,
  RuntimeError,
} from "../packages/core/contracts.ts";
import { SessionController } from "../packages/core/session.ts";

const policy = policySchema.parse(JSON.parse(await readFile("policies/local-demo.json", "utf8")));
const frame = "Member workspace";
const reason = "Verify the local synthetic browser adapter.";
type Event = { type: string; data: Record<string, unknown> };

async function openSurface(scenario = "normal", variant = "base", memberId = "M1001") {
  const inputs: Inputs = { memberId };
  const events: Event[] = [];
  let browser: Browser | undefined;
  const surface = new BrowserSurface(
    policy,
    (type, data) => events.push({ type, data }),
    inputs,
    async (options) => {
      browser = await chromium.launch(options);
      return browser;
    },
  );
  await surface.open(
    `${policy.allowedOrigins[0]}/sandbox/?${new URLSearchParams({ scenario, variant })}`,
    true,
  );
  assert.ok(browser);
  const context = browser.contexts()[0];
  assert.ok(context);
  const page = context.pages()[0];
  assert.ok(page);
  await page.waitForLoadState("networkidle");
  assert.match((await surface.observe()).text, /Member search/);
  return { surface, inputs, events, browser, context, page };
}

const click = (name: string, role: "button" | "link" = "button"): Action => ({
  type: "click",
  target: { by: "role", role, name, frame },
  reason,
});

async function search(surface: BrowserSurface, inputs: Inputs): Promise<void> {
  await surface.execute(
    {
      type: "fill",
      target: { by: "label", text: "Member ID", frame },
      value: { input: "memberId" },
      reason,
    },
    inputs,
  );
  await surface.execute(click("Search"), inputs);
}

async function accounts(surface: BrowserSurface, inputs: Inputs): Promise<void> {
  await search(surface, inputs);
  await surface.execute(click("Open member", "link"), inputs);
  await surface.execute(click("View accounts", "link"), inputs);
}

async function readOutputs(surface: BrowserSurface, inputs: Inputs) {
  await surface.execute(
    {
      type: "checkpoint",
      target: { by: "tableCell", row: "Member ID", column: "Value", frame },
      expect: "equals",
      value: { input: "memberId" },
      reason,
    },
    inputs,
  );
  const balance = await surface.execute(
    {
      type: "read",
      target: { by: "tableCell", row: "Savings", column: "Available balance", frame },
      output: "balance",
      format: "money",
      sensitive: true,
      reason,
    },
    inputs,
  );
  const currency = await surface.execute(
    {
      type: "read",
      target: { by: "tableCell", row: "Savings", column: "Currency", frame },
      output: "currency",
      format: "text",
      sensitive: false,
      reason,
    },
    inputs,
  );
  return { balance, currency };
}

const errorCode = (code: string) => (error: unknown) =>
  error instanceof RuntimeError && error.code === code;

async function workspaceMarkup(page: Page) {
  return page.frameLocator('iframe[title="Member workspace"]').locator("body").innerHTML();
}

for (const variant of ["base", "union"]) {
  for (const [memberId, balance] of [
    ["M1001", "1245.67"],
    ["M2002", "8032.10"],
  ] as const) {
    test(`semantic table targeting returns ${memberId} outputs in ${variant}`, async () => {
      const { surface, inputs, events } = await openSurface("normal", variant, memberId);
      try {
        await accounts(surface, inputs);
        assert.deepEqual(await readOutputs(surface, inputs), { balance, currency: "USD" });
        surface.assertState();
        assert.equal(events.filter((event) => event.type === "human.action").length, 0);
      } finally {
        await surface.close();
      }
    });
  }
}

test("ambiguous Search fails before either control is clicked", async () => {
  const { surface, inputs, page } = await openSurface("duplicate-control");
  try {
    const before = await workspaceMarkup(page);
    await assert.rejects(surface.execute(click("Search"), inputs), errorCode("TARGET_AMBIGUOUS"));
    assert.equal(await workspaceMarkup(page), before);
    assert.equal(await surface.hasHeading("Member search"), true);
  } finally {
    await surface.close();
  }
});

test("native iframe form navigation waits for a delayed response", async () => {
  const { surface, inputs } = await openSurface("slow");
  try {
    await accounts(surface, inputs);
    assert.deepEqual(await readOutputs(surface, inputs), { balance: "1245.67", currency: "USD" });
  } finally {
    await surface.close();
  }
});

test("dialog detection ignores hidden synthetic dialogs", async () => {
  const { surface, page } = await openSurface();
  try {
    const body = page.frameLocator('iframe[title="Member workspace"]').locator("body");
    await body.evaluate((element) => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.textContent = "Synthetic visibility test";
      dialog.hidden = true;
      element.append(dialog);
    });
    assert.equal(await surface.hasDialog(), false);
    await body.locator('[role="dialog"]').evaluate((element) => element.removeAttribute("hidden"));
    assert.equal(await surface.hasDialog(), true);
  } finally {
    await surface.close();
  }
});

test("risky transfer action is blocked before changing the live DOM", async () => {
  const { surface, inputs, page } = await openSurface("risky");
  try {
    await accounts(surface, inputs);
    const before = await workspaceMarkup(page);
    await assert.rejects(
      surface.execute(click("Submit transfer"), inputs),
      errorCode("RISKY_ACTION_BLOCKED"),
    );
    assert.equal(await workspaceMarkup(page), before);
    assert.equal(
      await page
        .frameLocator('iframe[title="Member workspace"]')
        .locator("body")
        .getAttribute("data-risky-activated"),
      null,
    );
  } finally {
    await surface.close();
  }
});

test("same browser session pauses, records a simulated operator, and resumes", async () => {
  const { surface, inputs, events, browser, context, page } = await openSurface("session-expired");
  const owners: string[] = [];
  const session = new SessionController(policy, (owner) => {
    owners.push(owner);
    surface.setHuman(owner === "human");
  });
  try {
    await search(surface, inputs);
    await surface.execute(click("Open member", "link"), inputs);
    assert.equal(await surface.hasHeading("Session expired"), true);
    const sessionId = surface.sessionId;
    const pending = session.waitForHuman("Restore the local synthetic session.");
    assert.equal(session.owner, "paused");
    assert.throws(() => session.assertAutomation(), errorCode("CONTROL_NOT_OWNED"));
    session.takeControl();
    assert.equal(session.owner, "human");
    await assert.rejects(
      surface.execute(click("Resume session"), inputs),
      errorCode("CONTROL_NOT_OWNED"),
    );
    const beforeUntrustedEvent = events.filter((event) => event.type === "human.action").length;
    await page
      .frameLocator('iframe[title="Member workspace"]')
      .locator("body")
      .dispatchEvent("change");
    assert.equal(
      events.filter((event) => event.type === "human.action").length,
      beforeUntrustedEvent,
    );

    // Playwright dispatches a trusted browser input event, simulating an operator in the same page.
    // This verifies the capture mechanism; it does not claim a person performed the interaction.
    const resumeControl = page
      .frameLocator('iframe[title="Member workspace"]')
      .getByRole("button", { name: "Resume session", exact: true });
    await resumeControl.click();
    await page
      .frameLocator('iframe[title="Member workspace"]')
      .getByRole("heading", { name: "Member detail", exact: true })
      .waitFor();
    assert.equal(await surface.hasHeading("Member detail"), true);
    assert.ok((await context.cookies()).some((cookie) => cookie.name === "operator"));
    assert.ok(
      events.some(
        (event) =>
          event.type === "human.action" &&
          event.data.type === "click" &&
          event.data.control === "Resume session" &&
          event.data.sessionId === sessionId,
      ),
    );
    session.resume();
    await pending;
    session.assertAutomation();
    assert.deepEqual(owners, ["paused", "human", "automation"]);
    assert.equal(surface.sessionId, sessionId);
    assert.equal(browser.contexts()[0], context);
    assert.equal(context.pages()[0], page);
    const humanActionCount = events.filter((event) => event.type === "human.action").length;
    await surface.execute(click("View accounts", "link"), inputs);
    assert.deepEqual(await readOutputs(surface, inputs), { balance: "1245.67", currency: "USD" });
    assert.equal(events.filter((event) => event.type === "human.action").length, humanActionCount);
    surface.assertState();
    await mkdir(".local/e2e", { recursive: true });
    await surface.screenshot(".local/e2e/browser-handoff.png");
    await writeFile(
      ".local/e2e/browser-handoff.json",
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          evidenceKind: "browser_adapter_integration_test",
          operator: "Playwright-simulated trusted input, not a person",
          sameBrowserContextAndPage: true,
          sessionId,
          owners,
          events,
          result: { balance: "1245.67", currency: "USD" },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    session.complete();
    await surface.close();
  }
});
