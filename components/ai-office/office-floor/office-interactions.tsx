'use client';
import Link from 'next/link';
import { useAgentSelection } from './use-agent-selection';
import { useEffect,useRef } from 'react';
import type { OfficeInteractionView,OfficeTransition } from '@/lib/ai-office/dashboard/office-transitions';
import { WORKSTATIONS } from '@/lib/ai-office/office-scene-layout';
import styles from './office-interactions.module.css';
export const DESTINATIONS:Record<string,[number,number]>={owner:[840,70],engineer:[1280,86],delivery:[840,862]};
export function stationPoint(role:string):[number,number]|undefined {const g=WORKSTATIONS[role];return g?[g.head.cx,g.head.cy+50]:DESTINATIONS[role];}
export function OfficePacket({transition}:{transition:OfficeTransition|null}) {
 const motion=useRef<SVGGElement>(null);
 const fromPoint=transition?stationPoint(transition.fromRole):undefined,toPoint=transition?stationPoint(transition.toRole):undefined;
 const fx=fromPoint?.[0]??0,fy=fromPoint?.[1]??0,tx=toPoint?.[0]??0,ty=toPoint?.[1]??0;
 useEffect(()=>{
  if(!transition || !motion.current || matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const cx=(fx+tx)/2,cy=Math.min(fy,ty)-50;
  const frames=Array.from({length:21},(_,i)=>{const t=i/20,u=1-t;return {transform:`translate(${u*u*fx+2*u*t*cx+t*t*tx}px,${u*u*fy+2*u*t*cy+t*t*ty}px)`};});
  const animation=motion.current.animate(frames,{duration:2800,fill:'forwards',easing:'linear'});
  return()=>animation.cancel();
 },[transition,fx,fy,tx,ty]);
 if(!transition)return null;
 const from=stationPoint(transition.fromRole),to=stationPoint(transition.toRole);if(!from||!to)return null;
 const path=`M ${from[0]},${from[1]} Q ${(from[0]+to[0])/2},${Math.min(from[1],to[1])-50} ${to[0]},${to[1]}`;
 return <div className={styles.packetLayer} data-testid="office-packet" data-transition={transition.id} data-kind={transition.type}>
  <svg viewBox="0 0 1672 941" aria-hidden="true"><path d={path} className={styles.trail}/></svg>
  <svg className={styles.movingPacket} viewBox="0 0 1672 941" aria-hidden="true"><g ref={motion} key={transition.id}><rect x="-6" y="-8" width="12" height="16" rx="3" className={styles.packet} /></g></svg>
  <p className={styles.caption} role="status">{transition.label.replaceAll('-', ' ')}</p>
 </div>;
}
export function OfficeDestinations({view}:{view:OfficeInteractionView}) {
 return <div className={styles.destinations} aria-label="Office operations">
  <a href="#owner-decisions" data-testid="owner-console"><span>TEJA / OWNER CONSOLE</span><strong>{view.approvals?`${view.approvals} decision${view.approvals===1?'':'s'} required`:'No decision required'}</strong></a>
  <Link href="/office/engineer" data-testid="engineer-console"><span>INFRASTRUCTURE / ENGINEER</span><strong>{view.engineer==='HEALTHY'?'System healthy':`${view.engineerDetail??'Incident'} · ${view.engineer.toLowerCase()}`}</strong></Link>
  <Link href={`/office/projects/${view.projectId}?tab=workspace`} data-testid="delivery-console"><span>DELIVERY TERMINAL</span><strong>{view.verifiedDelivery?'Verified · Open project':view.deliveryState.replaceAll('_',' ').toLowerCase()}</strong></Link>
 </div>;
}
export function OfficeTransitionFeed({view}:{view:OfficeInteractionView}) {
 const {selectRole}=useAgentSelection();
 return <details className={styles.feed}><summary>Recorded handoffs & events <span>{view.transitions.length}</span></summary>
  <ol>{view.transitions.slice(-8).reverse().map(t=><li key={t.id}><time>{new Date(t.occurredAt).toISOString().slice(11,19)} UTC</time><span>{t.label.replaceAll('-',' ')}</span></li>)}</ol>
  <ol>{view.feed.map(e=><li key={e.id}><time>{new Date(e.occurredAt).toISOString().slice(11,19)} UTC</time>{e.roleId?<button onClick={()=>selectRole(e.roleId!)}>{e.message}</button>:<span>{e.message}</span>}</li>)}</ol>
  {!view.transitions.length&&<p>No recorded movement for this project.</p>}
 </details>;
}

export function OfficeSceneTerminals({view}:{view:OfficeInteractionView}) {
 return <div className={styles.terminals}>{Object.entries(DESTINATIONS).map(([id,point])=><a key={id} data-terminal={id} href={id==='owner'?'#owner-decisions':id==='engineer'?'/office/engineer':`/office/projects/${view.projectId}?tab=workspace`} style={{left:point[0]/16.72+'%',top:point[1]/9.41+'%'}}>{id==='owner'?'TEJA / OWNER':id==='engineer'?'SYSTEMS':'DELIVERY'}</a>)}</div>;
}
