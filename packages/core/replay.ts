import { validateInvocation } from "./compiler.ts";
import {
  type Action,
  type Capability,
  type Inputs,
  type Result,
  RuntimeError,
} from "./contracts.ts";

export interface ReplayHost {
  execute(action: Action): Promise<void>;
  inspect(): Promise<Result | undefined>;
  outputs: Inputs;
  signal: AbortSignal;
}

export async function replay(
  capability: Capability,
  inputs: Inputs,
  host: ReplayHost,
): Promise<Result> {
  validateInvocation(capability, inputs);
  for (const action of capability.steps) {
    host.signal.throwIfAborted();
    const before = await host.inspect();
    if (before) return before;
    await host.execute(action);
    const after = await host.inspect();
    if (after) return after;
  }
  if (capability.steps.at(-1)?.type !== "checkpoint")
    throw new RuntimeError("CHECKPOINT_MISSING", "Replay must finish with a checkpoint.");
  for (const [name, field] of Object.entries(capability.outputs)) {
    if (!Object.hasOwn(host.outputs, name) || typeof host.outputs[name] !== field.type)
      throw new RuntimeError(
        "OUTPUT_INVALID",
        `Output ${name} does not satisfy its declared contract.`,
      );
  }
  return { status: "success", outputs: host.outputs };
}
