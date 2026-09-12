import { createHash } from "node:crypto";
import {
  type Action,
  type Capability,
  capabilitySchema,
  type Inputs,
  type Policy,
  RuntimeError,
} from "./contracts.ts";
import { redact } from "./policy.ts";

export function compileCapability(options: {
  id: string;
  goal: string;
  actions: Action[];
  inputs: Inputs;
  policy: Policy;
  runId: string;
  backend: "codex" | "direct-api";
  model: string;
  requiredOutputs?: Record<string, "text" | "money" | "number">;
  entryPath?: string;
}): Capability {
  const { actions, inputs } = options;
  const final = actions.at(-1);
  if (
    final?.type !== "checkpoint" ||
    final.expect !== "equals" ||
    !final.value ||
    !("input" in final.value) ||
    !Object.hasOwn(inputs, final.value.input)
  )
    throw new RuntimeError(
      "CAPABILITY_INCOMPLETE",
      "Discovery must finish with an equality checkpoint bound to an invocation input.",
    );
  const reads = actions.filter((action) => action.type === "read");
  if (!reads.length)
    throw new RuntimeError(
      "CAPABILITY_INCOMPLETE",
      "The capability must declare at least one observed output.",
    );
  for (const [name, format] of Object.entries(options.requiredOutputs ?? {})) {
    const matches = reads.filter((read) => read.output === name);
    if (matches.length !== 1 || matches[0]?.format !== format)
      throw new RuntimeError(
        "OUTPUT_CONTRACT_MISSING",
        `Expected one ${format} read named ${name}.`,
      );
  }
  for (const key of Object.keys(inputs)) {
    if (
      !actions.some(
        (action) =>
          (action.type === "fill" || action.type === "select") &&
          "input" in action.value &&
          action.value.input === key,
      )
    )
      throw new RuntimeError(
        "INPUT_NOT_PARAMETERIZED",
        `Input ${key} was not bound to a reusable action.`,
      );
  }
  const normalized = actions.map((action) => {
    if ((action.type === "fill" || action.type === "select") && "literal" in action.value) {
      const literal = action.value.literal;
      if (Object.values(inputs).some((value) => String(value) === literal))
        throw new RuntimeError(
          "INPUT_NOT_PARAMETERIZED",
          "Use input references rather than captured invocation values.",
        );
    }
    return { ...action, reason: redact(action.reason, inputs) as string };
  });
  const capability = capabilitySchema.parse({
    schemaVersion: 1,
    id: options.id,
    version: "1.0.0",
    description: redact(options.goal, inputs),
    application: {
      family: "ledger-demo",
      version: "1",
      surface: "web",
      entryPath: options.entryPath ?? "/sandbox/",
    },
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([name, value]) => [
        name,
        { type: typeof value, description: `Invocation parameter: ${name}`, sensitive: true },
      ]),
    ),
    outputs: Object.fromEntries(
      reads.map((read) => [
        read.output,
        {
          type: read.format === "number" ? "number" : "string",
          description: `Extracted using ${read.format} validation`,
          sensitive: read.sensitive || read.format === "money",
        },
      ]),
    ),
    steps: normalized,
    outcomes: options.policy.outcomes,
    provenance: {
      runId: options.runId,
      backend: options.backend,
      model: options.model,
      recordedAt: new Date().toISOString(),
    },
  });
  const serialized = JSON.stringify(capability);
  for (const value of Object.values(inputs))
    if (String(value).length >= 3 && serialized.includes(String(value)))
      throw new RuntimeError(
        "ARTIFACT_DATA_LEAK",
        "An invocation value is embedded in the artifact.",
      );
  capability.provenance.artifactHash = artifactHash(capability);
  return capability;
}

export function artifactHash(capability: Capability): string {
  const copy = structuredClone(capability);
  delete copy.provenance.artifactHash;
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

export function validateInvocation(capability: Capability, inputs: Inputs): void {
  if (capability.provenance.artifactHash !== artifactHash(capability))
    throw new RuntimeError(
      "ARTIFACT_CHANGED",
      "The capability differs from its recorded digest. Review and revalidate it before execution.",
    );
  for (const [name, field] of Object.entries(capability.inputs)) {
    if (!Object.hasOwn(inputs, name) || typeof inputs[name] !== field.type)
      throw new RuntimeError("INPUT_INVALID", `Expected ${name} to be ${field.type}.`);
  }
  if (Object.keys(inputs).some((name) => !Object.hasOwn(capability.inputs, name)))
    throw new RuntimeError("INPUT_INVALID", "The invocation contains undeclared inputs.");
}
