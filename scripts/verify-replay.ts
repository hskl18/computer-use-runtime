import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Capability, Result, Run, RunEvent } from "../packages/core/contracts.ts";

const { values } = parseArgs({
  options: {
    revision: { type: "string" },
    member: { type: "string", default: "M2002" },
    variant: { type: "string", default: "base" },
  },
});
assert.match(values.revision ?? "", /^[a-f0-9]{64}$/);
const expected: Record<string, { balance: string; currency: string }> = {
  M1001: { balance: "1245.67", currency: "USD" },
  M2002: { balance: "8032.10", currency: "USD" },
  M3003: { balance: "0.00", currency: "USD" },
};
assert.ok(expected[values.member]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execution = spawnSync(
  "pnpm",
  [
    "cli",
    "replay",
    "--revision",
    values.revision ?? "",
    "--inputs",
    JSON.stringify({ memberId: values.member }),
    "--variant",
    values.variant,
    "--headless",
  ],
  { cwd: root, encoding: "utf8", timeout: 60000 },
);
assert.equal(execution.status, 0, "CLI replay must exit successfully.");
const id = execution.stdout.match(/Run ([a-f0-9-]{36})/)?.[1];
assert.ok(id, "CLI must print the created run ID.");
const base = `http://127.0.0.1:${process.env.WORKER_PORT ?? "3101"}/api/runs/${id}`;
async function read<T>(suffix = ""): Promise<T> {
  const response = await fetch(`${base}${suffix}`, {
    headers: { "x-runtime-client": "console" },
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<T>;
}
const run = await read<Run>();
const result = await read<Result>("/result");
const events = await read<RunEvent[]>("/events");
const capability = await read<Capability>("/capability");
assert.equal(run.status, "completed");
assert.deepEqual(result, { status: "success", outputs: expected[values.member] });
assert.equal(run.modelCalls, 0);
assert.equal(events.filter((event) => /^(model|provider)\./.test(event.type)).length, 0);
assert.equal(capability.provenance.artifactHash, values.revision);
const assertions = {
  verifiedAt: new Date().toISOString(),
  runId: id,
  verifier: "scripts/verify-replay.ts",
  cliExitCode: execution.status,
  artifactHash: values.revision,
  variant: values.variant,
  expectedOutputsVerified: true,
  modelResponses: run.modelCalls,
  modelOrProviderEvents: 0,
  completedSteps: run.step,
  durationMs: run.durationMs,
};
const directory = join(root, ".local/runs", id);
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "assertions.json"), `${JSON.stringify(assertions, null, 2)}\n`);
console.log(JSON.stringify(assertions, null, 2));
