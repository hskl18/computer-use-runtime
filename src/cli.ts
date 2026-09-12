import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    goal: { type: "string" },
    target: { type: "string", default: "/sandbox/" },
    inputs: { type: "string" },
    capability: { type: "string", default: "lookup-savings-balance" },
    revision: { type: "string" },
    backend: { type: "string", default: "codex" },
    scenario: { type: "string", default: "normal" },
    variant: { type: "string", default: "base" },
    headless: { type: "boolean", default: false },
    id: { type: "string" },
  },
});
const base = `http://127.0.0.1:${process.env.WORKER_PORT ?? "3101"}`;
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-runtime-client": "console" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main(): Promise<void> {
  const command = positionals[0] ?? "help";
  if (command === "help") {
    console.log(
      "Commands: doctor | discover | replay | runs | inspect | take | resume | cancel\nOptions: --goal TEXT --target ENTRY_PATH --inputs JSON --capability ID --revision SHA256 --backend codex|direct-api --scenario NAME --variant base|union --headless --id RUN_ID",
    );
    return;
  }
  if (command === "doctor") {
    const binary = process.env.CODEX_BIN ?? "codex";
    console.log(
      JSON.stringify(
        {
          node: process.version,
          codex:
            spawnSync(binary, ["--version"], { encoding: "utf8" }).stdout?.trim() ||
            "not installed",
          codexLogin:
            spawnSync(binary, ["login", "status"], { encoding: "utf8" }).stderr?.trim() ||
            "Check codex login status",
          worker: await request("/health"),
          discoveryVerified: "See saved evidence; login is not a successful model run.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "runs") {
    console.log(JSON.stringify(await request("/runs"), null, 2));
    return;
  }
  if (command === "inspect") {
    console.log(JSON.stringify(await request("/capabilities"), null, 2));
    return;
  }
  if (["take", "resume", "cancel"].includes(command)) {
    if (!values.id) throw new Error("--id RUN_ID is required.");
    console.log(
      JSON.stringify(
        await request(`/runs/${encodeURIComponent(values.id)}/control`, { action: command }),
        null,
        2,
      ),
    );
    return;
  }
  if (!["discover", "replay"].includes(command)) throw new Error(`Unknown command: ${command}`);
  const run = (await request("/runs", {
    mode: command === "discover" ? "discovery" : "replay",
    target: values.target,
    ...(values.goal ? { goal: values.goal } : {}),
    inputs: values.inputs ? JSON.parse(values.inputs) : { memberId: "M1001" },
    capabilityId: values.capability,
    ...(values.revision ? { capabilityHash: values.revision } : {}),
    backend: values.backend,
    scenario: values.scenario,
    variant: values.variant,
    headless: values.headless,
  })) as { id: string };
  console.log(`Run ${run.id}\nConsole: http://127.0.0.1:3100/?run=${run.id}`);
  let sequence = 0;
  for (;;) {
    const events = (await request(`/runs/${run.id}/events?after=${sequence}`)) as {
      sequence: number;
      type: string;
      data: unknown;
    }[];
    for (const event of events) {
      sequence = event.sequence;
      console.log(JSON.stringify(event));
    }
    const current = (await request(`/runs/${run.id}`)) as { status: string; result?: unknown };
    if (["completed", "business_outcome", "failed", "cancelled"].includes(current.status)) {
      console.log(
        JSON.stringify({ ...current, result: await request(`/runs/${run.id}/result`) }, null, 2),
      );
      if (["failed", "cancelled"].includes(current.status)) process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
