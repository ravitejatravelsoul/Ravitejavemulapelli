'use client';
import { useEffect,useRef,useState } from 'react';
import { advanceQueue,emptyQueue,type OfficeTransition } from '@/lib/ai-office/dashboard/office-transitions';
/** Persistent queue lifetime is scoped to one project. Storage contains IDs/timestamps
 * only; no request, inference, dispatch or runner lifecycle is reachable here. */
export function useOfficeTransitions(projectId:string|undefined,transitions:OfficeTransition[],enabled:boolean) {
 const [current,setCurrent]=useState<OfficeTransition|null>(null);
 const input=useRef({transitions,enabled});
 useEffect(()=>{input.current={transitions,enabled};},[transitions,enabled]);
 useEffect(()=>{
  if(!projectId)return;
  const key=`office-visual-queue:${projectId}`;
  let state=emptyQueue(Date.now()-8000);
  try{const saved=JSON.parse(sessionStorage.getItem(key)??'null');if(saved&&Number.isFinite(saved.watermark)&&Array.isArray(saved.seen))state=emptyQueue(saved.watermark,saved.seen.filter((id:unknown)=>typeof id==='string'));}catch{}
  let displayed:string|null|undefined;
  const tick=()=>{
   const previousWatermark=state.watermark,previousSeen=state.seen.length;
   state=advanceQueue(state,input.current.transitions,Date.now(),input.current.enabled&&document.visibilityState==='visible');
   const next=state.current?.id??null;
   if(next!==displayed){displayed=next;setCurrent(state.current);}
   if(state.watermark!==previousWatermark||state.seen.length!==previousSeen){
    try{sessionStorage.setItem(key,JSON.stringify({watermark:state.watermark,seen:state.seen}));}catch{}
   }
  };
  const first=setTimeout(tick,0),timer=setInterval(tick,500);
  document.addEventListener('visibilitychange',tick);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[projectId]);
 return enabled&&current?.projectId===projectId?current:null;
}
