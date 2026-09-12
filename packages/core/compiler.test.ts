import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactHash, compileCapability, validateInvocation } from "./compiler.ts";
import type { Action, Inputs } from "./contracts.ts";
import { runRequestSchema } from "./contracts.ts";
import { compileOptions } from "./test-fixtures.ts";

test("discovery accepts an explicit allowlisted target and records its entry point", () => {
  const request = runRequestSchema.parse({ mode: "discovery", target: "/sandbox/?workspace=demo" });
  const capability = compileCapability({ ...compileOptions(), entryPath: request.target });
  assert.equal(capability.application.entryPath, request.target);
  assert.throws(() => runRequestSchema.parse({ mode: "discovery", target: "https://example.com" }));
});

test("compilation parameterizes the artifact, redacts invocation data, and preserves the trajectory", () => {
  const options = compileOptions();
  const original = structuredClone(options.actions);
  const capability = compileCapability(options);
  assert.deepEqual(options.actions, original);
  assert.equal(JSON.stringify(capability).includes("M1001"), false);
  assert.equal(capability.inputs.memberId?.type, "string");
  assert.equal(capability.outputs.balance?.sensitive, true);
  assert.equal(capability.outputs.currency?.type, "string");
  assert.match(capability.description, /\[input:memberId\]/);
  assert.deepEqual(
    capability.steps.map((step) => step.type),
    original.map((step) => step.type),
  );
  assert.doesNotThrow(() => validateInvocation(capability, { memberId: "M2002" }));
});

test("the recorded digest survives serialization and detects edited behavior", () => {
  const capability = compileCapability(compileOptions());
  const restored = JSON.parse(JSON.stringify(capability));
  assert.equal(restored.provenance.artifactHash, artifactHash(restored));
  assert.doesNotThrow(() => validateInvocation(restored, { memberId: "M2002" }));
  restored.steps[1].target.name = "Submit transfer";
  assert.throws(() => validateInvocation(restored, { memberId: "M2002" }), {
    code: "ARTIFACT_CHANGED",
  });
});

test("invocation rejects missing, mistyped, and undeclared parameters", () => {
  const capability = compileCapability(compileOptions());
  const invalidInputs: Inputs[] = [{}, { memberId: 2002 }, { memberId: "M2002", extra: true }];
  for (const inputs of invalidInputs) {
    assert.throws(() => validateInvocation(capability, inputs), { code: "INPUT_INVALID" });
  }
});

test("compilation requires an input-bound final equality checkpoint", () => {
  const options = compileOptions();
  const last = options.actions.at(-1);
  assert.equal(last?.type, "checkpoint");
  if (last?.type !== "checkpoint") throw new Error("Invalid test fixture");
  const invalidFinals: Action[] = [
    { ...last, expect: "visible", value: undefined },
    { ...last, expect: "contains" },
    { ...last, value: { literal: "M1001" } },
    { ...last, value: { input: "unknown" } },
    { type: "scroll", direction: "down", reason: "Move past the checkpoint." },
  ];
  for (const final of invalidFinals) {
    assert.throws(
      () => compileCapability({ ...options, actions: [...options.actions.slice(0, -1), final] }),
      { code: "CAPABILITY_INCOMPLETE" },
    );
  }
});

test("required outputs reject missing, duplicate, or incorrectly formatted reads", () => {
  const options = compileOptions();
  const balance = options.actions.find(
    (action) => action.type === "read" && action.output === "balance",
  );
  assert.equal(balance?.type, "read");
  if (balance?.type !== "read") throw new Error("Invalid test fixture");
  const invalidActions = [
    options.actions.filter((action) => action !== balance),
    [balance, ...options.actions],
    options.actions.map((action) =>
      action === balance ? { ...balance, format: "text" as const } : action,
    ),
  ];
  for (const actions of invalidActions) {
    assert.throws(() => compileCapability({ ...options, actions }), {
      code: "OUTPUT_CONTRACT_MISSING",
    });
  }
  assert.throws(
    () =>
      compileCapability({
        ...options,
        actions: options.actions.filter((action) => action.type !== "read"),
      }),
    { code: "CAPABILITY_INCOMPLETE" },
  );
});

test("every input must be bound and captured invocation literals are rejected", () => {
  const options = compileOptions();
  assert.throws(
    () => compileCapability({ ...options, inputs: { ...options.inputs, region: "west" } }),
    { code: "INPUT_NOT_PARAMETERIZED" },
  );
  const captured: Action = {
    type: "fill",
    target: { by: "label", text: "Hidden filter" },
    value: { literal: "M1001" },
    reason: "Captured input.",
  };
  assert.throws(() => compileCapability({ ...options, actions: [captured, ...options.actions] }), {
    code: "INPUT_NOT_PARAMETERIZED",
  });
});

test("invocation values embedded in selectors cannot leak into an artifact", () => {
  const options = compileOptions();
  const leaked: Action = {
    type: "click",
    target: { by: "text", text: "Member M1001" },
    reason: "Open member.",
  };
  assert.throws(() => compileCapability({ ...options, actions: [leaked, ...options.actions] }), {
    code: "ARTIFACT_DATA_LEAK",
  });
});
