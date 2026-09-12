import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const valueSchema = z.union([
  z.object({ input: identifier }).strict(),
  z.object({ literal: z.string().max(2000) }).strict(),
]);
const frame = z.string().min(1).max(120).optional();
export const targetSchema = z.discriminatedUnion("by", [
  z
    .object({
      by: z.literal("role"),
      role: z.enum(["button", "link", "textbox", "combobox", "heading", "dialog"]),
      name: z.string().min(1).max(160),
      frame,
    })
    .strict(),
  z.object({ by: z.literal("label"), text: z.string().min(1).max(160), frame }).strict(),
  z.object({ by: z.literal("text"), text: z.string().min(1).max(160), frame }).strict(),
  z
    .object({
      by: z.literal("tableCell"),
      row: z.string().min(1).max(120),
      column: z.string().min(1).max(120),
      frame,
    })
    .strict(),
]);
const reason = z.string().min(1).max(300);
export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("navigate"),
      path: z.string().startsWith("/sandbox/").max(300),
      reason,
    })
    .strict(),
  z.object({ type: z.literal("click"), target: targetSchema, reason }).strict(),
  z.object({ type: z.literal("fill"), target: targetSchema, value: valueSchema, reason }).strict(),
  z
    .object({ type: z.literal("select"), target: targetSchema, value: valueSchema, reason })
    .strict(),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), reason }).strict(),
  z
    .object({
      type: z.literal("read"),
      target: targetSchema,
      output: identifier,
      format: z.enum(["text", "money", "number"]),
      sensitive: z.boolean(),
      reason,
    })
    .strict(),
  z
    .object({
      type: z.literal("checkpoint"),
      target: targetSchema,
      expect: z.enum(["visible", "equals", "contains"]),
      value: valueSchema.optional(),
      reason,
    })
    .strict(),
]);
export const fieldSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    description: z.string().max(300),
    sensitive: z.boolean(),
  })
  .strict();
export const outcomeRuleSchema = z
  .object({
    text: z.string().min(1),
    code: identifier,
    kind: z.enum(["business", "retry", "handoff", "failure"]),
    recovery: z.enum(["reload", "dismiss", "none"]).default("none"),
  })
  .strict();
export const capabilitySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    version: z.literal("1.0.0"),
    description: z.string().min(1).max(500),
    application: z
      .object({
        family: z.literal("ledger-demo"),
        version: z.literal("1"),
        surface: z.literal("web"),
        entryPath: z.string().startsWith("/sandbox/"),
      })
      .strict(),
    inputs: z.record(identifier, fieldSchema),
    outputs: z.record(identifier, fieldSchema),
    steps: z.array(actionSchema).min(2).max(60),
    outcomes: z.array(outcomeRuleSchema).max(20),
    provenance: z
      .object({
        runId: z.string(),
        backend: z.enum(["codex", "direct-api"]),
        model: z.string(),
        recordedAt: z.iso.datetime(),
        artifactHash: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export const policySchema = z
  .object({
    allowedOrigins: z.array(z.url()).min(1),
    pathPrefixes: z.array(z.string().startsWith("/")).min(1),
    actions: z.array(
      z.enum(["navigate", "click", "fill", "select", "scroll", "read", "checkpoint"]),
    ),
    allowedClickNames: z.array(z.string()),
    blockedControlNames: z.array(z.string()),
    maxSteps: z.number().int().positive().max(100),
    timeoutMs: z.number().int().positive().max(900000),
    handoffTimeoutMs: z.number().int().positive().max(900000),
    actionTimeoutMs: z.number().int().positive().max(30000),
    maxRecoveries: z.number().int().min(0).max(5),
    maxToolRejections: z.number().int().min(0).max(20),
    outcomes: z.array(outcomeRuleSchema),
  })
  .strict();
export const runRequestSchema = z
  .object({
    mode: z.enum(["discovery", "replay"]),
    target: z.string().startsWith("/sandbox/").max(300).default("/sandbox/"),
    goal: z
      .string()
      .min(1)
      .max(1500)
      .default(
        "Look up the member and return the savings account balance and currency. Verify that the member ID matches the input.",
      ),
    inputs: z
      .record(identifier, z.union([z.string().max(200), z.number().finite(), z.boolean()]))
      .default({ memberId: "M1001" }),
    capabilityId: identifier.optional(),
    capabilityHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    backend: z.enum(["codex", "direct-api"]).default("codex"),
    scenario: z
      .enum([
        "normal",
        "not-found",
        "validation-error",
        "permission-denied",
        "slow",
        "transient",
        "session-expired",
        "unexpected-dialog",
        "app-error",
        "duplicate-control",
        "risky",
        "prompt-injection",
      ])
      .default("normal"),
    variant: z.enum(["base", "union"]).default("base"),
    headless: z.boolean().default(false),
  })
  .strict();
export type Value = z.infer<typeof valueSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Policy = z.infer<typeof policySchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type Inputs = RunRequest["inputs"];
export type RunStatus =
  | "running"
  | "paused"
  | "human"
  | "completed"
  | "business_outcome"
  | "failed"
  | "cancelled";
export type Result =
  | { status: "success"; outputs: Inputs }
  | { status: "business_outcome"; code: string; message: string }
  | {
      status: "failure";
      code: string;
      message: string;
      step: number;
      expected?: string;
      observed?: string;
      screenshot?: string;
    };
export type RunEvent = {
  sequence: number;
  runId: string;
  at: string;
  type: string;
  data: Record<string, unknown>;
};
export type Run = {
  id: string;
  mode: RunRequest["mode"];
  goal: string;
  status: RunStatus;
  backend: string;
  model: string | null;
  startedAt: string;
  updatedAt: string;
  step: number;
  modelCalls: number;
  capabilityId?: string;
  result?: Result;
  scenario: string;
  variant: string;
  intervention?: { reason: string; browserUrl: string };
  durationMs?: number;
};

export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: { expected?: string; observed?: string } = {},
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function resolveValue(value: Value, inputs: Inputs): string {
  if ("literal" in value) return value.literal;
  if (!Object.hasOwn(inputs, value.input))
    throw new RuntimeError("MISSING_INPUT", `Missing input: ${value.input}`);
  return String(inputs[value.input]);
}
