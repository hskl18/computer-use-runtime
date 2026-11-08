# Security Policy

Computer Use Runtime is a local, single-user reference implementation that drives a synthetic UI.
It is not built to run against real accounts, real customer data, or a network other than the local machine.

## Supported Versions

Security fixes target the latest release.

## Reporting A Vulnerability

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/hskl18/computer-use-runtime/security/advisories/new).
Do not open a public issue containing credentials, Codex or OpenAI authentication files, or private data.

## Sensitive Data Guidance

Do not share:

- `.env` files or `OPENAI_API_KEY` values
- Codex `auth.json` or any `CODEX_HOME` directory
- browser profiles or Playwright traces from real sites
- the local SQLite database or `.local/` run directories
- unmasked screenshots or raw CLI output that contains real values

Use the synthetic fixture and its member IDs when reporting issues.

## Security Model

What the runtime enforces:

- The worker and console listen on 127.0.0.1 only.
- The worker rejects browser requests from other origins, and control requests and raw results need a local client header.
- Discovery gives the model four typed application tools; it never runs model-generated browser or shell code.
- Every automated action passes policy checks on origin, path, action type, allowed click names, and time and step budgets.
- Risky control names are blocked before activation, and password fields, popups, downloads, and service workers are rejected or disabled.
- Discovery runs from an isolated `CODEX_HOME` that links, rather than copies, the existing Codex credential, and refuses to start if any inherited MCP server is attached.
- Replay has no model provider in its dependency graph.
- Persisted results, events, and screenshots are masked.

What it does not provide:

- The local API has no authentication: the origin and header checks stop cross-site browser requests, not other processes on the machine.
- Text and image masks are written for the synthetic fixture and are not a general data-loss-prevention system.
- One recorded prompt-injection run does not establish robustness against prompt injection.
- There is no tenant isolation, and the operator handoff model trusts whoever controls the local browser.
