import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ids = z.array(z.uuid()).min(1).parse(process.argv.slice(2));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, ".local", "runtime.sqlite"), { readOnly: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const destination = join(root, "evidence", stamp);
const files: { path: string; sha256: string }[] = [];

function save(path: string, content: string | Buffer): void {
  const file = join(destination, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { flag: "wx" });
  files.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
}

try {
  const exports = ids.map((id) => {
    const row = db.prepare("SELECT body FROM runs WHERE id=?").get(id);
    if (!row) throw new Error(`Run ${id} does not exist.`);
    const run = JSON.parse(String(row.body)) as { status: string };
    if (["running", "paused", "human"].includes(run.status))
      throw new Error(`Run ${id} is still active. Export only completed runs.`);
    const events = db
      .prepare("SELECT * FROM events WHERE run_id=? ORDER BY sequence")
      .all(id)
      .map((event) => ({
        sequence: Number(event.sequence),
        runId: id,
        at: String(event.at),
        type: String(event.type),
        data: JSON.parse(String(event.data)) as Record<string, unknown>,
      }));
    return { id, run, events };
  });
  // Counted from the persisted event stream, so "replay used no model" is checkable, not asserted.
  const summary = exports.map(({ id, run, events }) => ({
    runId: id,
    mode: (run as { mode?: string }).mode ?? null,
    status: run.status,
    modelRequests: events.filter((event) => event.type === "model.request").length,
    modelResponses: events.filter((event) => event.type === "model.response").length,
    actionAttempts: events.filter((event) => event.type === "action.started").length,
    completedSteps: events.filter((event) => event.type === "action.completed").length,
    rejectedActions: events.filter((event) => event.type === "action.rejected").length,
    interventions: events.filter((event) => event.type === "intervention.requested").length,
  }));
  for (const { id, run, events } of exports) {
    save(`${id}/run.json`, `${JSON.stringify(run, null, 2)}\n`);
    save(`${id}/events.jsonl`, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const hashes = new Set(
      events
        .filter((event) => ["capability.saved", "replay.started"].includes(event.type))
        .map((event) =>
          z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(event.data.artifactHash),
        ),
    );
    for (const hash of hashes)
      save(
        `${id}/capabilities/${hash}.json`,
        readFileSync(join(root, "capabilities", "revisions", `${hash}.json`)),
      );
    const assertionsPath = join(root, ".local", "runs", id, "assertions.json");
    if (existsSync(assertionsPath)) {
      const assertions = JSON.parse(readFileSync(assertionsPath, "utf8"));
      save(
        `${id}/assertions.json`,
        `${JSON.stringify(
          {
            ...assertions,
            actionAttempts: events.filter((event) => event.type === "action.started").length,
            completedSteps: events.filter((event) => event.type === "action.completed").length,
            stepCountsDerivedFrom: "events.jsonl by scripts/export-evidence.ts",
          },
          null,
          2,
        )}\n`,
      );
    }
    for (const image of ["failure.png", "intervention.png"]) {
      const source = join(root, ".local", "runs", id, image);
      if (existsSync(source)) save(`${id}/${image}`, readFileSync(source));
    }
  }
  save(
    "manifest.json",
    `${JSON.stringify({ exportedAt: new Date().toISOString(), reviewStatus: "unreviewed", runIds: ids, runs: summary, files: [...files] }, null, 2)}\n`,
  );
  console.log(`Exported local evidence to ${destination}. Review every file before publication.`);
} finally {
  db.close();
}
