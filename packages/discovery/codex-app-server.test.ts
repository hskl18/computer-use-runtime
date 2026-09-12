import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { RuntimeError } from "../core/contracts.ts";
import { CodexBackend } from "./codex-app-server.ts";
import { fakeCodex, fakeHost } from "./provider-test-fixtures.ts";

test("already-aborted discovery never launches the CLI or starts preflight", {
  timeout: 5000,
}, async (context) => {
  const fixture = await fakeCodex(context, "hold-initialize");
  const abort = new AbortController();
  const reason = new RuntimeError("CANCELLED", "Cancelled before discovery");
  abort.abort(reason);
  const { host, events } = fakeHost(abort.signal);
  const backend = new CodexBackend({ ...fixture, model: "fixture-model", effort: "low" });
  await assert.rejects(backend.run(host), (error) => error === reason);
  assert.deepEqual(await fixture.records(), []);
  assert.deepEqual(events, []);
});

test("cancelling during initialize settles preflight promptly and prevents turn/start", {
  timeout: 5000,
}, async (context) => {
  const fixture = await fakeCodex(context, "hold-initialize");
  const abort = new AbortController();
  context.after(() => abort.abort());
  const { host, events } = fakeHost(abort.signal);
  const backend = new CodexBackend({ ...fixture, model: "fixture-model", effort: "low" });
  const running = backend.run(host);
  const rejected = assert.rejects(running, { code: "CODEX_CLOSED" });
  await fixture.waitForMethod("initialize");
  const cancelledAt = Date.now();
  abort.abort(new RuntimeError("CANCELLED", "Cancelled during initialize"));
  await rejected;
  assert.ok(
    Date.now() - cancelledAt < 1000,
    "Cancellation must not wait for the 20-second RPC timeout",
  );
  const records = await fixture.records();
  assert.equal(
    records.some((record) => record.method === "turn/start"),
    false,
  );
  assert.equal(
    records.some((record) => record.method === "account/read"),
    false,
  );
  assert.equal(
    events.some((event) => event.type === "model.request"),
    false,
  );
  assert.equal(
    records.find((record) => record.isolatedHome)?.isolatedHome,
    join(fixture.cwd, "codex-home"),
  );
  await assert.rejects(access(join(fixture.cwd, "codex-home", "auth.json")), { code: "ENOENT" });
});

test("invalid protocol JSON during an active turn fails promptly instead of waiting for completion", {
  timeout: 5000,
}, async (context) => {
  const fixture = await fakeCodex(context, "corrupt-turn");
  const abort = new AbortController();
  context.after(() => abort.abort());
  const { host, events, toolCalls } = fakeHost(abort.signal);
  const backend = new CodexBackend({ ...fixture, model: "fixture-model", effort: "low" });
  const startedAt = Date.now();
  await assert.rejects(backend.run(host), { code: "CODEX_PROTOCOL" });
  assert.ok(
    Date.now() - startedAt < 3000,
    "Protocol corruption must settle without a turn-completed event",
  );
  assert.equal(
    (await fixture.records()).filter((record) => record.method === "turn/start").length,
    1,
  );
  assert.equal(events.filter((event) => event.type === "provider.ready").length, 1);
  assert.equal(events.filter((event) => event.type === "model.request").length, 1);
  assert.deepEqual(toolCalls, []);
});
