'use client';
import { useEffect,useState,useRef } from 'react';
import Link from 'next/link';
import type { OfficeInteractionView } from '@/lib/ai-office/dashboard/office-transitions';
import { layoutOfficeDag,eligibleOfficeMoment } from '@/lib/ai-office/dashboard/office-cinematic';
import { WORKSTATIONS } from '@/lib/ai-office/office-scene-layout';
import { VISUAL_LABEL } from '@/lib/ai-office/dashboard/office-visual-state';
import { useAgentSelection } from './use-agent-selection';
import styles from './office-cinematic.module.css';
export function OfficeMoment({view,enabled}:{view:OfficeInteractionView;enabled:boolean}) {
 const [moment,setMoment]=useState<{projectId:string;type:'START'|'DELIVERY'}|null>(null);
 const input=useRef({view,enabled});
 useEffect(()=>{input.current={view,enabled};},[view,enabled]);
 useEffect(()=>{
  let until=0,active=false;
  const tick=()=>{
   const {view:current,enabled:motionOn}=input.current,now=Date.now();
   if(active && (now>=until || !motionOn || document.visibilityState!=='visible')){active=false;setMoment(null);}
   const candidate=eligibleOfficeMoment(current,now);if(!candidate)return;
   const key=`office-moment:${current.projectId}:${candidate.type}`;
   try{if(sessionStorage.getItem(key)===candidate.id)return;sessionStorage.setItem(key,candidate.id);}catch{return;}
   if(!motionOn||document.visibilityState!=='visible')return;
   until=now+3200;active=true;setMoment({projectId:current.projectId,type:candidate.type});
  };
  const first=setTimeout(tick,0),timer=setInterval(tick,500);
  document.addEventListener('visibilitychange',tick);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[view.projectId]);
 if(!moment||moment.projectId!==view.projectId||!enabled)return null;
 const kind=moment.type;
 return <div className={styles.moment} data-testid="office-moment" data-moment={kind} role="status">
  <small>{kind==='START'?'PROJECT PLAN RECEIVED':'VERIFIED DELIVERY · READY FOR REVIEW'}</small>
  <strong>{view.title}</strong>
  <span>{kind==='START'?`${new Set(view.nodes.map(n=>n.roleId)).size} agents assigned`:`${view.nodes.length}/${view.nodes.length} tasks complete · ${view.modelsUsed} recorded models · $${view.costUsd.toFixed(2)}`}</span>
  {kind==='DELIVERY'&&<Link href={`/office/projects/${view.projectId}`}>Open project →</Link>}
 </div>;
}
export function OfficeCommandTable({view}:{view:OfficeInteractionView}) {
 const {selectedRoleId,selectRole,clearSelection}=useAgentSelection();
 const [open,setOpen]=useState(false);
 const show=open||selectedRoleId==='orchestrator';
 const layout=layoutOfficeDag(view.nodes);
 const completed=view.nodes.filter(n=>n.state==='DONE').length;
 const active=view.nodes.filter(n=>['WORKING','THINKING','TESTING','REVIEWING','RETRYING'].includes(n.state));
 const next=view.nodes.filter(n=>n.state==='QUEUED');
 const blocked=view.nodes.filter(n=>['BLOCKED','FAILED'].includes(n.state));
 return <section className={styles.command} data-testid="command-table">
  <button className={styles.toggle} aria-expanded={show} onClick={()=>{if(selectedRoleId==='orchestrator')clearSelection();setOpen(!show);}}><span>ORCHESTRATOR / COMMAND TABLE</span><span>{show?'Collapse map −':'Explore project map +'}</span></button>
  {show&&<div className={styles.content}>
   <div className={styles.heading}><div><small>ACTUAL PROJECT DAG</small><h2>{view.title}</h2></div><strong>{view.nodes.length?Math.round(completed/view.nodes.length*100):0}%<small>{completed} / {view.nodes.length} complete</small></strong></div>
   <div className={styles.telemetry}><span>Running <b>{active.length}</b></span><span>Next <b>{next.length}</b></span><span>Blocked <b>{blocked.length}</b></span><a href="#owner-decisions">Needs Teja <b>{view.approvals}</b></a><span>Recorded cost <b>${view.costUsd.toFixed(2)}</b></span><span>Delivery <b>{view.verifiedDelivery?'VERIFIED':view.deliveryState.replaceAll('_',' ')}</b></span></div>
   <p className={styles.models}>Models in use: {view.activeModels.map(m=>`${WORKSTATIONS[m.roleId]?.shortName??m.roleId} · ${m.provider} / ${m.model??"Model not recorded"}`).join("; ")||"None recorded for active tasks"}</p>
   {view.nodes.length===0&&<p>No task graph has been recorded yet.</p>}
   {layout.invalid&&<p>Dependency cycle detected. Inspect the project before proceeding.</p>}
   <div className={styles.graphScroll} tabIndex={0} role="region" aria-label="Scrollable project dependency map">
    <div className={styles.graph} style={{width:layout.width,height:layout.height}}>
     <svg width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id="command-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#619cb9"/></marker></defs>{view.nodes.flatMap(n=>n.dependsOn.map(d=>{const a=layout.positions[d],b=layout.positions[n.id];return a&&b?<path key={d+n.id} d={`M${a.x+164},${a.y+30} C${a.x+185},${a.y+30} ${b.x-20},${b.y+30} ${b.x},${b.y+30}`} fill="none" stroke="#619cb9" strokeWidth="1.5" markerEnd="url(#command-arrow)"/>:null;}))}</svg>
     {view.nodes.map(n=><button key={n.id} className={styles.node} data-dag-task={n.id} data-state={n.state} style={{left:layout.positions[n.id].x,top:layout.positions[n.id].y}} onClick={()=>selectRole(n.roleId)} aria-label={`${WORKSTATIONS[n.roleId]?.shortName??n.roleId} — ${VISUAL_LABEL[n.state]} — ${n.title}`}><strong>{WORKSTATIONS[n.roleId]?.shortName??n.roleId}</strong><span>{VISUAL_LABEL[n.state]}</span><small title={n.title}>{n.title}</small></button>)}
    </div>
   </div>
   <div className={styles.next}><p><b>Running:</b> {active.map(n=>WORKSTATIONS[n.roleId]?.shortName??n.roleId).join(', ')||'None'}</p><p><b>Next eligible:</b> {next.map(n=>WORKSTATIONS[n.roleId]?.shortName??n.roleId).join(', ')||'None'}</p><p><b>Blocked:</b> {blocked.map(n=>WORKSTATIONS[n.roleId]?.shortName??n.roleId).join(', ')||'None'}</p></div>
  </div>}
 </section>;
}
