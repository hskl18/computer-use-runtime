import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { DiscoveryHost } from "./backend.ts";

export function fakeHost(signal: AbortSignal) {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const toolCalls: Array<{ name: string; arguments: unknown }> = [];
  const host: DiscoveryHost = {
    goal: "Synthetic provider transport regression test",
    inputs: { memberId: "SYNTHETIC" },
    signal,
    emit: (type, data) => events.push({ type, data }),
    async tool(name, args) {
      toolCalls.push({ name, arguments: args });
      return { success: true, contentItems: [{ type: "inputText", text: "Fixture response" }] };
    },
    async finish() {
      return { status: "success", outputs: { currency: "USD" } };
    },
  };
  return { host, events, toolCalls };
}

export async function fakeCodex(context: TestContext, mode: "hold-initialize" | "corrupt-turn") {
  const root = await mkdtemp(join(tmpdir(), "computer-use-provider-test-"));
  const credentials = join(root, "empty-credential-home");
  const cwd = join(root, "run");
  await mkdir(credentials);
  await mkdir(cwd);
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = credentials;
  context.after(async () => {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  const binary = join(root, "fake-codex.cjs");
  const log = join(root, "protocol.jsonl");
  await appendFile(log, "");
  await writeFile(
    binary,
    `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const log = ${JSON.stringify(log)};
const mode = ${JSON.stringify(mode)};
const record = value => fs.appendFileSync(log, JSON.stringify(value) + "\\n");
record({ invocation: process.argv.slice(2) });
if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.153.4\\n");
  process.exit(0);
}
record({ isolatedHome: process.env.CODEX_HOME });
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  record(request);
  if (request.id === undefined) return;
  if (request.method === "initialize" && mode === "hold-initialize") return;
  const results = {
    initialize: {},
    "account/read": { account: { type: "chatgpt" } },
    "model/list": { data: [{ model: "fixture-model", inputModalities: ["text", "image"] }] },
    "thread/start": { thread: { id: "fixture-thread" }, model: "fixture-model", reasoningEffort: "low" },
    "mcpServerStatus/list": { data: [] },
    "turn/start": { turn: { id: "fixture-turn" } }
  };
  send({ id: request.id, result: results[request.method] ?? {} });
  if (request.method === "turn/start" && mode === "corrupt-turn") setTimeout(() => process.stdout.write("{BROKEN-PROTOCOL\\n"), 20);
});
`,
  );
  await chmod(binary, 0o700);
  async function records(): Promise<Array<Record<string, unknown>>> {
    return (await readFile(log, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  async function waitForMethod(method: string): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if ((await records()).some((record) => record.method === method)) return;
      await delay(10);
    }
    throw new Error(`Fake Codex did not receive ${method}`);
  }
  return { binary, cwd, records, waitForMethod };
}
