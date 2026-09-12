import { setTimeout as delay } from "node:timers/promises";
import type { Surface } from "../browser/adapter.ts";

export async function waitForSurfaceChange(
  surface: Pick<Surface, "signature" | "assertState">,
  previous: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    surface.assertState();
    const current = await surface.signature();
    signal.throwIfAborted();
    surface.assertState();
    if (current !== previous) return true;
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    await delay(Math.min(50, remaining), undefined, { signal });
  }
}
