# Upstream references

These references informed the implementation.
Local protocol shapes were also inspected using Codex CLI 0.153.4's generated experimental JSON schema and command help.
Generated protocol files are not vendored or manually edited here.

| Source | Use |
| --- | --- |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | Embedded client protocol, dynamic tools, notifications |
| [Codex authentication](https://learn.chatgpt.com/docs/auth) | Subscription versus API-key authentication |
| [Codex open-source documentation](https://learn.chatgpt.com/docs/open-source) | Reusable CLI/App Server implementation and scope |
| [OpenAI Codex repository](https://github.com/openai/codex) | Protocol and configuration source |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | Model reference; availability still requires runtime evidence |
| [Playwright locators](https://playwright.dev/docs/locators) | Accessible targeting and iframe/table composition |
| [Playwright browser contexts](https://playwright.dev/docs/browser-contexts) | Separate contexts per run |
| [Next.js backend-for-frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend) | Keep long-lived sessions outside request handlers |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | Explicit direct API adapter |

The App Server integration targets an experimental protocol and currently enforces a 0.153.x CLI version check.
A compatible version string is a prerequisite, not proof of end-to-end compatibility.

## Decisions verified against pinned source

- [Codex tool mode selection](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/tools/mod.rs#L68-L89): Astra's runtime metadata selects the code-mode host; disabling that host produced the retained incomplete discovery.
- [Sandbox globals](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/code-mode-runtime/src/runtime/globals.rs#L15-L67) and [module loading](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/code-mode-runtime/src/runtime/module_loader.rs#L223-L235): bounded orchestration facilities and rejected module imports underpin the distinction between tool dispatch and general host execution.
- [Schema compaction](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/tools/src/json_schema/compaction.rs#L14-L38): the action schema must fit the compaction budget while retaining target details; the current schema and regression tests enforce this.
- [Auth file storage](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/login/src/auth/storage.rs#L188-L203): in-place persistence permits a runtime-owned authentication symlink without copying credential contents.
- [Playwright frame load state](https://playwright.dev/docs/api/class-frame#frame-wait-for-load-state): navigation must have committed before load-state waiting; the browser adapter observes frame navigation before native link/form activation.

These source checks informed implementation choices; recorded runtime tests establish the behavior observed here.
