import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { type Result, RuntimeError } from "../core/contracts.ts";
import {
  type DiscoveryBackend,
  type DiscoveryHost,
  dynamicTools,
  instructions,
} from "./backend.ts";

export class DirectApiBackend implements DiscoveryBackend {
  constructor(private model: string) {}
  async run(host: DiscoveryHost): Promise<Result> {
    if (!process.env.OPENAI_API_KEY)
      throw new RuntimeError(
        "API_KEY_MISSING",
        "Direct API mode requires OPENAI_API_KEY and uses API billing.",
      );
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1 });
    const input: ResponseInputItem[] = [{ role: "user", content: instructions(host) }];
    for (let i = 0; i < 40; i++) {
      host.signal.throwIfAborted();
      host.emit("model.request", { model: this.model, authentication: "api-key" });
      const response = await client.responses.create(
        {
          model: this.model,
          input,
          store: false,
          parallel_tool_calls: false,
          tools: dynamicTools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: false,
          })),
        },
        { signal: host.signal },
      );
      host.emit("model.response", { responseId: response.id, usage: response.usage });
      const calls = response.output.filter((item) => item.type === "function_call");
      input.push(...(response.output as ResponseInputItem[]));
      if (!calls.length) return host.finish();
      for (const call of calls) {
        let argumentsValue: unknown = call.arguments;
        try {
          argumentsValue = JSON.parse(call.arguments);
        } catch {
          // The host rejects malformed values through the same bounded correction path.
        }
        const result = await host.tool(call.name, argumentsValue);
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(
            result.contentItems
              .filter((item) => item.type === "inputText")
              .map((item) => item.text),
          ),
        });
        for (const item of result.contentItems)
          if (item.type === "inputImage")
            input.push({
              role: "user",
              content: [{ type: "input_image", image_url: item.imageUrl, detail: "auto" }],
            });
      }
    }
    throw new RuntimeError("MODEL_STEP_LIMIT", "Discovery exceeded the model call limit.");
  }
}
