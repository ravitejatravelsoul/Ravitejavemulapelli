"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { ConversationPanel } from "./conversation-panel";
import { useOfficeSpeech } from "../headquarters/use-office-speech";
import { conversationOptionsAction } from "@/app/office/actions/conversation";

function Chat({assistantName,onClose}:{assistantName:string;onClose:()=>void}) {
  const speech=useOfficeSpeech();
  const [role,setRole]=useState("orchestrator");
  const path=usePathname();
  const [projectId,setProjectId]=useState<string|null>(()=>/\/office\/projects\/([^/]+)/.exec(path)?.[1]??null);
  const [projects,setProjects]=useState<Array<{id:string;title:string}>>([]);
  useEffect(()=>{let live=true;conversationOptionsAction().then(r=>{if(live)setProjects(r.projects);}).catch(()=>{});return()=>{live=false;};},[]);
  return <div role="dialog" aria-label={`${assistantName} — AI Office Chief of Staff`} className="fixed right-5 bottom-5 z-50 max-h-[90vh] w-[min(92vw,32rem)] overflow-auto rounded-2xl border bg-background p-4 shadow-2xl">
    <button onClick={()=>{speech.stop();onClose();}}>Close assistant</button>
    <button onClick={speech.toggle}>VOICE: {speech.enabled?"ON":"OFF"}</button>
    <button onClick={speech.stop}>Stop Speaking</button>
    <label>Project<select value={projectId??""} onChange={e=>{speech.stop();setProjectId(e.target.value||null);}}><option value="">Office overview</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    <label>Agent<select value={role} onChange={e=>{speech.stop();setRole(e.target.value);}}>{["orchestrator","product-owner","solution-architect","ui-ux-agent","frontend-developer","qa-agent","security-reviewer","code-reviewer","release-agent"].map(r=><option key={r}>{r}</option>)}</select></label>
    <ConversationPanel key={`${role}:${projectId}`} roleId={role} projectId={projectId} speech={speech} onProject={setProjectId} onNavigate={setRole}/>
  </div>;
}
export function TejaAssistant({assistantName}:{assistantName:string}) {
  const [open,setOpen]=useState(false);const path=usePathname();
  if(path==="/office" || path==="/office/headquarters")return null;
  return open?<Chat key={path} assistantName={assistantName} onClose={()=>setOpen(false)}/>:<button className="fixed right-6 bottom-6 z-40 rounded-full border bg-background px-5 py-3 shadow-lg" aria-label={`Open ${assistantName} assistant`} onClick={()=>setOpen(true)}>Talk to {assistantName}</button>;
}
