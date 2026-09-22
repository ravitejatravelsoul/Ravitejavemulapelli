"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { HeadquartersState } from "@/lib/ai-office/headquarters/world-state";
import {
  agentBriefing,
  greeting,
} from "@/lib/ai-office/headquarters/presentation";
import { ActionButton } from "../action-button";
import {
  approveApprovalAction,
  rejectApprovalAction,
} from "@/app/office/actions/approvals";
import {
  openOfficeAction,
  closeOfficeAction,
} from "@/app/office/actions/office";
import {
  pauseProjectAction,
  resumeProjectAction,
} from "@/app/office/actions/projects";
import { NewProjectForm } from "../dashboard/new-project-form";
import styles from "./headquarters-panel.module.css";
const money = (n: number | null) =>
  n === null ? "Not recorded" : "$" + n.toFixed(4);
export function HeadquartersPanel({
  id,
  state,
  close,
  refresh,
  selectProject,
  stale,
  asOf,
}: {
  id: string;
  state: HeadquartersState;
  close: () => void;
  refresh: () => void;
  selectProject: (id: string) => void;
  stale: boolean;
  asOf: number;
}) {
  const root = useRef<HTMLElement>(null),
    [asked, setAsked] = useState(false),
    [newProject, setNewProject] = useState(false),
    [filter, setFilter] = useState("");
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [id]);
  const agent = state.agents.find((a) => a.roleId === id),
    project = state.project,
    pid = project?.id,
    base = pid
      ? "/office/projects/" + encodeURIComponent(pid)
      : "/office/projects";
  const action = (fn: () => Promise<{ error?: string }>) => async () => {
    const result = await fn();
    refresh();
    return result;
  };
  const title =
    agent?.name ??
    {
      "terminal:command": "Orchestrator Command Core",
      "terminal:owner": "Owner Command",
      "terminal:models": "AI Model Lab",
      "terminal:delivery": "Delivery Vault",
      "office-engineer": "Office Engineer",
    }[id] ??
    "Headquarters";
  return (
    <section
      ref={root}
      className={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = [
          ...root.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a,input,select,textarea",
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <button onClick={close}>Close & resume</button>
      <p className={styles.status}>
        TEJA / OWNER · {stale ? "STALE SNAPSHOT" : "PERSISTED OFFICE STATE"}
      </p>
      <h2>{title}</h2>
      {agent && (
        <>
          <p
            className={styles.briefing}
            data-testid="agent-briefing"
            data-revision={state.revision}
            data-role={agent.roleId}
          >
            {agentBriefing(agent, state, new Date(asOf).getHours())}
          </p>
          <button
            onClick={() => {
              setAsked(true);
              refresh();
            }}
          >
            Ask for Update
          </button>
          {asked && (
            <small role="status">
              Refreshing the authoritative state. No model call.
            </small>
          )}
          <dl>
            <dt>Role / status</dt>
            <dd>
              {agent.name} / {agent.status}
            </dd>
            <dt>Project</dt>
            <dd>{project?.title ?? "None selected"}</dd>
            <dt>Current task</dt>
            <dd>{agent.task ?? "No active task"}</dd>
            <dt>Provider / model</dt>
            <dd>
              {agent.provider ?? "Not assigned"} /{" "}
              {agent.model ?? "Not recorded"}
            </dd>
            <dt>Attempt</dt>
            <dd>
              {agent.attempt} / {agent.maxAttempts ?? "—"}
            </dd>
            <dt>Blocker</dt>
            <dd>
              {agent.blocker ??
                (agent.waitingOn.join(", ") || "No recorded blocker")}
            </dd>
            <dt>Recorded usage</dt>
            <dd>
              {agent.tokens} tokens · {money(agent.costUsd)}
            </dd>
          </dl>
          <Link
            href={
              "/office?" +
              new URLSearchParams({
                ...(pid ? { project: pid } : {}),
                agent: agent.roleId,
              })
            }
          >
            Open Workspace
          </Link>
          {pid && (
            <>
              <Link href={base + "?tab=overview"}>View Task</Link>
              <Link href={base + "?tab=activity"}>View History</Link>
            </>
          )}
          <h3>Recent recorded runs</h3>
          {agent.runs.length ? (
            agent.runs.map((r) => (
              <article key={r.id}>
                Attempt {r.attempt} · {r.status}
                <br />
                {r.provider} / {r.model ?? "No model recorded"}
              </article>
            ))
          ) : (
            <p>No recorded runs.</p>
          )}
        </>
      )}
      {(id === "terminal:command" || id === "orchestrator") && (
        <>
          <h3>Project command</h3>
          <label>
            Selected project
            <select
              aria-label="Selected project"
              value={pid ?? ""}
              onChange={(e) => selectProject(e.target.value)}
            >
              <option value="" disabled>
                Select a project
              </option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.status}
                </option>
              ))}
            </select>
          </label>
          {project && (
            <>
              <p>
                {project.label} · {project.completed}/{project.total} tasks
                complete
              </p>
              <progress max={project.total || 1} value={project.completed} />
              <p>
                Cost: {money(project.costUsd)} · Delivery:{" "}
                {project.deliveryState}
              </p>
              <p>
                {
                  state.agents.filter((a) =>
                    [
                      "WORKING",
                      "THINKING",
                      "REVIEWING",
                      "TESTING",
                      "RETRYING",
                    ].includes(a.status),
                  ).length
                }{" "}
                active roles ·{" "}
                {state.approvals.filter((a) => a.projectId === pid).length}{" "}
                pending approvals
              </p>
              <Link href={base}>Open Project</Link>
              {project.status === "PAUSED" ? (
                <ActionButton
                  disabled={stale}
                  action={action(() => resumeProjectAction(project.id))}
                >
                  Resume project
                </ActionButton>
              ) : ["PLANNING", "IN_PROGRESS"].includes(project.status) ? (
                <ActionButton
                  disabled={stale}
                  action={action(() => pauseProjectAction(project.id))}
                >
                  Pause project
                </ActionButton>
              ) : null}
              <h3>Task dependency graph</h3>
              <ol>
                {state.tasks.map((t) => (
                  <li key={t.id}>
                    <b>{t.title}</b> · {t.status}
                    <br />
                    <small>
                      {t.roleId} · depends on{" "}
                      {t.dependsOn
                        .map(
                          (id) =>
                            state.tasks.find((d) => d.id === id)?.title ?? id,
                        )
                        .join(", ") || "project start"}
                    </small>
                  </li>
                ))}
              </ol>
            </>
          )}
          <button onClick={() => setNewProject((p) => !p)}>
            Start New Project
          </button>
          {newProject && (
            <NewProjectForm remoteMode={state.mode === "remote"} />
          )}
          <h3>Company roster</h3>
          {state.agents.map((a) => (
            <p key={a.roleId}>
              {a.name} · {a.status}{" "}
              {a.provider
                ? "· " + a.provider + " / " + (a.model ?? "not recorded")
                : ""}
            </p>
          ))}
          <h3>Recent evidence</h3>
          {state.transitions
            .slice(-8)
            .reverse()
            .map((e) => (
              <p key={e.id}>{e.label}</p>
            ))}
          {state.events.slice(0, 8).map((e) => (
            <p key={e.id}>
              {e.message} {e.roleId ? "· " + e.roleId : ""}
            </p>
          ))}
        </>
      )}
      {id === "terminal:owner" && (
        <>
          <p>
            {greeting(new Date(asOf).getHours())} Office is {state.office.state}
            . {state.office.activeProjects} projects are active.
          </p>
          <ActionButton
            disabled={stale}
            action={action(
              state.office.state === "OPEN"
                ? closeOfficeAction
                : openOfficeAction,
            )}
          >
            {state.office.state === "OPEN" ? "Close Office" : "Open Office"}
          </ActionButton>
          <h3>Budget</h3>
          <dl>
            <dt>Monthly cap</dt>
            <dd>{money(state.budget.capUsd)}</dd>
            <dt>Recorded spend</dt>
            <dd>{money(state.budget.spendUsd)}</dd>
            <dt>Remaining</dt>
            <dd>{money(state.budget.remainingUsd)}</dd>
            <dt>Reserved</dt>
            <dd>{money(state.budget.reservedUsd)}</dd>
            <dt>Warning</dt>
            <dd>
              {state.budget.warnAtPercent}% · {state.budget.status}
            </dd>
          </dl>
          <h3>Owner decisions ({state.approvals.length})</h3>
          {!state.approvals.length && <p>No pending approvals.</p>}
          {state.approvals.map((a) => (
            <article key={a.id}>
              <b>
                {a.kind} · {a.projectTitle}
              </b>
              <p>{a.reason || "Inspect this request in Classic Office."}</p>
              <p>
                {a.taskTitle} · Requested by {a.requestedBy}
              </p>
              <p>
                Scope: {a.scopeLabel} · Estimated: {money(a.estimatedCostUsd)}
              </p>
              <p>{a.escalationStatus}</p>
              <ActionButton
                disabled={stale}
                action={action(() => approveApprovalAction(a.id, a.projectId))}
                confirmMessage="Approve this exact recorded request?"
              >
                Approve
              </ActionButton>
              <ActionButton
                disabled={stale}
                action={action(() => rejectApprovalAction(a.id, a.projectId))}
                confirmMessage="Reject this recorded request?"
              >
                Reject
              </ActionButton>
            </article>
          ))}
          <h3>Projects</h3>
          {state.projects.map((p) => (
            <p key={p.id}>
              <Link href={"/office/projects/" + p.id}>
                {p.title} · {p.status}
              </Link>
            </p>
          ))}
          <h3>System</h3>
          <p>
            {state.office.health} · {state.office.runner} ·{" "}
            {state.incidents.filter((i) => i.status !== "RESOLVED").length} open
            incidents
          </p>
          <p>
            {state.models.length} registered models · {state.deliveryCount}{" "}
            verified deliveries
          </p>
          <Link href="/office/engineer">Open incident history</Link>
          <Link href="/office/local-models">Model Control Center</Link>
        </>
      )}
      {id === "office-engineer" && (
        <>
          <p>
            {greeting(new Date(asOf).getHours())} Recorded infrastructure
            status: {state.office.health}.
          </p>
          <p>Runner: {state.office.runner}</p>
          {state.mode === "remote" && (
            <p>Remote snapshot; this view does not probe or repair workers.</p>
          )}
          <Link href="/office/engineer">Open Infrastructure Workspace</Link>
          {state.incidents.length ? (
            state.incidents.map((i) => (
              <article key={i.id}>
                <b>
                  {i.status === "ESCALATED"
                    ? "OWNER ASSISTANCE REQUIRED"
                    : i.status === "RESOLVED"
                      ? "SYSTEM RESTORED"
                      : i.status}
                </b>
                <p>{i.symptom}</p>
              </article>
            ))
          ) : (
            <p>No recorded incidents. No repair is running.</p>
          )}
        </>
      )}
      {id === "terminal:models" && (
        <>
          <Link href="/office/local-models">Open Model Control Center</Link>
          <p>
            Recorded registry and routing telemetry. Opening this panel never
            probes a model.
          </p>
          {!state.models.length && (
            <p>No model registry is present in this snapshot.</p>
          )}
          {state.models.map((m) => (
            <article key={m.id}>
              <b>
                {m.provider} / {m.model}
              </b>
              <p>
                {m.eligibility ?? "No verified free eligibility"} ·{" "}
                {m.enabled ? "Enabled" : "Disabled"} · {m.health}
              </p>
              <p>{m.capabilities.join(" · ")}</p>
              <small>
                {m.succeeded} succeeded / {m.failed} failed ·{" "}
                {m.qualified ? "Qualified" : "Not qualified"} ·{" "}
                {m.coolingDown ? "Cooling down" : "No recorded cooldown"}
              </small>
            </article>
          ))}
          <h3>Recent routing</h3>
          {state.routing.map((r) => (
            <p key={r.id}>
              {r.roleId}: {r.provider} / {r.model} · {r.result} · {r.attempts}{" "}
              route attempts · {money(r.costUsd)}
              {!!r.fallbacks.length && (
                <small>
                  {" "}
                  · Recorded fallback routes:{" "}
                  {r.fallbacks
                    .map((f) => f.provider + " / " + f.model)
                    .join(" → ")}
                </small>
              )}
            </p>
          ))}
        </>
      )}
      {id === "terminal:delivery" && (
        <>
          <p>
            {state.deliveryCount} verified deliveries. Showing the latest{" "}
            {state.deliveries.length}; three cores are displayed physically.
          </p>
          <label>
            Find a delivery
            <input
              aria-label="Find a delivery"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          {state.deliveries
            .filter((d) => d.title.toLowerCase().includes(filter.toLowerCase()))
            .map((d) => (
              <article key={d.id}>
                <b>{d.title} · VERIFIED</b>
                <p>
                  {new Date(d.completedAt).toLocaleString()} · {d.agents} agents
                  · {money(d.costUsd)}
                </p>
                <p>Models: {d.models.join(", ") || "Not recorded"}</p>
                <Link href={"/office/projects/" + d.id}>Open Project</Link>
                <Link href={"/office/projects/" + d.id + "?tab=workspace"}>
                  Open Workspace
                </Link>
                <Link href={"/office/projects/" + d.id + "?tab=technical"}>
                  View Test Results
                </Link>
              </article>
            ))}
          {!state.deliveries.length && (
            <p>
              No verified delivery. Failed, blocked and unverified projects are
              excluded.
            </p>
          )}
          <Link href="/office/projects">Full project archive</Link>
        </>
      )}
      <hr />
      <Link href="/office">Classic Office</Link>
    </section>
  );
}
