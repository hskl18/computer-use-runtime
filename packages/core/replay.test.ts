import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileCapability } from "./compiler.ts";
import { type Action, type Inputs, type Result, RuntimeError, resolveValue } from "./contracts.ts";
import { type ReplayHost, replay } from "./replay.ts";
import { compileOptions } from "./test-fixtures.ts";

function fixtureHost(inputs: Inputs, outputs: Inputs = { balance: "2450.75", currency: "USD" }) {
  const executed: Action[] = [];
  let selected = "";
  let inspections = 0;
  const host: ReplayHost = {
    outputs: {},
    signal: new AbortController().signal,
    async inspect() {
      inspections++;
      return undefined;
    },
    async execute(action) {
      executed.push(action);
      if (action.type === "fill") selected = resolveValue(action.value, inputs);
      if (action.type === "read" && Object.hasOwn(outputs, action.output))
        host.outputs[action.output] = outputs[action.output] as string | number | boolean;
      if (
        action.type === "checkpoint" &&
        (!action.value || selected !== resolveValue(action.value, inputs))
      )
        throw new RuntimeError("CHECKPOINT_FAILED", "Member identity mismatch.");
    },
  };
  return { host, executed, selected: () => selected, inspections: () => inspections };
}

test("one exact capability deterministically replays different inputs without provider access", async () => {
  const capability = compileCapability(compileOptions());
  const digest = capability.provenance.artifactHash;
  for (const memberId of ["M2002", "M3003"]) {
    const first = fixtureHost({ memberId });
    const second = fixtureHost({ memberId });
    const expected = { status: "success", outputs: { balance: "2450.75", currency: "USD" } };
    assert.deepEqual(await replay(capability, { memberId }, first.host), expected);
    assert.deepEqual(await replay(capability, { memberId }, second.host), expected);
    assert.equal(first.selected(), memberId);
    assert.deepEqual(first.executed, capability.steps);
    assert.deepEqual(first.executed, second.executed);
    assert.equal(first.inspections(), capability.steps.length * 2);
    assert.equal(capability.provenance.artifactHash, digest);
  }
});

test("replay's local module dependency closure excludes discovery providers and browser automation", async () => {
  const visited = new Set<string>();
  const pending = [new URL("./replay.ts", import.meta.url)];
  while (pending.length) {
    const url = pending.pop();
    assert.ok(url);
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
      const dependency = match[1];
      assert.ok(dependency);
      assert.doesNotMatch(dependency, /discovery|openai|codex|playwright|child_process/);
      if (dependency.startsWith(".")) pending.push(new URL(dependency, url));
    }
  }
  assert.ok(visited.size > 1);
});

test("invalid artifact or invocation fails before any interaction", async () => {
  const capability = compileCapability(compileOptions());
  const fixture = fixtureHost({ memberId: "M2002" });
  await assert.rejects(replay(capability, {}, fixture.host), { code: "INPUT_INVALID" });
  capability.description = "Modified artifact";
  await assert.rejects(replay(capability, { memberId: "M2002" }, fixture.host), {
    code: "ARTIFACT_CHANGED",
  });
  assert.equal(fixture.executed.length, 0);
  assert.equal(fixture.inspections(), 0);
});

test("business outcomes short-circuit both before and after an action", async () => {
  const capability = compileCapability(compileOptions());
  const result: Result = {
    status: "business_outcome",
    code: "MEMBER_NOT_FOUND",
    message: "No matching member",
  };
  for (const stopAt of [1, 2]) {
    const fixture = fixtureHost({ memberId: "M2002" });
    let calls = 0;
    fixture.host.inspect = async () => (++calls === stopAt ? result : undefined);
    assert.deepEqual(await replay(capability, { memberId: "M2002" }, fixture.host), result);
    assert.equal(fixture.executed.length, stopAt - 1);
  }
});

test("missing and wrong-type outputs cannot report success", async () => {
  const capability = compileCapability(compileOptions());
  const invalidOutputs: Inputs[] = [{ currency: "USD" }, { balance: 2450.75, currency: "USD" }];
  for (const outputs of invalidOutputs) {
    const fixture = fixtureHost({ memberId: "M2002" }, outputs);
    await assert.rejects(replay(capability, { memberId: "M2002" }, fixture.host), {
      code: "OUTPUT_INVALID",
    });
  }
});

test("execution failures retain their error code and checkpoint details", async () => {
  const capability = compileCapability(compileOptions());
  const fixture = fixtureHost({ memberId: "M2002" });
  const failure = new RuntimeError("CHECKPOINT_FAILED", "Member mismatch", {
    expected: "M2002",
    observed: "M1001",
  });
  fixture.host.execute = async (action) => {
    if (action.type === "checkpoint") throw failure;
  };
  await assert.rejects(
    replay(capability, { memberId: "M2002" }, fixture.host),
    (error) => error === failure,
  );
});

test("cancellation prevents the next action and retains its reason", async () => {
  const capability = compileCapability(compileOptions());
  const fixture = fixtureHost({ memberId: "M2002" });
  const abort = new AbortController();
  fixture.host.signal = abort.signal;
  const reason = new RuntimeError("CANCELLED", "Cancelled by operator");
  abort.abort(reason);
  await assert.rejects(
    replay(capability, { memberId: "M2002" }, fixture.host),
    (error) => error === reason,
  );
  assert.equal(fixture.executed.length, 0);
});
