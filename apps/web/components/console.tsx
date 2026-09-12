"use client";

import { ChevronRight, CircleDot } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Capability, Run, RunEvent } from "../../../packages/core/contracts";
import { InspectorPanel, type InspectorTab } from "./inspector-panel";
import { LaunchPanel } from "./launch-panel";
import { RunContext } from "./run-context";
import { Sidebar } from "./sidebar";
import { Badge } from "./ui/badge";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json", "x-runtime-client": "console" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "The worker is unavailable.");
  return data as T;
}
const statusLabel = (value: string) => value.replaceAll("_", " ");

export function Console() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [recordedCapability, setRecordedCapability] = useState<Capability>();
  const [selectedId, setSelectedId] = useState<string>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("execution");
  const [goal, setGoal] = useState(
    "Look up the member and return the savings balance and currency. Verify the member ID.",
  );
  const [memberId, setMemberId] = useState("M1001");
  const [target, setTarget] = useState("/sandbox/");
  const [scenario, setScenario] = useState("normal");
  const [variant, setVariant] = useState("base");
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  const capability = capabilities[0];
  const actionEvents = events.filter((event) => event.type === "action.completed");

  const refresh = useCallback(async () => {
    try {
      const [nextRuns, nextCapabilities] = await Promise.all([
        api<Run[]>("/runs"),
        api<Capability[]>("/capabilities"),
      ]);
      setRuns(nextRuns);
      setCapabilities(nextCapabilities);
      setReady(true);
    } catch {
      setReady(false);
    }
  }, []);
  useEffect(() => {
    setSelectedId(new URLSearchParams(window.location.search).get("run") ?? undefined);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 1200);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setEvents([]);
    if (!selected?.id) return;
    let cancelled = false;
    let fetching = false;
    let cursor = 0;
    const id = selected.id;
    const fetchEvents = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const data = await api<RunEvent[]>(`/runs/${id}/events?after=${cursor}`);
        if (!cancelled && data.length) {
          cursor = data.at(-1)?.sequence ?? cursor;
          setEvents((previous) => [...previous, ...data]);
        }
      } catch {
        /* Health is reported separately. */
      } finally {
        fetching = false;
      }
    };
    void fetchEvents();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchEvents();
    }, 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected?.id]);
  useEffect(() => {
    setRecordedCapability(undefined);
    if (!selected?.id || !selected.capabilityId) return;
    if (selected.mode === "discovery" && selected.status === "running") return;
    let cancelled = false;
    void api<Capability>(`/runs/${selected.id}/capability`)
      .then((artifact) => {
        if (!cancelled) setRecordedCapability(artifact);
      })
      .catch(() => {
        /* Runs without a saved artifact have an explicit empty state. */
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.capabilityId, selected?.mode, selected?.status]);

  async function start(mode: "discovery" | "replay") {
    setBusy(true);
    setError("");
    try {
      const run = await api<Run>("/runs", {
        mode,
        goal,
        target,
        inputs: { memberId },
        scenario,
        variant,
        backend: "codex",
        headless: false,
        ...(mode === "replay" ? { capabilityId: capability?.id } : {}),
      });
      setSelectedId(run.id);
      setTab("execution");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start run.");
    } finally {
      setBusy(false);
    }
  }
  async function control(action: "take" | "resume" | "cancel") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`/runs/${selected.id}/control`, { action });
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Control request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace">
      <Sidebar
        runs={runs}
        selected={selected}
        ready={ready}
        capabilityCount={capabilities.length}
        setSelectedId={setSelectedId}
        setTab={setTab}
      />
      <div className="main-column">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={13} />
            <strong>Run inspector</strong>
          </div>
          <span className="environment">
            <CircleDot size={13} /> LOCAL ENVIRONMENT
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div className="eyebrow">DISCOVER ONCE. REPLAY WITH CONFIDENCE.</div>
            <h1>From intent to capability.</h1>
            <p>
              Teach a workflow through the interface. Inspect what was learned. Run it again without
              a model.
            </p>
          </div>
          <LaunchPanel
            goal={goal}
            setGoal={setGoal}
            memberId={memberId}
            setMemberId={setMemberId}
            target={target}
            setTarget={setTarget}
            scenario={scenario}
            setScenario={setScenario}
            variant={variant}
            setVariant={setVariant}
            busy={busy}
            ready={ready}
            capability={capability}
            start={start}
          />
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <div className="inspector-heading">
            <div>
              <span className="section-number">02</span>
              <h2>Inspect the execution</h2>
            </div>
            {selected && <Badge className={selected.status}>{statusLabel(selected.status)}</Badge>}
          </div>
          <div className="inspector">
            <InspectorPanel
              tab={tab}
              setTab={setTab}
              selected={selected}
              busy={busy}
              control={control}
              actionEvents={actionEvents}
              events={events}
              recordedCapability={recordedCapability}
            />
            <RunContext
              selected={selected}
              actionCount={actionEvents.length}
              busy={busy}
              control={control}
            />
          </div>
          <footer className="page-footer">
            <span>Computer Use Runtime</span>
            <span>Inspect the evidence. Reproduce the result.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
