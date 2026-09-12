import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAction, assertClick, assertUrl, redact } from "./policy.ts";
import { testPolicy } from "./test-fixtures.ts";

test("risky controls are denied even if they are also on the click allowlist", () => {
  const policy = testPolicy({
    allowedClickNames: ["Search", "Submit transfer", "Please SUBMIT TRANSFER now"],
  });
  for (const name of [
    "Submit transfer",
    "Please SUBMIT TRANSFER now",
    "Delete member",
    "Close account",
  ]) {
    assert.throws(() => assertClick(name, policy), { code: "RISKY_ACTION_BLOCKED" });
  }
  assert.doesNotThrow(() => assertClick(" Search ", policy));
  assert.throws(() => assertClick("Unknown control", policy), { code: "POLICY_CONTROL_BLOCKED" });
});

test("URLs must retain the allowed origin and sandbox path without embedded credentials", () => {
  const policy = testPolicy();
  assert.doesNotThrow(() => assertUrl("http://127.0.0.1:3101/sandbox/?scenario=normal", policy));
  for (const url of [
    "https://example.com/sandbox/",
    "http://127.0.0.1:3102/sandbox/",
    "http://user:password@127.0.0.1:3101/sandbox/",
    "http://127.0.0.1:3101/sandbox/../private",
    "http://127.0.0.1:3101/sandbox-escape/",
  ])
    assert.throws(() => assertUrl(url, policy), { code: "POLICY_URL_BLOCKED" });
});

test("disabled action types are blocked independently of their target", () => {
  const policy = testPolicy({ actions: ["read"] });
  assert.throws(
    () =>
      assertAction(
        {
          type: "click",
          target: { by: "role", role: "button", name: "Search" },
          reason: "Search member.",
        },
        policy,
      ),
    { code: "POLICY_ACTION_BLOCKED" },
  );
});

test("recursive redaction removes credentials and invocation values without mutating the source", () => {
  const original = {
    message: "Member M1001 contacted test@example.com with 123-45-6789 and sk-abcdefghijklmnop",
    nested: [{ authorization: "Bearer token", apiKey: "secret-value", safe: "M1001" }],
    count: 3,
    active: true,
  };
  const copy = structuredClone(original);
  const redacted = redact(original, { memberId: "M1001" });
  assert.deepEqual(redacted, {
    message: "Member [input:memberId] contacted [REDACTED] with [REDACTED] and [REDACTED]",
    nested: [{ authorization: "[REDACTED]", apiKey: "[REDACTED]", safe: "[input:memberId]" }],
    count: 3,
    active: true,
  });
  assert.deepEqual(original, copy);
});

test("numeric usage counts remain inspectable while credential tokens remain secret", () => {
  assert.deepEqual(
    redact({
      usage: { inputTokens: 45, output_tokens: 7 },
      accessToken: "abc",
      inputTokens: "not-a-count",
    }),
    {
      usage: { inputTokens: 45, output_tokens: 7 },
      accessToken: "[REDACTED]",
      inputTokens: "[REDACTED]",
    },
  );
});

test("observations also mask another member and ungrouped money values", () => {
  assert.equal(
    redact("Expected M2002; observed M3003 with 8032.10 or 8,032.10", { memberId: "M2002" }),
    "Expected [input:memberId]; observed [member-id] with [amount] or [amount]",
  );
});
