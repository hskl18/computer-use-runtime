import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Surface } from "../../packages/browser/adapter.ts";
import { BrowserSurface } from "../../packages/browser/playwright.ts";
import { compileCapability } from "../../packages/core/compiler.ts";
import {
  type Action,
  actionSchema,
  type Capability,
  type Inputs,
  type Policy,
  policySchema,
  type Result,
  type Run,
  type RunRequest,
  RuntimeError,
  runRequestSchema,
} from "../../packages/core/contracts.ts";
import { redact } from "../../packages/core/policy.ts";
import { replay } from "../../packages/core/replay.ts";
import { SessionController } from "../../packages/core/session.ts";
import { Store } from "../../packages/core/store.ts";
import {
  type DiscoveryHost,
  type ToolResult,
  toolSchemas,
} from "../../packages/discovery/backend.ts";
import { waitForSurfaceChange } from "../../packages/discovery/progress.ts";

class Outcome extends Error {
  constructor(readonly result: Result) {
    super("The application returned a terminal outcome.");
  }
}
// A refused model request. It is answered as a failed tool result so discovery can correct itself,
// unlike a terminal condition, which ends the run.
class ToolRejected extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : "The requested action was refused.");
  }
}
async function rejectable<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new ToolRejected(error);
  }
}
type Active = {
  run: Run;
  request: RunRequest;
  session: SessionController;
  surface: Surface;
  done: Promise<void>;
  actions: Action[];
  outputs: Inputs;
  capability?: Capability;
  observationCount: number;
  recoveries: number;
  rejections: number;
  compiled: boolean;
  budgetMs: number;
  armedAt: number;
  timeout?: ReturnType<typeof setTimeout>;
};

export class Runtime {
  readonly store: Store;
  private active = new Map<string, Active>();
  private results = new Map<string, Result>();
  private resultTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly policy: Policy;
  constructor(
    readonly root: string,
    port = 3101,
    private surfaceFactory: (
      policy: Policy,
      emit: (type: string, data: Record<string, unknown>) => void,
      inputs: Inputs,
    ) => Surface = (policy, emit, inputs) => new BrowserSurface(policy, emit, inputs),
  ) {
    this.store = new Store(root);
    this.policy = policySchema.parse(
      JSON.parse(readFileSync(join(root, "policies", "local-demo.json"), "utf8")),
    );
    this.policy.allowedOrigins = [`http://127.0.0.1:${port}`];
  }
  start(raw: unknown): Run {
    const request = runRequestSchema.parse(raw);
    if (this.active.size >= 2)
      throw new RuntimeError(
        "CAPACITY",
        "Two browser sessions are already active. Wait for a run to finish.",
      );
    const capability =
      request.mode === "replay"
        ? this.store.capability(
            request.capabilityId ?? "lookup-savings-balance",
            request.capabilityHash,
          )
        : undefined;
    if (request.mode === "replay" && !capability)
      throw new RuntimeError(
        "CAPABILITY_NOT_FOUND",
        "Record a successful discovery before replaying this capability.",
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    const model = process.env.DISCOVERY_MODEL ?? "gpt-6-astra";
    const run: Run = {
      id,
      mode: request.mode,
      goal: redact(request.goal, request.inputs) as string,
      status: "running",
      backend: request.mode === "replay" ? "deterministic" : request.backend,
      model: request.mode === "replay" ? null : model,
      startedAt: now,
      updatedAt: now,
      step: 0,
      modelCalls: 0,
      scenario: request.scenario,
      variant: request.variant,
      capabilityId: capability?.id,
    };
    const emit = (type: string, data: Record<string, unknown>) => {
      if (type === "model.response") run.modelCalls++;
      this.store.event(id, type, data, request.inputs);
      this.store.saveRun(run, request.inputs);
    };
    const surface = this.surfaceFactory(this.policy, emit, request.inputs);
    const session = new SessionController(this.policy, (owner, reason) => {
      surface.setHuman(owner === "human");
      // The elapsed-time budget is held while a person owns the session.
      if (owner === "paused") this.holdBudget(active);
      else if (owner === "automation") this.armBudget(active);
      if (owner === "paused" || owner === "human") {
        run.status = owner;
        run.intervention = {
          reason: reason ?? run.intervention?.reason ?? "Operator intervention",
          browserUrl: surface.url(),
        };
      } else if (owner === "automation") {
        run.status = "running";
        delete run.intervention;
      }
      emit("session.control", { owner, reason, sessionId: surface.sessionId });
    });
    const active: Active = {
      run,
      request,
      session,
      surface,
      done: Promise.resolve(),
      actions: [],
      outputs: {},
      capability,
      observationCount: 0,
      recoveries: 0,
      rejections: 0,
      compiled: false,
      budgetMs: this.policy.timeoutMs,
      armedAt: 0,
    };
    this.active.set(id, active);
    emit("run.created", {
      mode: request.mode,
      backend: run.backend,
      inputNames: Object.keys(request.inputs),
      scenario: request.scenario,
      variant: request.variant,
    });
    active.done = this.run(active, model, emit);
    return run;
  }

  private async run(
    active: Active,
    model: string,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<void> {
    const { request, surface, session, run } = active;
    this.armBudget(active);
    session.abort.signal.addEventListener(
      "abort",
      () => {
        void surface.close();
      },
      { once: true },
    );
    try {
      const entry = active.capability?.application.entryPath ?? request.target;
      const url = new URL(entry, this.policy.allowedOrigins[0]);
      url.searchParams.set("scenario", request.scenario);
      url.searchParams.set("variant", request.variant);
      await surface.open(url.href, request.headless);
      const result =
        request.mode === "replay" && active.capability
          ? await this.replayCapability(active, active.capability, emit)
          : await this.discover(active, model, emit);
      if (request.mode === "discovery" && result.status === "success" && active.capability) {
        this.store.saveCapability(active.capability);
        emit("capability.saved", {
          id: active.capability.id,
          artifactHash: active.capability.provenance.artifactHash,
        });
      }
      this.rememberResult(run.id, result);
      run.result = this.safeResult(result);
      run.status =
        result.status === "success"
          ? "completed"
          : result.status === "business_outcome"
            ? "business_outcome"
            : "failed";
    } catch (thrown) {
      // Replay has no model to correct itself, so a refused action keeps its original code here.
      const error = thrown instanceof ToolRejected ? thrown.reason : thrown;
      if (error instanceof Outcome) {
        run.result = error.result;
        run.status = "business_outcome";
        this.rememberResult(run.id, error.result);
      } else await this.recordFailure(active, error, emit);
    } finally {
      clearTimeout(active.timeout);
      session.complete();
      run.durationMs = Date.now() - Date.parse(run.startedAt);
      emit("run.finished", {
        status: run.status,
        result: run.result,
        modelCalls: run.modelCalls,
        durationMs: run.durationMs,
      });
      await surface.close().catch(() => {});
      this.store.saveRun(run, request.inputs);
      this.active.delete(run.id);
    }
  }

  private replayCapability(
    active: Active,
    capability: Capability,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<Result> {
    emit("replay.started", {
      artifactHash: capability.provenance.artifactHash,
      modelAccess: "disabled",
    });
    return replay(capability, active.request.inputs, {
      outputs: active.outputs,
      signal: active.session.abort.signal,
      execute: (action) => this.execute(active, action, emit),
      inspect: () => this.inspect(active, emit),
    });
  }

  // The only path that may reach a model. Both adapters are imported lazily, so replay never
  // loads a provider module at all.
  private async discover(
    active: Active,
    model: string,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<Result> {
    const { request } = active;
    const host: DiscoveryHost = {
      goal: redact(request.goal, request.inputs) as string,
      inputs: request.inputs,
      signal: active.session.abort.signal,
      emit,
      tool: (name, args) => this.tool(active, name, args, model, emit),
      finish: async () => {
        if (!active.compiled)
          throw new RuntimeError(
            "DISCOVERY_INCOMPLETE",
            "The model ended without compiling a capability from a completed trajectory.",
          );
        return { status: "success", outputs: active.outputs };
      },
    };
    if (request.backend !== "codex") {
      const { DirectApiBackend } = await import("../../packages/discovery/direct-api.ts");
      return new DirectApiBackend(model).run(host);
    }
    const { CodexBackend } = await import("../../packages/discovery/codex-app-server.ts");
    const cwd = join(this.root, ".local", "discovery");
    mkdirSync(cwd, { recursive: true });
    return new CodexBackend({
      binary: process.env.CODEX_BIN ?? "codex",
      cwd,
      model,
      effort: "medium",
    }).run(host);
  }

  private async recordFailure(
    active: Active,
    error: unknown,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<void> {
    const { session, run, surface } = active;
    // A cancellation reason set on the abort signal is more specific than whatever unwound first.
    const failure =
      session.abort.signal.aborted && session.abort.signal.reason instanceof RuntimeError
        ? session.abort.signal.reason
        : error;
    run.status =
      failure instanceof RuntimeError && failure.code === "CANCELLED" ? "cancelled" : "failed";
    run.result = {
      status: "failure",
      code: failure instanceof RuntimeError ? failure.code : "EXECUTION_FAILED",
      message:
        failure instanceof RuntimeError
          ? failure.message
          : "The browser operation failed. See the failed step and redacted observation.",
      step: run.step,
      ...(failure instanceof RuntimeError ? failure.details : {}),
    };
    try {
      const directory = join(this.root, ".local", "runs", run.id);
      mkdirSync(directory, { recursive: true });
      await surface.screenshot(join(directory, "failure.png"));
      run.result.screenshot = "failure.png";
      emit("failure.observation", { text: (await surface.observe()).text });
    } catch {
      emit("failure.evidence_unavailable", {
        reason: "The browser session was already closed.",
      });
    }
  }

  private armBudget(active: Active): void {
    active.armedAt = Date.now();
    active.timeout = setTimeout(
      () => active.session.cancel("RUN_TIMEOUT", "The run exceeded its elapsed-time budget."),
      Math.max(active.budgetMs, 1),
    );
  }
  private holdBudget(active: Active): void {
    clearTimeout(active.timeout);
    active.budgetMs -= Date.now() - active.armedAt;
  }

  private safeResult(result: Result): Result {
    if (result.status !== "success") return result;
    const outputs = Object.fromEntries(
      Object.keys(result.outputs).map((key) => [key, "[REDACTED]"]),
    );
    return { status: "success", outputs };
  }

  private async inspect(
    active: Active,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<Result | undefined> {
    active.session.assertAutomation();
    active.surface.assertState();
    const rules = active.capability?.outcomes ?? this.policy.outcomes;
    for (const rule of rules)
      if (await active.surface.hasHeading(rule.text)) {
        emit("outcome.detected", { code: rule.code, kind: rule.kind, step: active.run.step });
        if (rule.kind === "business")
          return { status: "business_outcome", code: rule.code, message: rule.text };
        if (rule.kind === "failure") throw new RuntimeError(rule.code, rule.text);
        if (rule.kind === "retry") {
          if (++active.recoveries > this.policy.maxRecoveries)
            throw new RuntimeError(
              "RECOVERY_EXHAUSTED",
              "The configured recovery budget was exhausted.",
            );
          if (rule.recovery !== "reload")
            throw new RuntimeError(
              "RECOVERY_UNSUPPORTED",
              "This recovery action is not implemented.",
            );
          emit("recovery.started", {
            code: rule.code,
            attempt: active.recoveries,
            action: "reload",
          });
          await active.surface.reload();
          return this.inspect(active, emit);
        }
        await this.handoff(active, `${rule.code}: ${rule.text}`, emit);
        if (await active.surface.hasHeading(rule.text))
          throw new RuntimeError(
            "HANDOFF_UNRESOLVED",
            "The operator returned control without resolving the blocked state.",
          );
        return this.inspect(active, emit);
      }
    if (await active.surface.hasDialog()) {
      await this.handoff(active, "An unexpected dialog blocks the current page.", emit);
      if (await active.surface.hasDialog())
        throw new RuntimeError("HANDOFF_UNRESOLVED", "The dialog is still open after handoff.");
    }
    return undefined;
  }

  private async execute(
    active: Active,
    raw: Action,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<void> {
    const action = actionSchema.parse(raw);
    active.session.assertAutomation();
    if (active.run.step >= this.policy.maxSteps)
      throw new RuntimeError("STEP_LIMIT", "The action budget was exhausted.");
    const outcome = await this.inspect(active, emit);
    if (outcome) throw new Outcome(outcome);
    active.run.step++;
    emit("action.started", { step: active.run.step, action });
    // Observable change is a progress hint; the final checkpoint verifies task success.
    const checkEffect = active.request.mode === "discovery" && action.type === "click";
    const before = checkEffect ? await active.surface.signature() : "";
    const value = await rejectable(() => active.surface.execute(action, active.request.inputs));
    if (
      checkEffect &&
      !(await waitForSurfaceChange(
        active.surface,
        before,
        this.policy.actionTimeoutMs,
        active.session.abort.signal,
      ))
    )
      throw new ToolRejected(
        new RuntimeError(
          "ACTION_WITHOUT_EFFECT",
          "No observable page change was detected within the action timeout. The click was executed; do not retry it blindly. Observe the page or request handoff if its outcome is uncertain.",
        ),
      );
    active.session.assertAutomation();
    if (action.type === "read" && value !== undefined) active.outputs[action.output] = value;
    active.actions.push(action);
    emit("action.completed", {
      step: active.run.step,
      action,
      output:
        action.type === "read"
          ? {
              name: action.output,
              value: "[REDACTED]",
            }
          : undefined,
    });
    const after = await this.inspect(active, emit);
    if (after) throw new Outcome(after);
  }

  private async handoff(
    active: Active,
    reason: string,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<void> {
    if (active.request.headless)
      throw new RuntimeError(
        "HEADLESS_HANDOFF_UNAVAILABLE",
        "Human handoff needs a headed browser. Start the run without --headless.",
      );
    const directory = join(this.root, ".local", "runs", active.run.id);
    mkdirSync(directory, { recursive: true });
    await active.surface.screenshot(join(directory, "intervention.png"));
    emit("intervention.requested", {
      reason,
      step: active.run.step,
      sessionId: active.surface.sessionId,
      screenshot: "intervention.png",
    });
    await active.session.waitForHuman(reason);
    emit("intervention.resumed", {
      sessionId: active.surface.sessionId,
      observation: (await active.surface.observe()).text,
    });
  }

  private async tool(
    active: Active,
    name: string,
    args: unknown,
    model: string,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<ToolResult> {
    try {
      return await this.dispatch(active, name, args, model, emit);
    } catch (error) {
      if (!(error instanceof ToolRejected)) throw error;
      if (++active.rejections > this.policy.maxToolRejections)
        throw new RuntimeError(
          "REJECTION_LIMIT",
          "Discovery exhausted its budget for refused requests.",
          { observed: error.message },
        );
      emit("action.rejected", {
        tool: name,
        step: active.run.step,
        attempt: active.rejections,
        reason: error.message,
      });
      return {
        success: false,
        contentItems: [
          { type: "inputText", text: redact(error.message, active.request.inputs) as string },
        ],
      };
    }
  }

  private async dispatch(
    active: Active,
    name: string,
    args: unknown,
    model: string,
    emit: (type: string, data: Record<string, unknown>) => void,
  ): Promise<ToolResult> {
    active.session.assertAutomation();
    if (++active.observationCount > this.policy.maxSteps * 3)
      throw new RuntimeError("TOOL_LIMIT", "Discovery exhausted its total tool budget.");
    let result: unknown;
    if (name === "observe") {
      const options = await rejectable(() => toolSchemas.observe.parse(args));
      const observation = await active.surface.observe(options.screenshot);
      emit("observation", {
        url: observation.url,
        frameUrls: observation.frameUrls,
        text: observation.text,
        imageIncluded: Boolean(observation.image),
      });
      return {
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({ url: observation.url, text: observation.text }),
          },
          ...(observation.image
            ? [{ type: "inputImage" as const, imageUrl: observation.image }]
            : []),
        ],
      };
    }
    if (name === "act") {
      if (active.compiled)
        throw new RuntimeError(
          "DISCOVERY_SEALED",
          "The compiled trajectory cannot accept more actions.",
        );
      const { action } = await rejectable(() => toolSchemas.act.parse(args));
      await this.execute(active, action, emit);
      result = {
        executed: true,
        output:
          action.type === "read"
            ? {
                name: action.output,
                value: "[REDACTED]",
                validated: true,
              }
            : undefined,
      };
    } else if (name === "request_handoff") {
      const { reason } = await rejectable(() => toolSchemas.request_handoff.parse(args));
      await this.handoff(active, reason, emit);
      result = { resumed: true };
    } else if (name === "complete") {
      const capability = await rejectable(() =>
        compileCapability({
          id: toolSchemas.complete.parse(args).capabilityId,
          goal: active.request.goal,
          actions: active.actions,
          inputs: active.request.inputs,
          policy: this.policy,
          runId: active.run.id,
          backend: active.request.backend,
          model,
          requiredOutputs: { balance: "money", currency: "text" },
          entryPath: active.request.target,
        }),
      );
      active.capability = capability;
      active.compiled = true;
      active.run.capabilityId = capability.id;
      emit("capability.compiled", {
        id: capability.id,
        artifactHash: capability.provenance.artifactHash,
        steps: capability.steps.length,
      });
      result = { capabilityId: capability.id, compiled: true };
    } else throw new RuntimeError("UNKNOWN_TOOL", "Unknown discovery tool.");
    return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] };
  }

  control(id: string, action: "take" | "resume" | "cancel"): void {
    const active = this.active.get(id);
    if (!active)
      throw new RuntimeError("RUN_NOT_ACTIVE", "This run has no active browser session.");
    if (action === "take") active.session.takeControl();
    else if (action === "resume") active.session.resume();
    else active.session.cancel();
  }
  result(id: string): Result | undefined {
    const result = this.results.get(id);
    if (result) return structuredClone(result);
    const stored = this.store.getRun(id)?.result;
    if (stored?.status === "success")
      throw new RuntimeError(
        "RESULT_EXPIRED",
        "Raw outputs expire five minutes after completion and are not persisted. Run the capability again.",
      );
    return stored;
  }
  private rememberResult(id: string, result: Result): void {
    this.results.set(id, structuredClone(result));
    const timer = setTimeout(() => {
      this.results.delete(id);
      this.resultTimers.delete(id);
    }, 300000);
    timer.unref();
    this.resultTimers.set(id, timer);
  }
  async wait(id: string): Promise<Run | undefined> {
    await this.active.get(id)?.done;
    return this.store.getRun(id);
  }
  async close(): Promise<void> {
    const running = [...this.active.values()];
    for (const active of running) active.session.cancel();
    await Promise.all(running.map((active) => active.done));
    for (const timer of this.resultTimers.values()) clearTimeout(timer);
    this.resultTimers.clear();
    this.results.clear();
    this.store.close();
  }
}
