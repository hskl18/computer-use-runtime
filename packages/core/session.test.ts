import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionController } from "./session.ts";
import { testPolicy } from "./test-fixtures.ts";

test("handoff blocks automation until the same session is claimed and resumed", async () => {
  const changes: Array<{ state: string; reason?: string }> = [];
  const session = new SessionController(testPolicy(), (state, reason) =>
    changes.push({ state, reason }),
  );
  const signal = session.abort.signal;
  session.assertAutomation();
  const resumed = session.waitForHuman("Session expired");
  assert.equal(session.owner, "paused");
  assert.throws(() => session.assertAutomation(), { code: "CONTROL_NOT_OWNED" });
  assert.throws(() => session.resume(), { code: "INVALID_TRANSITION" });
  session.takeControl();
  assert.equal(session.owner, "human");
  assert.throws(() => session.assertAutomation(), { code: "CONTROL_NOT_OWNED" });
  assert.throws(() => session.takeControl(), { code: "INVALID_TRANSITION" });
  session.resume();
  await resumed;
  session.assertAutomation();
  assert.equal(session.abort.signal, signal);
  assert.equal(signal.aborted, false);
  assert.deepEqual(changes, [
    { state: "paused", reason: "Session expired" },
    { state: "human", reason: undefined },
    { state: "automation", reason: undefined },
  ]);
  session.complete();
});

test("take and resume reject transitions without an outstanding handoff", () => {
  const session = new SessionController(testPolicy(), () => {});
  assert.throws(() => session.takeControl(), { code: "INVALID_TRANSITION" });
  assert.throws(() => session.resume(), { code: "INVALID_TRANSITION" });
  session.complete();
  assert.throws(() => session.assertAutomation(), { code: "CONTROL_NOT_OWNED" });
  assert.throws(() => session.waitForHuman("Late handoff"), { code: "CONTROL_NOT_OWNED" });
});

test("cancelling a human-owned session rejects its waiter and permanently ends automation", async () => {
  const states: string[] = [];
  const session = new SessionController(testPolicy(), (state) => states.push(state));
  const resumed = session.waitForHuman("Operator required");
  const rejected = assert.rejects(resumed, { code: "CANCELLED" });
  session.takeControl();
  session.cancel();
  session.cancel();
  await rejected;
  assert.equal(session.owner, "closed");
  assert.equal(session.abort.signal.aborted, true);
  assert.throws(() => session.assertAutomation(), { code: "CANCELLED" });
  assert.throws(() => session.resume(), { code: "INVALID_TRANSITION" });
  assert.deepEqual(states, ["paused", "human", "closed"]);
});

test("handoff timeout closes both unclaimed and human-owned sessions", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const takeControl of [false, true]) {
    const session = new SessionController(testPolicy({ handoffTimeoutMs: 100 }), () => {});
    const resumed = session.waitForHuman("Operator required");
    const rejected = assert.rejects(resumed, { code: "HUMAN_TIMEOUT" });
    if (takeControl) session.takeControl();
    context.mock.timers.tick(99);
    assert.notEqual(session.owner, "closed");
    context.mock.timers.tick(1);
    await rejected;
    assert.equal(session.owner, "closed");
    assert.throws(() => session.assertAutomation(), { code: "HUMAN_TIMEOUT" });
  }
});

test("resuming clears the old deadline and a later handoff has its own timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new SessionController(testPolicy({ handoffTimeoutMs: 100 }), () => {});
  const first = session.waitForHuman("First intervention");
  context.mock.timers.tick(80);
  session.takeControl();
  session.resume();
  await first;
  context.mock.timers.tick(200);
  session.assertAutomation();
  const second = session.waitForHuman("Second intervention");
  const rejected = assert.rejects(second, { code: "HUMAN_TIMEOUT" });
  context.mock.timers.tick(100);
  await rejected;
});
