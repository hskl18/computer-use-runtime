# Local services

| Service | Command | Port | Dependency |
| --- | --- | --- | --- |
| worker | `pnpm worker` | 3101 | Node.js, installed Chromium |
| web | `pnpm web` | 3100 | worker |

The worker also serves the synthetic target application under `/sandbox/`.
Run `pnpm install` and `pnpm exec playwright install chromium` once.
Use `scripts/dev-local.sh up`, `down`, `down --all`, `status`, `logs worker`, `restart web`, or `attach`.
The launcher uses one tmux session with separate windows for each service.
No real bank, external database, or hosted browser account is required.
