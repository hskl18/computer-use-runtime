import { readFileSync } from "node:fs";
import type { Action, Inputs, Policy } from "./contracts.ts";
import { policySchema } from "./contracts.ts";

export function testPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    ...policySchema.parse(
      JSON.parse(readFileSync(new URL("../../policies/local-demo.json", import.meta.url), "utf8")),
    ),
    ...overrides,
  };
}

export function trajectory(): Action[] {
  return [
    {
      type: "fill",
      target: { by: "label", text: "Member ID" },
      value: { input: "memberId" },
      reason: "Look up M1001 using the invocation parameter.",
    },
    {
      type: "click",
      target: { by: "role", role: "button", name: "Search" },
      reason: "Load the selected member.",
    },
    {
      type: "read",
      target: { by: "tableCell", row: "Savings", column: "Balance" },
      output: "balance",
      format: "money",
      sensitive: false,
      reason: "Read the savings balance.",
    },
    {
      type: "read",
      target: { by: "tableCell", row: "Savings", column: "Currency" },
      output: "currency",
      format: "text",
      sensitive: false,
      reason: "Read the currency.",
    },
    {
      type: "checkpoint",
      target: { by: "label", text: "Selected member ID" },
      expect: "equals",
      value: { input: "memberId" },
      reason: "Confirm the result belongs to M1001.",
    },
  ];
}

export function compileOptions() {
  return {
    id: "testSavings",
    goal: "Read the savings balance for M1001.",
    actions: trajectory(),
    inputs: { memberId: "M1001" } satisfies Inputs,
    policy: testPolicy(),
    runId: "unit-fixture-only",
    backend: "codex" as const,
    model: "fixture-no-inference",
    requiredOutputs: { balance: "money", currency: "text" } as const,
  };
}
