import { Activity, ChevronRight, Layers3, Workflow } from "lucide-react";
import type { Run } from "../../../packages/core/contracts";

type Props = {
  runs: Run[];
  selected?: Run;
  ready: boolean;
  capabilityCount: number;
  setSelectedId: (id: string) => void;
  setTab: (tab: "execution" | "artifact" | "design") => void;
};
export function Sidebar({ runs, selected, ready, capabilityCount, setSelectedId, setTab }: Props) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/">
        <span className="brand-mark">
          <Workflow size={21} />
        </span>
        <span>
          computer use<span className="brand-sub">RUNTIME</span>
        </span>
      </a>
      <div className="mobile-history">
        <label htmlFor="recent-run">Recent runs</label>
        <select
          id="recent-run"
          value={selected?.id ?? ""}
          disabled={!runs.length}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setTab("execution");
          }}
        >
          {!runs.length && <option value="">No runs yet</option>}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id.slice(0, 8)} · {run.mode} · {run.status.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="sidebar-label">WORKSPACE</div>
      <div className="nav-active">
        <Activity size={16} /> Runs <span>{runs.length}</span>
      </div>
      <button className="nav-item" onClick={() => setTab("artifact")} type="button">
        <Layers3 size={16} /> Capabilities <span>{capabilityCount}</span>
      </button>
      <button className="nav-item" onClick={() => setTab("design")} type="button">
        <Workflow size={16} /> Architecture
      </button>
      <div className="sidebar-label history-label">RECENT RUNS</div>
      <div className="run-list">
        {runs.map((run) => (
          <button
            type="button"
            className={`run-link ${run.id === selected?.id ? "selected" : ""}`}
            key={run.id}
            onClick={() => {
              setSelectedId(run.id);
              setTab("execution");
            }}
          >
            <span className={`status-dot ${run.status}`} />
            <span>
              <strong>
                {run.mode === "discovery" ? "Discover workflow" : "Replay capability"}
              </strong>
              <small>
                {run.id.slice(0, 8)} · {run.scenario}
              </small>
            </span>
            <ChevronRight size={12} />
          </button>
        ))}
        {!runs.length && <p className="sidebar-empty">Your first run will appear here.</p>}
      </div>
      <div className="sidebar-footer">
        <span className={`status-dot ${ready ? "completed" : "failed"}`} />
        <span>{ready ? "Local worker connected" : "Worker unavailable"}</span>
        <small>127.0.0.1 · Synthetic data</small>
      </div>
    </aside>
  );
}
