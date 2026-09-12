"use client";

import {
  Activity,
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  LoaderCircle,
  Square,
  Terminal,
  Workflow,
} from "lucide-react";
import type { Capability, Run, RunEvent } from "../../../packages/core/contracts";
import { EvidenceImage } from "./evidence-image";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export type InspectorTab = "execution" | "artifact" | "design";
const activeStatus = (run?: Run) =>
  Boolean(run && ["running", "paused", "human"].includes(run.status));

export function InspectorPanel({
  tab,
  setTab,
  selected,
  busy,
  control,
  actionEvents,
  events,
  recordedCapability,
}: {
  tab: InspectorTab;
  setTab: (value: InspectorTab) => void;
  selected?: Run;
  busy: boolean;
  control: (action: "take" | "resume" | "cancel") => Promise<void>;
  actionEvents: RunEvent[];
  events: RunEvent[];
  recordedCapability?: Capability;
}) {
  return (
    <section className="execution-panel">
      <div className="tabs" role="tablist" aria-label="Inspector view">
        {(["execution", "artifact", "design"] as const).map((value) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            key={value}
            className={tab === value ? "tab-active" : ""}
            onClick={() => setTab(value)}
          >
            {value === "execution" ? (
              <Activity size={14} />
            ) : value === "artifact" ? (
              <Braces size={14} />
            ) : (
              <Workflow size={14} />
            )}
            {value === "design"
              ? "Architecture"
              : value === "artifact"
                ? "Capability"
                : "Execution"}
          </button>
        ))}
      </div>
      {tab === "execution" &&
        (selected ? (
          <>
            <div className="run-summary">
              <span className="mono">{selected.id.slice(0, 8)}</span>
              <span>{selected.mode === "discovery" ? selected.model : "Deterministic replay"}</span>
              {activeStatus(selected) && (
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy}
                  onClick={() => void control("cancel")}
                >
                  <Square size={11} /> Stop
                </Button>
              )}
            </div>
            <div className="timeline">
              {actionEvents.map((event, index) => {
                const action = event.data.action as {
                  type: string;
                  reason: string;
                  target?: unknown;
                };
                return (
                  <details key={event.sequence} className="timeline-step">
                    <summary>
                      <span className="step-check">
                        <Check size={12} />
                      </span>
                      <span className="step-content">
                        <strong>
                          {action.type}
                          <span className="step-index">STEP {index + 1}</span>
                        </strong>
                        <span>{action.reason}</span>
                      </span>
                      <ChevronRight size={13} className="step-chevron" />
                    </summary>
                    <pre>{JSON.stringify(action, null, 2)}</pre>
                  </details>
                );
              })}
              {!actionEvents.length && (
                <div className="execution-empty">
                  <span className="empty-symbol">
                    {activeStatus(selected) ? (
                      <LoaderCircle size={25} className="spin" />
                    ) : (
                      <Workflow size={25} />
                    )}
                  </span>
                  <h3>
                    {activeStatus(selected) ? "Preparing the execution" : "No completed actions"}
                  </h3>
                  <p>
                    {activeStatus(selected)
                      ? "The worker is opening the session and connecting the discovery backend."
                      : "Inspect the result and event log for the stopping condition."}
                  </p>
                </div>
              )}
            </div>
            {selected.result && (
              <div
                className={`result-block ${selected.result.status === "failure" ? "result-error" : ""}`}
              >
                <div>
                  {selected.result.status === "failure" ? (
                    <CircleAlert size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  <strong>
                    {selected.result.status === "success"
                      ? "Checkpoint passed"
                      : selected.result.status === "business_outcome"
                        ? "Business outcome"
                        : "Execution stopped"}
                  </strong>
                </div>
                <pre>{JSON.stringify(selected.result, null, 2)}</pre>
                {selected.result.status === "failure" && selected.result.screenshot && (
                  <EvidenceImage key={selected.id} runId={selected.id} kind="failure" />
                )}
              </div>
            )}
            <details className="event-log">
              <summary>
                <Terminal size={14} /> Event log{" "}
                <span className="event-count">{events.length} events</span>
              </summary>
              <pre>
                {events
                  .map((event) =>
                    JSON.stringify({
                      sequence: event.sequence,
                      type: event.type,
                      data: event.data,
                    }),
                  )
                  .join("\n")}
              </pre>
            </details>
          </>
        ) : (
          <div className="execution-empty first-run">
            <span className="empty-symbol">
              <Workflow size={30} />
            </span>
            <h3>A workflow starts with one real run.</h3>
            <p>
              Run discovery against the local application.
              <br />
              Successful actions become an inspectable capability.
            </p>
            <div className="empty-flow">
              <span>Observe</span>
              <ArrowRight size={13} />
              <span>Act</span>
              <ArrowRight size={13} />
              <span>Verify</span>
            </div>
          </div>
        ))}
      {tab === "artifact" &&
        (recordedCapability ? (
          <div className="artifact-view">
            <div className="artifact-title">
              <Code2 size={16} />
              <strong>{recordedCapability.id}</strong>
              <Badge>v{recordedCapability.version}</Badge>
            </div>
            <p>The exact artifact recorded for this run. Inputs are bound at invocation time.</p>
            <pre>{JSON.stringify(recordedCapability, null, 2)}</pre>
          </div>
        ) : (
          <div className="execution-empty first-run">
            <Braces size={28} />
            <h3>No recorded capability for this run</h3>
            <p>A successful discovery saves an artifact. Replays record the artifact they used.</p>
          </div>
        ))}
      {tab === "design" && (
        <div className="design-view">
          <h3>The model discovers. The runtime executes.</h3>
          <div className="design-row">
            <div>
              Next.js console<small>Inspect and control</small>
            </div>
            <ArrowRight size={18} />
            <div>
              Runtime worker<small>Own the live session</small>
            </div>
          </div>
          <ArrowDown size={18} />
          <div className="design-row">
            <div>
              Codex / API<small>Discovery only</small>
            </div>
            <ArrowRight size={18} />
            <div>
              Policy + browser<small>Controlled actions</small>
            </div>
          </div>
          <ArrowDown size={18} />
          <div className="design-row">
            <div>
              Capability artifact<small>Versioned, typed contract</small>
            </div>
            <ArrowRight size={18} />
            <div>
              Replay engine<small>No model dependency</small>
            </div>
          </div>
          <p>
            SQLite stores run state and events. The browser stays in the worker during human
            handoff. A worker restart ends live sessions safely.
          </p>
        </div>
      )}
    </section>
  );
}
