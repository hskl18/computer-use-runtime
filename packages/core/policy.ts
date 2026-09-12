import { type Action, type Inputs, type Policy, RuntimeError } from "./contracts.ts";

export function assertUrl(raw: string, policy: Policy): void {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    !policy.allowedOrigins.includes(url.origin) ||
    !policy.pathPrefixes.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    throw new RuntimeError(
      "POLICY_URL_BLOCKED",
      "The target URL is outside the configured allowlist.",
    );
  }
}

export function assertAction(action: Action, policy: Policy): void {
  if (!policy.actions.includes(action.type))
    throw new RuntimeError("POLICY_ACTION_BLOCKED", `Action not allowed: ${action.type}`);
}

export function assertClick(name: string, policy: Policy): void {
  if (
    policy.blockedControlNames.some((blocked) => name.toLowerCase().includes(blocked.toLowerCase()))
  ) {
    throw new RuntimeError(
      "RISKY_ACTION_BLOCKED",
      "This control may cause an irreversible change. Automated execution is blocked.",
    );
  }
  if (!policy.allowedClickNames.includes(name.trim()))
    throw new RuntimeError("POLICY_CONTROL_BLOCKED", "The control is not on the click allowlist.", {
      observed: name,
    });
}

const secretKey =
  /password|secret|token|authorization|cookie|credential|api.?key|ssn|email|phone|address/i;
const secretText =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{3}-\d{2}-\d{4})\b/gi;
const usageCounts = new Set([
  "totalTokens",
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "total_tokens",
  "input_tokens",
  "cached_tokens",
  "output_tokens",
  "reasoning_tokens",
]);

export function redact(value: unknown, inputs: Inputs = {}): unknown {
  if (typeof value === "string") {
    let text = value.replace(secretText, "[REDACTED]");
    for (const [key, entry] of Object.entries(inputs)) {
      const token = String(entry);
      if (token.length >= 3) text = text.split(token).join(`[input:${key}]`);
    }
    return text
      .replace(/\bM\d{4}\b/g, "[member-id]")
      .replace(/\b\d+(?:,\d{3})*\.\d{2}\b/g, "[amount]");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, inputs));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        typeof entry === "number" && usageCounts.has(key)
          ? entry
          : secretKey.test(key)
            ? "[REDACTED]"
            : redact(entry, inputs),
      ]),
    );
  return value;
}
