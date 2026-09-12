#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="computer-use-runtime"
ACTION="${1:-status}"
require() { command -v "$1" >/dev/null || { echo "Missing $1. Install it before continuing." >&2; exit 1; }; }
require tmux
require pnpm
require node
command_for() {
  case "$1" in
    worker) printf 'cd %q && pnpm worker' "$ROOT" ;;
    web) printf 'cd %q && pnpm web' "$ROOT" ;;
    *) echo "Unknown service: $1" >&2; exit 1 ;;
  esac
}
status() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then tmux list-windows -t "$SESSION" -F '#{window_name}: #{pane_current_command}'; else echo "Stack stopped."; fi
  for port in 3101 3100; do
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/$([[ "$port" == 3101 ]] && echo api/health)" >/dev/null 2>&1; then echo "http://127.0.0.1:$port ready"; else echo "http://127.0.0.1:$port unavailable"; fi
  done
}
case "$ACTION" in
  up)
    if ! tmux has-session -t "$SESSION" 2>/dev/null; then
      for port in 3101 3100; do if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $port is already in use." >&2; exit 1; fi; done
      tmux new-session -d -s "$SESSION" -n worker "$(command_for worker)"
      for _ in {1..30}; do if curl -fsS --max-time 1 http://127.0.0.1:3101/api/health >/dev/null 2>&1; then break; fi; sleep 1; done
      curl -fsS --max-time 2 http://127.0.0.1:3101/api/health >/dev/null || { echo "Worker failed to start. Run scripts/dev-local.sh logs worker." >&2; exit 1; }
    fi
    tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -qx web || tmux new-window -t "$SESSION" -n web "$(command_for web)"
    status ;;
  down) tmux kill-session -t "$SESSION" 2>/dev/null || true ;;
  status) status ;;
  logs) tmux capture-pane -p -t "$SESSION:${2:-worker}" -S -150 ;;
  restart) SERVICE="${2:?Specify worker or web}"; tmux respawn-pane -k -t "$SESSION:$SERVICE" "$(command_for "$SERVICE")" ;;
  attach) tmux attach-session -t "$SESSION" ;;
  *) echo "Usage: $0 {up|down [--all]|status|logs SERVICE|restart SERVICE|attach}" >&2; exit 1 ;;
esac
