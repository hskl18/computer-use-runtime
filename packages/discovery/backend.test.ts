import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { dynamicTools, toolSchemas } from "./backend.ts";

type Schema = Record<string, unknown>;

function expanded(schema: Schema): { schema: Schema; references: number } {
  const definitions = (schema.$defs ?? {}) as Record<string, Schema>;
  let references = 0;
  function visit(value: unknown, active: string[] = []): unknown {
    if (Array.isArray(value)) return value.map((entry) => visit(entry, active));
    if (!value || typeof value !== "object") return value;
    const node = value as Schema;
    if (typeof node.$ref === "string") {
      assert.ok(node.$ref.startsWith("#/$defs/"), "Only local definitions are expected");
      const definition = definitions[node.$ref.slice("#/$defs/".length)];
      assert.ok(definition, `Dangling reference: ${node.$ref}`);
      assert.ok(!active.includes(node.$ref), "The provider schema must be acyclic");
      references++;
      const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$ref"));
      return visit({ ...definition, ...siblings }, [...active, node.$ref]);
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== "$defs")
        .map(([key, entry]) => [key, visit(entry, active)]),
    );
  }
  return { schema: visit(schema) as Schema, references };
}

test("provider schemas stay below Codex compaction and reference expansion limits", () => {
  for (const tool of dynamicTools) {
    const bytes = Buffer.byteLength(JSON.stringify(tool.inputSchema));
    assert.ok(bytes < 4500, `${tool.name} schema uses ${bytes} bytes`);
    const result = expanded(tool.inputSchema);
    assert.ok(result.references <= 32, `${tool.name} expands ${result.references} references`);
    assert.equal(result.schema.type, "object");
  }
});

test("observe preserves its required screenshot boolean", () => {
  const tool = dynamicTools.find((entry) => entry.name === "observe");
  assert.ok(tool);
  assert.deepEqual(expanded(tool.inputSchema).schema, z.toJSONSchema(toolSchemas.observe));
  assert.deepEqual(tool.inputSchema.required, ["screenshot"]);
  assert.deepEqual((tool.inputSchema.properties as Record<string, Schema>).screenshot, {
    type: "boolean",
  });
});

test("provider action schema preserves canonical targets, required fields, and read formats", () => {
  const tool = dynamicTools.find((entry) => entry.name === "act");
  assert.ok(tool);
  const canonical = z.toJSONSchema(toolSchemas.act) as Schema;
  const properties = canonical.properties as Record<string, Schema>;
  const variants = properties.action?.oneOf as Schema[];
  const navigate = variants.find(
    (variant) => (variant.properties as Record<string, Schema>).type?.const === "navigate",
  );
  assert.ok(navigate);
  const path = (navigate.properties as Record<string, Schema>).path;
  assert.ok(path);
  delete path.format;
  assert.deepEqual(expanded(tool.inputSchema).schema, canonical);

  const read = variants.find(
    (variant) => (variant.properties as Record<string, Schema>).type?.const === "read",
  );
  assert.ok(read);
  assert.deepEqual((read.properties as Record<string, Schema>).format?.enum, [
    "text",
    "money",
    "number",
  ]);
});
