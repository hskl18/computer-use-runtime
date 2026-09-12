import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { z } from "zod";
import { RuntimeError } from "../../packages/core/contracts.ts";
import { registerSandbox } from "../sandbox/index.ts";
import { Runtime } from "./runtime.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const port = Number(process.env.WORKER_PORT ?? 3101);
const webPort = Number(process.env.WEB_PORT ?? 3100);
const runtime = new Runtime(root, port);
const app = Fastify({ logger: false, bodyLimit: 16000 });
app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api/")) return;
  const origin = request.headers.origin;
  if (
    origin &&
    ![
      `http://127.0.0.1:${webPort}`,
      `http://localhost:${webPort}`,
      `http://127.0.0.1:${port}`,
    ].includes(origin)
  )
    return reply
      .code(403)
      .send({ error: "ORIGIN_BLOCKED", message: "This local runtime does not allow that origin." });
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers["x-runtime-client"] !== "console"
  )
    return reply.code(403).send({
      error: "CLIENT_HEADER_REQUIRED",
      message: "A local client header is required for control requests.",
    });
  reply.header("cache-control", "no-store");
});
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError)
    return reply.code(400).send({
      error: "INVALID_REQUEST",
      message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    });
  if (error instanceof RuntimeError)
    return reply
      .code(error.code === "CAPACITY" ? 429 : 409)
      .send({ error: error.code, message: error.message });
  return reply
    .code(500)
    .send({ error: "INTERNAL_ERROR", message: "The local worker could not complete the request." });
});
app.get("/api/health", async () => ({
  status: "ok",
  application: "computer-use-runtime",
  runtime: process.version,
  activeLimit: 2,
}));
app.get("/api/runs", async () => runtime.store.listRuns());
app.post("/api/runs", async (request, reply) => reply.code(202).send(runtime.start(request.body)));
app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
  const run = runtime.store.getRun(request.params.id);
  return run ?? reply.code(404).send({ error: "RUN_NOT_FOUND" });
});
app.get<{ Params: { id: string } }>("/api/runs/:id/result", async (request, reply) => {
  if (request.headers["x-runtime-client"] !== "console")
    return reply.code(403).send({ error: "CLIENT_HEADER_REQUIRED" });
  return (
    runtime.result(request.params.id) ?? reply.code(404).send({ error: "RESULT_NOT_AVAILABLE" })
  );
});
app.get<{ Params: { id: string } }>("/api/runs/:id/capability", async (request, reply) => {
  return (
    runtime.store.runCapability(request.params.id) ??
    reply.code(404).send({ error: "CAPABILITY_NOT_AVAILABLE" })
  );
});
app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
  "/api/runs/:id/events",
  async (request) =>
    runtime.store.events(request.params.id, Math.max(0, Number(request.query.after) || 0)),
);
app.post<{ Params: { id: string } }>("/api/runs/:id/control", async (request) => {
  const { action } = z
    .object({ action: z.enum(["take", "resume", "cancel"]) })
    .strict()
    .parse(request.body);
  runtime.control(request.params.id, action);
  return { accepted: true };
});
app.get<{ Params: { id: string; name: string } }>(
  "/api/runs/:id/images/:name",
  async (request, reply) => {
    const id = z.uuid().parse(request.params.id);
    const name = z.enum(["failure.png", "intervention.png"]).parse(request.params.name);
    try {
      return reply.type("image/png").send(await readFile(join(root, ".local", "runs", id, name)));
    } catch {
      return reply.code(404).send({ error: "IMAGE_NOT_FOUND" });
    }
  },
);
app.get("/api/capabilities", async () => runtime.store.capabilities());
registerSandbox(app);
app.addHook("onClose", async () => runtime.close());
await app.listen({ host: "127.0.0.1", port });
runtime.store.failStaleRuns();
console.log(`Worker ready at http://127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
