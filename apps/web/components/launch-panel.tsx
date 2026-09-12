import { LoaderCircle, Play, RotateCcw, ShieldCheck } from "lucide-react";
import type { Capability } from "../../../packages/core/contracts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const statusLabel = (value: string) => value.replaceAll("_", " ");
type Props = {
  goal: string;
  setGoal: (value: string) => void;
  memberId: string;
  setMemberId: (value: string) => void;
  target: string;
  setTarget: (value: string) => void;
  scenario: string;
  setScenario: (value: string) => void;
  variant: string;
  setVariant: (value: string) => void;
  busy: boolean;
  ready: boolean;
  capability?: Capability;
  start: (mode: "discovery" | "replay") => Promise<void>;
};
export function LaunchPanel({
  goal,
  setGoal,
  memberId,
  setMemberId,
  target,
  setTarget,
  scenario,
  setScenario,
  variant,
  setVariant,
  busy,
  ready,
  capability,
  start,
}: Props) {
  return (
    <section className="launch-panel" aria-label="Start a run">
      <div className="launch-title">
        <span className="section-number">01</span>
        <h2>Define the task</h2>
        <Badge>Ledger demo</Badge>
      </div>
      <label className="field-label" htmlFor="goal">
        Goal
      </label>
      <textarea id="goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={2} />
      <div className="launch-bottom">
        <div className="input-group">
          <label htmlFor="target">Target path</label>
          <input id="target" value={target} onChange={(event) => setTarget(event.target.value)} />
        </div>
        <div className="input-group">
          <label htmlFor="member">Member ID</label>
          <input
            id="member"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          />
        </div>
        <div className="input-group">
          <label htmlFor="scenario">Scenario</label>
          <select
            id="scenario"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            {[
              "normal",
              "validation-error",
              "not-found",
              "permission-denied",
              "slow",
              "transient",
              "session-expired",
              "unexpected-dialog",
              "app-error",
              "duplicate-control",
              "risky",
              "prompt-injection",
            ].map((value) => (
              <option key={value} value={value}>
                {statusLabel(value.replaceAll("-", "_"))}
              </option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label htmlFor="variant">Application variant</label>
          <select id="variant" value={variant} onChange={(event) => setVariant(event.target.value)}>
            <option value="base">Ledger Operations</option>
            <option value="union">Union Services</option>
          </select>
        </div>
        <div className="launch-actions">
          <Button
            variant="secondary"
            disabled={busy || !ready || !capability}
            onClick={() => void start("replay")}
          >
            <RotateCcw size={15} /> Replay
          </Button>
          <Button
            disabled={busy || !ready || !memberId.trim() || !goal.trim() || !target.trim()}
            onClick={() => void start("discovery")}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} Discover
          </Button>
        </div>
      </div>
      <div className="launch-note">
        <ShieldCheck size={13} /> Discovery uses your local Codex session. Replay makes no model
        calls.
      </div>
      {capability && (
        <p className="replay-revision">
          Replay uses the latest saved {capability.id} ·{" "}
          {capability.provenance.artifactHash?.slice(0, 12)}
        </p>
      )}
    </section>
  );
}
