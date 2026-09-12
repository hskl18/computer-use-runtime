import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { waitForSurfaceChange } from "./progress.ts";

test("click observation waits for an asynchronous page update", async () => {
  let state = "before";
  const pending = waitForSurfaceChange(
    { signature: async () => state, assertState() {} },
    "before",
    1000,
    new AbortController().signal,
  );
  await delay(100);
  state = "after";
  assert.equal(await pending, true);
});

test("an unchanged page reaches the observation deadline without another action", async () => {
  const started = performance.now();
  assert.equal(
    await waitForSurfaceChange(
      { signature: async () => "before", assertState() {} },
      "before",
      100,
      new AbortController().signal,
    ),
    false,
  );
  assert.ok(performance.now() - started >= 100);
});

test("cancellation interrupts a pending observation wait", async () => {
  const controller = new AbortController();
  let reads = 0;
  const pending = waitForSurfaceChange(
    {
      signature: async () => {
        reads++;
        return "before";
      },
      assertState() {},
    },
    "before",
    5000,
    controller.signal,
  );
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await delay(10);
  controller.abort();
  await rejected;
  const stoppedAt = reads;
  await delay(60);
  assert.equal(reads, stoppedAt);
});

test("a policy failure during observation is not treated as page progress", async () => {
  const failure = new Error("Blocked request");
  let blocked = false;
  await assert.rejects(
    waitForSurfaceChange(
      {
        signature: async () => {
          blocked = true;
          return "changed";
        },
        assertState() {
          if (blocked) throw failure;
        },
      },
      "before",
      1000,
      new AbortController().signal,
    ),
    (error) => error === failure,
  );
});
