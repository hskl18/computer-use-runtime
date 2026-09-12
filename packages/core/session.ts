import { type Policy, RuntimeError } from "./contracts.ts";

export class SessionController {
  owner: "automation" | "paused" | "human" | "closed" = "automation";
  readonly abort = new AbortController();
  private resumeTask?: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private policy: Policy,
    private change: (state: SessionController["owner"], reason?: string) => void,
  ) {}
  assertAutomation(): void {
    this.abort.signal.throwIfAborted();
    if (this.owner !== "automation")
      throw new RuntimeError("CONTROL_NOT_OWNED", "Automation does not own the session.");
  }
  waitForHuman(reason: string): Promise<void> {
    this.assertAutomation();
    this.owner = "paused";
    this.change(this.owner, reason);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.cancel("HUMAN_TIMEOUT", "No operator resumed the session before its deadline."),
        this.policy.handoffTimeoutMs,
      );
      this.resumeTask = { resolve, reject, timer };
    });
  }
  takeControl(): void {
    if (this.owner !== "paused")
      throw new RuntimeError("INVALID_TRANSITION", "Only a paused session can be claimed.");
    this.owner = "human";
    this.change(this.owner);
  }
  resume(): void {
    if (this.owner !== "human" || !this.resumeTask)
      throw new RuntimeError("INVALID_TRANSITION", "Only the human owner can return control.");
    this.owner = "automation";
    this.change(this.owner);
    clearTimeout(this.resumeTask.timer);
    this.resumeTask.resolve();
    this.resumeTask = undefined;
  }
  cancel(code = "CANCELLED", message = "The operator cancelled this run."): void {
    if (this.owner === "closed") return;
    this.owner = "closed";
    const error = new RuntimeError(code, message);
    this.abort.abort(error);
    if (this.resumeTask) {
      clearTimeout(this.resumeTask.timer);
      this.resumeTask.reject(error);
      this.resumeTask = undefined;
    }
    this.change(this.owner);
  }
  complete(): void {
    this.owner = "closed";
    if (this.resumeTask) {
      clearTimeout(this.resumeTask.timer);
      this.resumeTask = undefined;
    }
  }
}
