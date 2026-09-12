import { createHash, randomUUID } from "node:crypto";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Frame,
  type Locator,
  type Page,
} from "playwright";
import {
  type Action,
  type Inputs,
  type Policy,
  RuntimeError,
  resolveValue,
  type Target,
} from "../core/contracts.ts";
import { assertAction, assertClick, assertUrl, redact } from "../core/policy.ts";
import type { Observation, Surface } from "./adapter.ts";

type Emit = (type: string, data: Record<string, unknown>) => void;

export class BrowserSurface implements Surface {
  readonly sessionId = randomUUID();
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private human = false;
  private pendingDialog = "";
  private blockedRequest = false;
  constructor(
    private policy: Policy,
    private emit: Emit,
    private inputs: Inputs,
    private launchBrowser: (options: { headless: boolean }) => Promise<Browser> = (options) =>
      chromium.launch(options),
  ) {}

  async open(url: string, headless: boolean): Promise<void> {
    assertUrl(url, this.policy);
    this.browser = await this.launchBrowser({ headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1180, height: 860 },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await this.context.route("**/*", async (route) => {
      try {
        assertUrl(route.request().url(), this.policy);
        await route.continue();
      } catch {
        this.blockedRequest = true;
        this.emit("policy.blocked_request", {
          message: "A request outside the allowlist was blocked.",
        });
        await route.abort("blockedbyclient");
      }
    });
    await this.context.exposeBinding(
      "__recordHumanAction",
      async ({ frame }, data: Record<string, unknown>) => {
        if (this.human)
          this.emit("human.action", {
            ...data,
            frame: frame.parentFrame()
              ? ((await frame.frameElement().then((element) => element.getAttribute("title"))) ??
                frame.name())
              : "main",
            sessionId: this.sessionId,
          });
      },
    );
    await this.context.addInitScript(() => {
      for (const type of ["click", "change", "submit"])
        document.addEventListener(
          type,
          (event) => {
            const element = event.target;
            if (!(element instanceof HTMLElement) || !event.isTrusted) return;
            const sink = (
              window as unknown as {
                __recordHumanAction: (data: Record<string, unknown>) => Promise<void>;
              }
            ).__recordHumanAction;
            void sink({
              type,
              control:
                element.getAttribute("aria-label") ||
                element.textContent?.trim().slice(0, 100) ||
                element.tagName,
              value: element instanceof HTMLInputElement ? "[REDACTED]" : undefined,
            });
          },
          true,
        );
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.policy.actionTimeoutMs);
    this.context.on("page", (page) => {
      if (page !== this.page) {
        this.emit("policy.blocked_popup", {});
        void page.close();
      }
    });
    this.page.on("dialog", (dialog) => {
      this.pendingDialog = dialog.message().slice(0, 200);
      void dialog.dismiss();
    });
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.frameLocator('iframe[title="Member workspace"]').locator("body").waitFor();
    this.emit("session.opened", { sessionId: this.sessionId, headless });
  }

  setHuman(value: boolean): void {
    this.human = value;
  }
  url(): string {
    return this.page?.url() ?? "";
  }
  private frames(): Frame[] {
    return this.page.frames().filter((frame) => !frame.isDetached());
  }

  private async snapshotFrames(): Promise<{ title: string; url: string; snapshot: string }[]> {
    const parts: { title: string; url: string; snapshot: string }[] = [];
    for (const frame of this.frames()) {
      const title =
        frame === this.page.mainFrame()
          ? "main"
          : ((await frame.frameElement().then((el) => el.getAttribute("title"))) ?? "child");
      parts.push({
        title,
        url: frame.url(),
        snapshot: await frame
          .locator("body")
          .ariaSnapshot({ timeout: this.policy.actionTimeoutMs }),
      });
    }
    return parts;
  }

  async observe(withImage = false): Promise<Observation> {
    const frames = await this.snapshotFrames();
    // Navigation happens inside the workspace frame, so the page URL alone never shows progress.
    const text = redact(
      frames.map((frame) => `Frame: ${frame.title} (${frame.url})\n${frame.snapshot}`).join("\n\n"),
      this.inputs,
    ) as string;
    return {
      url: this.page.url(),
      frameUrls: redact(
        frames.map((frame) => `${frame.title}: ${frame.url}`),
        this.inputs,
      ) as string[],
      text,
      ...(withImage
        ? { image: `data:image/png;base64,${(await this.maskedScreenshot()).toString("base64")}` }
        : {}),
    };
  }

  // Compared only in memory; a changed signature is not proof of business success.
  async signature(): Promise<string> {
    const frames = await this.snapshotFrames();
    return createHash("sha256")
      .update(frames.map((frame) => `${frame.title}\n${frame.url}\n${frame.snapshot}`).join("\n"))
      .digest("hex");
  }

  assertState(): void {
    if (this.blockedRequest) {
      this.blockedRequest = false;
      throw new RuntimeError(
        "POLICY_REQUEST_BLOCKED",
        "The page attempted an out-of-policy request.",
      );
    }
    if (this.pendingDialog) {
      const message = this.pendingDialog;
      this.pendingDialog = "";
      throw new RuntimeError(
        "UNEXPECTED_NATIVE_DIALOG",
        "A native dialog was dismissed and execution stopped for review.",
        { observed: message },
      );
    }
  }

  async hasHeading(name: string): Promise<boolean> {
    for (const frame of this.frames()) {
      const heading = frame.getByRole("heading", { name, exact: true });
      if ((await heading.count()) === 1 && (await heading.isVisible())) return true;
    }
    return false;
  }

  private async locate(target: Target): Promise<Locator> {
    let frame = this.page.mainFrame();
    if (target.frame) {
      const matches: Frame[] = [];
      for (const candidate of this.frames().filter((entry) => entry !== this.page.mainFrame())) {
        if (
          (await candidate.frameElement().then((el) => el.getAttribute("title"))) === target.frame
        )
          matches.push(candidate);
      }
      if (matches.length !== 1)
        throw new RuntimeError("FRAME_AMBIGUOUS", "Expected exactly one matching frame.", {
          expected: target.frame,
          observed: String(matches.length),
        });
      frame = matches[0] as Frame;
    }
    let locator: Locator;
    if (target.by === "role")
      locator = frame.getByRole(target.role, { name: target.name, exact: true });
    else if (target.by === "label") locator = frame.getByLabel(target.text, { exact: true });
    else if (target.by === "text") locator = frame.getByText(target.text, { exact: true });
    else {
      const tables = frame.locator("table");
      const candidates: Locator[] = [];
      for (let i = 0; i < (await tables.count()); i++) {
        const table = tables.nth(i);
        const headers = (await table.locator("tr").first().locator("th,td").allTextContents()).map(
          (text) => text.trim(),
        );
        const column = headers.indexOf(target.column);
        if (column < 0 || headers.lastIndexOf(target.column) !== column) continue;
        const rows = table
          .locator("tr")
          .filter({ has: frame.getByText(target.row, { exact: true }) });
        for (let j = 0; j < (await rows.count()); j++)
          candidates.push(rows.nth(j).locator("td,th").nth(column));
      }
      if (candidates.length !== 1)
        throw new RuntimeError("TARGET_AMBIGUOUS", "Expected one table cell.", {
          expected: `${target.row} / ${target.column}`,
          observed: String(candidates.length),
        });
      locator = candidates[0] as Locator;
    }
    await locator.first().waitFor({ state: "visible" });
    if ((await locator.count()) !== 1)
      throw new RuntimeError(
        "TARGET_AMBIGUOUS",
        "Refusing to choose between multiple matching controls.",
      );
    return locator;
  }

  async isVisible(target: Target): Promise<boolean> {
    try {
      return await (await this.locate(target)).isVisible();
    } catch {
      return false;
    }
  }
  async hasDialog(): Promise<boolean> {
    return (
      await Promise.all(
        this.frames().map((frame) =>
          frame.locator('dialog[open]:visible, [role="dialog"]:visible').count(),
        ),
      )
    ).some(Boolean);
  }

  async execute(action: Action, inputs: Inputs): Promise<string | number | undefined> {
    if (this.human)
      throw new RuntimeError("CONTROL_NOT_OWNED", "Automation does not own the browser.");
    assertAction(action, this.policy);
    for (const frame of this.frames()) assertUrl(frame.url(), this.policy);
    if (action.type === "navigate") {
      const url = new URL(action.path, this.policy.allowedOrigins[0]);
      assertUrl(url.href, this.policy);
      await this.page.goto(url.href, { waitUntil: "domcontentloaded" });
      return;
    }
    if (action.type === "scroll") {
      await this.page.mouse.wheel(0, action.direction === "down" ? 500 : -500);
      return;
    }
    const locator = await this.locate(action.target);
    if (action.type === "click") {
      const name = (await locator.getAttribute("aria-label")) || (await locator.innerText()).trim();
      assertClick(name, this.policy);
      const navigationFrame = await this.navigationFrame(locator);
      if (navigationFrame) {
        const controller = new AbortController();
        // Playwright's click barrier skips child-frame navigations, so subscribe before input.
        const navigation = this.page
          .waitForEvent("framenavigated", {
            predicate: (frame) => frame === navigationFrame,
            timeout: this.policy.actionTimeoutMs,
            signal: controller.signal,
          })
          .then((frame) => frame.waitForLoadState("domcontentloaded"));
        try {
          await Promise.all([navigation, locator.click()]);
        } finally {
          controller.abort();
        }
      } else await locator.click();
      await this.settle();
    } else if (action.type === "fill") {
      if ((await locator.getAttribute("type")) === "password")
        throw new RuntimeError(
          "SECRET_INPUT_BLOCKED",
          "Credential entry is not supported by this demo.",
        );
      await locator.fill(resolveValue(action.value, inputs));
    } else if (action.type === "select") {
      await locator.selectOption({ label: resolveValue(action.value, inputs) });
    } else if (action.type === "read") {
      const text = (await locator.innerText()).trim();
      if (action.format === "money") {
        if (!/^-?\d{1,3}(?:,\d{3})*\.\d{2}$|^-?\d+\.\d{2}$/.test(text))
          throw new RuntimeError("OUTPUT_INVALID", "Expected a decimal money value.");
        return text.replaceAll(",", "");
      }
      if (action.format === "number") {
        const value = Number(text);
        if (!Number.isFinite(value) || !text)
          throw new RuntimeError("OUTPUT_INVALID", "Expected a finite number.");
        return value;
      }
      return text;
    } else if (action.type === "checkpoint" && action.expect !== "visible") {
      if (!action.value)
        throw new RuntimeError("CHECKPOINT_INVALID", "A comparison checkpoint needs a value.");
      const expected = resolveValue(action.value, inputs);
      const actual = (await locator.innerText()).trim();
      const passed = action.expect === "equals" ? actual === expected : actual.includes(expected);
      if (!passed)
        throw new RuntimeError(
          "CHECKPOINT_FAILED",
          "The observed state does not match the checkpoint.",
          { expected, observed: actual },
        );
    }
  }

  private async navigationFrame(locator: Locator): Promise<Frame | undefined> {
    const target = await locator.evaluate((element) => {
      const link = element.closest("a[href]");
      if (link instanceof HTMLAnchorElement && !link.hasAttribute("download"))
        return link.target || "_self";
      if (
        ((element instanceof HTMLButtonElement && element.type === "submit") ||
          (element instanceof HTMLInputElement && ["submit", "image"].includes(element.type))) &&
        element.form &&
        !element.form.matches(":invalid")
      )
        return element.formTarget || element.form.target || "_self";
      return null;
    });
    if (!target || target === "_blank") return;
    const handle = await locator.elementHandle();
    const frame = await handle?.ownerFrame();
    await handle?.dispose();
    if (!frame) return;
    if (target === "_self") return frame;
    if (target === "_top") return this.page.mainFrame();
    if (target === "_parent") return frame.parentFrame() ?? frame;
    return this.frames().find((candidate) => candidate.name() === target);
  }

  private async settle(): Promise<void> {
    for (const frame of this.frames()) await frame.waitForLoadState("domcontentloaded");
  }
  async reload(): Promise<void> {
    const main = this.page.mainFrame();
    const target = this.frames().findLast((frame) => frame !== main) ?? main;
    if (target.isDetached())
      throw new RuntimeError("SESSION_CLOSED", "The browser has no active frame.");
    await target.goto(target.url(), { waitUntil: "domcontentloaded" });
  }
  private async maskedScreenshot(): Promise<Buffer> {
    const masks: Locator[] = [];
    for (const frame of this.frames()) {
      masks.push(frame.locator('input, [data-sensitive], [autocomplete="cc-number"]'));
      masks.push(frame.getByText(/^M\d{4}$/));
      for (const input of Object.values(this.inputs))
        if (String(input).length >= 3) masks.push(frame.getByText(String(input), { exact: true }));
      const cells = frame.locator("td").filter({ hasText: /^-?[\d,]+\.\d{2}$/ });
      masks.push(cells);
    }
    return this.page.screenshot({ mask: masks, maskColor: "#8a9b9a", fullPage: false });
  }
  async screenshot(path: string): Promise<void> {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, await this.maskedScreenshot());
  }
  async close(): Promise<void> {
    await this.browser?.close();
  }
}
