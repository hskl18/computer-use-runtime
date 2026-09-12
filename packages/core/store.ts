import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { artifactHash } from "./compiler.ts";
import {
  type Capability,
  capabilitySchema,
  type Inputs,
  type Run,
  type RunEvent,
} from "./contracts.ts";
import { redact } from "./policy.ts";

export class Store {
  private db: DatabaseSync;
  readonly capabilitiesDir: string;
  constructor(readonly root: string) {
    mkdirSync(join(root, ".local", "runs"), { recursive: true });
    this.capabilitiesDir = join(root, "capabilities");
    mkdirSync(this.capabilitiesDir, { recursive: true });
    this.db = new DatabaseSync(join(root, ".local", "runtime.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_run ON events(run_id, sequence);",
    );
  }
  // Called only once a worker owns the port. A process that opens the database and then fails to
  // bind must not mark the live runs of the worker already serving it as failed.
  failStaleRuns(): void {
    const interrupted = this.db
      .prepare(
        "SELECT body FROM runs WHERE json_extract(body, '$.status') IN ('running','paused','human')",
      )
      .all();
    for (const row of interrupted) {
      const run = JSON.parse(String(row.body)) as Run;
      run.status = "failed";
      run.result = {
        status: "failure",
        code: "WORKER_RESTARTED",
        message: "The worker restarted. The previous browser session cannot be safely resumed.",
        step: run.step,
      };
      this.saveRun(run);
    }
  }
  saveRun(run: Run, inputs: Inputs = {}): void {
    run.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO runs(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(run.id, JSON.stringify(redact(run, inputs)));
  }
  listRuns(): Run[] {
    return this.db
      .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT 100")
      .all()
      .map((row) => JSON.parse(String(row.body)) as Run);
  }
  getRun(id: string): Run | undefined {
    const row = this.db.prepare("SELECT body FROM runs WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.body)) as Run) : undefined;
  }
  event(runId: string, type: string, data: Record<string, unknown>, inputs: Inputs = {}): RunEvent {
    const at = new Date().toISOString();
    const safe = redact(data, inputs) as Record<string, unknown>;
    const inserted = this.db
      .prepare("INSERT INTO events(run_id,at,type,data) VALUES(?,?,?,?)")
      .run(runId, at, type, JSON.stringify(safe));
    return { sequence: Number(inserted.lastInsertRowid), runId, at, type, data: safe };
  }
  events(runId: string, after = 0): RunEvent[] {
    return this.db
      .prepare("SELECT * FROM events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 2000")
      .all(runId, after)
      .map((row) => ({
        sequence: Number(row.sequence),
        runId: String(row.run_id),
        at: String(row.at),
        type: String(row.type),
        data: JSON.parse(String(row.data)),
      }));
  }
  saveCapability(capability: Capability): void {
    const valid = capabilitySchema.parse(capability);
    const digest = artifactHash(valid);
    if (valid.provenance.artifactHash !== digest) throw new Error("Capability digest mismatch.");
    const revisions = join(this.capabilitiesDir, "revisions");
    mkdirSync(revisions, { recursive: true });
    const revision = join(revisions, `${digest}.json`);
    if (!existsSync(revision))
      writeFileSync(revision, `${JSON.stringify(valid, null, 2)}\n`, { flag: "wx" });
    const file = join(this.capabilitiesDir, `${valid.id}.json`);
    writeFileSync(`${file}.tmp`, `${JSON.stringify(valid, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  }
  capabilities(): Capability[] {
    return readdirSync(this.capabilitiesDir)
      .filter((name) => /^[a-zA-Z][\w-]*\.json$/.test(name))
      .map((name) =>
        capabilitySchema.parse(JSON.parse(readFileSync(join(this.capabilitiesDir, name), "utf8"))),
      );
  }
  capability(id: string, digest?: string): Capability | undefined {
    if (digest) {
      if (!/^[a-f0-9]{64}$/.test(digest)) return undefined;
      const file = join(this.capabilitiesDir, "revisions", `${digest}.json`);
      if (!existsSync(file)) return undefined;
      const capability = capabilitySchema.parse(JSON.parse(readFileSync(file, "utf8")));
      if (artifactHash(capability) !== digest)
        throw new Error("Capability revision digest mismatch.");
      return capability.id === id ? capability : undefined;
    }
    return this.capabilities().find((item) => item.id === id);
  }
  runCapability(id: string): Capability | undefined {
    const row = this.db
      .prepare(
        "SELECT data FROM events WHERE run_id=? AND type IN ('capability.saved','replay.started') ORDER BY sequence DESC LIMIT 1",
      )
      .get(id);
    if (!row) return undefined;
    const data = JSON.parse(String(row.data)) as { artifactHash?: string };
    if (!data.artifactHash || !/^[a-f0-9]{64}$/.test(data.artifactHash)) return undefined;
    const file = join(this.capabilitiesDir, "revisions", `${data.artifactHash}.json`);
    if (!existsSync(file)) return undefined;
    const capability = capabilitySchema.parse(JSON.parse(readFileSync(file, "utf8")));
    if (artifactHash(capability) !== data.artifactHash)
      throw new Error("Capability revision digest mismatch.");
    return capability;
  }
  close(): void {
    this.db.close();
  }
}
