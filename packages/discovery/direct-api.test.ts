import assert from "node:assert/strict";
import { test } from "node:test";
import { DirectApiBackend } from "./direct-api.ts";
import { fakeHost } from "./provider-test-fixtures.ts";

test("malformed API arguments reach host rejection and its response permits a corrected tool call", async (context) => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-test-key-not-a-real-credential";
  context.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const requests: Array<Record<string, unknown>> = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(JSON.parse(await request.text()));
      const output =
        requests.length === 1
          ? [
              {
                type: "function_call",
                name: "observe",
                arguments: "{malformed",
                call_id: "bad-call",
                id: "fc-bad",
              },
            ]
          : requests.length === 2
            ? [
                {
                  type: "function_call",
                  name: "observe",
                  arguments: '{"screenshot":false}',
                  call_id: "corrected-call",
                  id: "fc-good",
                },
              ]
            : [];
      return new Response(
        JSON.stringify({ id: `fixture-response-${requests.length}`, output, usage: null }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );
  const { host, events } = fakeHost(new AbortController().signal);
  const argumentsSeen: unknown[] = [];
  host.tool = async (_name, args) => {
    argumentsSeen.push(args);
    return typeof args === "string"
      ? {
          success: false,
          contentItems: [{ type: "inputText", text: "Invalid tool arguments. Observe again." }],
        }
      : { success: true, contentItems: [{ type: "inputText", text: "Synthetic observation" }] };
  };
  const result = await new DirectApiBackend("fixture-model").run(host);
  assert.deepEqual(result, { status: "success", outputs: { currency: "USD" } });
  assert.deepEqual(argumentsSeen, ["{malformed", { screenshot: false }]);
  assert.equal(requests.length, 3);
  assert.match(JSON.stringify(requests[1]?.input), /Invalid tool arguments\. Observe again\./);
  assert.equal(events.filter((event) => event.type === "model.request").length, 3);
});
