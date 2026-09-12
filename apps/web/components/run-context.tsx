import { ArrowRight, Circle, Clock3, Hand, ShieldCheck } from "lucide-react";
import type { Run } from "../../../packages/core/contracts";
import { EvidenceImage } from "./evidence-image";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const duration = (ms?: number) => (ms === undefined ? "In progress" : `${(ms / 1000).toFixed(1)}s`);
type Props = {
  selected?: Run;
  actionCount: number;
  busy: boolean;
  control: (action: "take" | "resume" | "cancel") => Promise<void>;
};
export function RunContext({ selected, actionCount, busy, control }: Props) {
  return (
    <aside className="context-panel">
      <div className="context-title">
        <h3>Run context</h3>
        <Circle size={12} />
      </div>
      <dl className="context-details">
        <div>
          <dt>Execution</dt>
          <dd>{selected?.mode ?? "Not started"}</dd>
        </div>
        <div>
          <dt>Model responses</dt>
          <dd>{selected ? selected.modelCalls : "-"}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>
            <Clock3 size={12} />
            {selected ? duration(selected.durationMs) : "-"}
          </dd>
        </div>
        <div>
          <dt>Completed steps</dt>
          <dd>{actionCount}</dd>
        </div>
        <div>
          <dt>Surface</dt>
          <dd>Browser · iframe</dd>
        </div>
        <div>
          <dt>Data</dt>
          <dd>Synthetic only</dd>
        </div>
      </dl>
      <div className="boundary">
        <ShieldCheck size={18} />
        <div>
          <strong>Controlled execution</strong>
          <p>Allowed routes and actions. Parameterized inputs. Redacted evidence.</p>
        </div>
      </div>
      <div className="handoff-panel">
        <Hand size={19} />
        <h3>Human handoff</h3>
        {selected?.intervention ? (
          <>
            <p>{selected.intervention.reason}</p>
            {selected.status === "human" || selected.status === "paused" ? (
              <>
                <Badge>
                  {selected.status === "human" ? "You own the session" : "Waiting for an operator"}
                </Badge>
                <p>Use the open browser window to resolve the blocked state.</p>
                <Button
                  disabled={busy}
                  onClick={() => void control(selected.status === "human" ? "resume" : "take")}
                >
                  {selected.status === "human" ? "Return control" : "Take control"}
                  <ArrowRight size={14} />
                </Button>
              </>
            ) : (
              <Badge>Intervention recorded</Badge>
            )}
            <EvidenceImage key={selected.id} runId={selected.id} kind="intervention" />
          </>
        ) : (
          <p>When execution needs help, take control of the same live session here.</p>
        )}
      </div>
      <div className="contract-note">
        <span className="mono">INPUT → OUTPUT</span>
        <p>memberId → balance, currency</p>
        <small>Sensitive output values stay out of persisted run results.</small>
      </div>
    </aside>
  );
}
