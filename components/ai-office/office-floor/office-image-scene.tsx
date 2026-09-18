"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Pause, Play, Radio, CircleCheck, CircleAlert, Clock3, RotateCw, ScanLine, Brain, Code2, ListChecks, Coffee } from "lucide-react";
import { useAgentSelection } from "./use-agent-selection";
import { getHotspotPercent } from "@/lib/ai-office/office-hotspots";
import { WORKSTATIONS } from "@/lib/ai-office/office-scene-layout";
import { VISUAL_LABEL, isActiveVisualState, summarizeVisualAgents } from "@/lib/ai-office/dashboard/office-visual-state";
import type { OfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";
import styles from "./office-scene.module.css";
const STATUS_ICON = { IDLE: Coffee, QUEUED: Clock3, THINKING: Brain, WORKING: Code2, TESTING: ListChecks,
  REVIEWING: ScanLine, WAITING: Clock3, BLOCKED: CircleAlert, FAILED: CircleAlert, RETRYING: RotateCw, DONE: CircleCheck, PAUSED: Pause };

/** Renderer only: normalized state drives registered artwork fragments and monitors.
 * No execution, fetching, random activity or browser-owned orchestration. */
export function OfficeImageScene({ floor, officeState = "OPEN", debugEnabled = false }: {
  floor: OfficeFloorView; officeState?: "OPEN" | "CLOSED";
  recentHandoff?: { from: string; to: string } | null; debugEnabled?: boolean;
}) {
  const { selectedRoleId, selectRole } = useAgentSelection();
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const listener = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
  const summary = summarizeVisualAgents(floor.agents);
  const focus = floor.agents.find(a => a.roleId === (hoveredRole ?? selectedRoleId));
  const byRole = new Map(floor.agents.map(a => [a.roleId, a]));
  return <section className={styles.office} data-testid="living-office" data-motion-paused={motionPaused || hidden} aria-label="Living Office — real project state">
    <div className={styles.summary} data-testid="office-summary">
      <div className={styles.summaryTitle}><Radio size={14} aria-hidden="true" /><span>{summary.active ? "LIVE OFFICE" : "OFFICE AT REST"}</span><small>{officeState === "CLOSED" ? "Dispatch closed" : "Live state · read only"}</small></div>
      <div className={styles.counts}><span><b>{summary.active}</b> active</span><span><b>{summary.waiting}</b> waiting</span><span><b>{summary.reviewing}</b> reviewing</span>{summary.blocked > 0 && <span><b>{summary.blocked}</b> blocked / failed</span>}</div>
      <div className={styles.providers}>{Object.entries(summary.providers).map(([provider, count]) => <span key={provider}>{provider} <b>{count}</b></span>)}</div>
      <button className={styles.motionButton} onClick={() => setMotionPaused(v => !v)} aria-pressed={motionPaused} aria-label={motionPaused ? "Resume office motion" : "Pause office motion"}>{motionPaused ? <Play size={13} /> : <Pause size={13} />}<span>Motion</span></button>
    </div>
    <div className={styles.scene} style={{ aspectRatio: "1672 / 941" }}>
      <Image src="/images/ai-office/living-office.webp" alt="The approved isometric AI engineering studio" unoptimized fill priority sizes="(min-width: 1024px) calc(100vw - 300px), 100vw" className={styles.art} />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.layers} aria-hidden="true">
        {Object.entries(WORKSTATIONS).map(([roleId, geo]) => {
          const agent = byRole.get(roleId); if (!agent) return null;
          const points = geo.screen.split(" ").map(point => point.split(",").map(Number));
          const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
          const w = Math.max(...points.map(p => p[0])) - x, h = Math.max(...points.map(p => p[1])) - y;
          const head = geo.head;
          return <div key={roleId} data-state={agent.status} className={styles.stationArt}>
            <div className={styles.monitor} style={{left:x/16.72+"%",top:y/9.41+"%",width:w/16.72+"%",height:h/9.41+"%",clipPath:"polygon("+points.map(p=>(p[0]-x)/w*100+"% "+(p[1]-y)/h*100+"%").join(",")+")"}}>
              {isActiveVisualState(agent.status) && <><span className={styles.scan} /><span className={styles.codeLine} /></>}
            </div>
            <div className={styles.avatar} style={{left:(head.cx-head.rx)/16.72+"%",top:(head.cy-head.ry)/9.41+"%",width:head.rx*2/16.72+"%",height:head.ry*2/9.41+"%",backgroundImage:"url(/images/ai-office/living-office.webp)",backgroundSize:(1672/(head.rx*2)*100)+"% "+(941/(head.ry*2)*100)+"%",backgroundPosition:((head.cx-head.rx)/(1672-head.rx*2)*100)+"% "+((head.cy-head.ry)/(941-head.ry*2)*100)+"%"}} />
            {roleId === "orchestrator" && <div className={styles.commandRing} />}
          </div>;
        })}
      </div>
      {Object.entries(WORKSTATIONS).map(([roleId, geo]) => {
        const agent = byRole.get(roleId); if (!agent) return null;
        const pct = getHotspotPercent(roleId)!;
        const selected = selectedRoleId === roleId;
        const Icon = STATUS_ICON[agent.status] ?? Coffee;
        return <div key={roleId} className={styles.station} data-state={agent.status} data-selected={selected} data-dimmed={!!selectedRoleId && !selected} data-agent={roleId} data-testid={`station-${roleId}`}>
          <button type="button" className={styles.hit} onClick={() => selectRole(roleId)} onMouseEnter={() => setHoveredRole(roleId)} onMouseLeave={() => setHoveredRole(null)} onFocus={() => setHoveredRole(roleId)} onBlur={() => setHoveredRole(null)}
            aria-label={[agent.roleName, VISUAL_LABEL[agent.status], agent.currentTaskTitle, agent.provider, agent.model].filter(Boolean).join(" — ")} aria-pressed={selected}
            style={{ left: `${pct.left}%`, top: `${pct.top}%`, width: `${pct.width}%`, height: `${pct.height}%`, outline: debugEnabled ? "1px dashed lime" : undefined }} />
          <div className={styles.badge} style={{ left: `${geo.label[0]/16.72}%`, top: `${geo.label[1]/9.41}%` }} aria-hidden="true">
            <span className={styles.roleName}>{geo.shortName}</span><span className={styles.stateLabel}><Icon size={11} />{VISUAL_LABEL[agent.status]}</span>
            {isActiveVisualState(agent.status) && agent.provider && <span className={styles.modelLabel}>{agent.provider} · {agent.model ?? "Model unrecorded"}</span>}
          </div>
        </div>;
      })}
      <div className={styles.sceneFooter}><span>TEJA’S AI OFFICE <i>/</i> LIVING STUDIO</span><span>11 workstations · Level 1</span></div>
    </div>
    <div className={styles.inspect} data-testid="office-inspector">
      {focus ? <><strong>{focus.roleName}</strong><span>{VISUAL_LABEL[focus.status]}</span><span className={styles.task}>{focus.currentTaskTitle ?? (focus.lastCompletedTaskTitle ? `Last: ${focus.lastCompletedTaskTitle}` : "Available for the next task")}</span><span>{focus.provider ? `${focus.provider} · ${focus.model ?? "Model not recorded"}` : "No model assigned"}</span>{focus.attemptCount > 0 && <span>Attempt {focus.attemptCount}/{focus.maxAttempts ?? "—"}</span>}</>
        : <><strong>Observe. Select. Inspect.</strong><span>Hover or focus a workstation for task details. Select to open its workspace.</span></>}
    </div>
  </section>;
}
