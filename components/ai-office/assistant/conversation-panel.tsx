"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { sendConversationAction, clearConversationAction, confirmConversationAction } from "@/app/office/actions/conversation";
import type { ConversationReply } from "@/lib/ai-office/conversation/types";
import type { useOfficeSpeech } from "../headquarters/use-office-speech";
import { usePushToTalk } from "./use-push-to-talk";
import styles from "./conversation.module.css";

const ASSIGN_PROJECT_DRAFT = "Create a new project to build ";
const ASSIGN_PROJECT_PLACEHOLDER =
  'Describe what to build, e.g. "Create a new project to build a Task Tracker with add, complete, delete and localStorage persistence."';

export function ConversationPanel({roleId,projectId,speech,onProject,onNavigate}:{roleId:string;projectId:string|null;speech:ReturnType<typeof useOfficeSpeech>;onProject?:(id:string)=>void;onNavigate?:(role:string)=>void}) {
  const [text,setText]=useState(""),[turns,setTurns]=useState<Array<{role:string;text:string}>>([]),[reply,setReply]=useState<ConversationReply|null>(null),[error,setError]=useState("");
  const [created,setCreated]=useState<{projectId:string;title:string;mode:"local"|"remote";routingMode?:"STANDARD"|"FREE_MULTI_MODEL"}|null>(null);
  const [busy,startTransition]=useTransition();const id=useRef<string|undefined>(undefined),memory=useRef<string|undefined>(undefined),epoch=useRef(0),inFlight=useRef(false);
  const textareaRef=useRef<HTMLTextAreaElement>(null);
  const {speak,stop}=speech;
  useEffect(()=>()=>{epoch.current++;stop();},[stop]);
  const send=useCallback((message:string)=>{
    if(inFlight.current || !message.trim())return;
    inFlight.current=true;stop();setError("");setText(message);const generation=epoch.current;
    setTurns(t=>[...t.slice(-11),{role:"Boss",text:message}]);
    startTransition(async()=>{try{
      const result=await sendConversationAction({text:message,roleId,projectId,conversationId:id.current,memoryToken:memory.current});
      if(generation!==epoch.current)return;
      if(result.error || !result.reply){setError(result.error??"Conversation unavailable.");return;}
      const answer=result.reply;id.current=answer.conversationId;memory.current=answer.memoryToken;setReply(answer);setCreated(null);setText("");
      setTurns(t=>[...t.slice(-11),{role:roleId,text:answer.message}]);
      speak({role:roleId,text:answer.message,revision:answer.revision,priority:2});
    }catch{setError("Network error. Your Office state is safe; try again.");}finally{inFlight.current=false;}});
  },[roleId,projectId,speak,stop]);
  const mic=usePushToTalk(send,stop);
  const reset=()=>{mic.cancel();stop();epoch.current++;const old=id.current;id.current=undefined;setTurns([]);setReply(null);setCreated(null);setError("");if(old)startTransition(async()=>{await clearConversationAction({roleId,projectId,conversationId:old});});};
  const isOrchestrator=roleId==="orchestrator";
  const pendingAction=reply?.pending?.action;
  return <section className={styles.conversation} aria-label="Agent conversation" data-testid="conversation-panel" onKeyDown={e=>{if(e.key.toLowerCase()==="t" && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)){e.preventDefault();if(!busy)mic.start();}}} onKeyUp={e=>{if(e.key.toLowerCase()==="t")mic.stop();}}>
    <header><strong>Talk with {roleId.replaceAll("-"," ")}</strong><button disabled={busy} onClick={reset}>New / Clear Conversation</button><button data-testid="assign-new-project-button" disabled={busy} onClick={()=>{setCreated(null);setText(ASSIGN_PROJECT_DRAFT);textareaRef.current?.focus();}}>Assign New Project</button></header>
    {isOrchestrator && !reply && !turns.length && (
      <p className={styles.hint}>This is where you assign new work to your AI Office. Type or speak your idea below — for example: “Create a new project to build a Task Tracker with add, complete, delete and localStorage persistence.”</p>
    )}
    <div role="log" aria-live="polite" className={styles.turns}>{turns.map((t,i)=><p key={i}><b>{t.role === "Boss"?"You":t.role.replaceAll("-"," ")}</b><br/>{t.text}</p>)}</div>
    <p role="status">{mic.status!=="idle"?mic.status.toUpperCase():busy?"UNDERSTANDING · Agent thinking…":speech.view.status==="speaking"?"SPEAKING":"Ready to talk"}</p>
    {mic.heard && <p data-testid="recognized-transcript">Transcript: {mic.heard}</p>}
    {(error||mic.error) && <p role="alert">{error||mic.error}</p>}
    {reply && <small>{reply.source==="model"?`${reply.provider} / ${reply.model}`:reply.source==="state"?"Persisted Office state · no model":"No qualified response"} · context {reply.revision.slice(0,10)}</small>}
    {reply?.pending && (
      <div className={styles.confirm} data-testid="confirm-summary">
        <p>{pendingAction?.kind==="CREATE_PROJECT"?"Review before starting this project:":"Confirm this action:"}</p>
        <ul>{reply.pending.label.split(" · ").map((line,i)=><li key={i}>{line}</li>)}</ul>
        <button data-testid="confirm-action-button" disabled={busy} onClick={()=>{stop();const action=pendingAction;const token=reply.pending!.token;startTransition(async()=>{const result=await confirmConversationAction({roleId,projectId,conversationId:id.current,token,memoryToken:memory.current});setReply(r=>r?{...r,pending:undefined}:r);if(result.error)setError(result.error);else if(action?.kind==="CREATE_PROJECT" && "projectId" in result && result.projectId){setCreated({projectId:result.projectId,title:action.title,mode:action.mode,routingMode:result.routingMode});setTurns(t=>[...t,{role:roleId,text:`"${action.title}" is starting. Refreshing authoritative Office state.`}]);onProject?.(result.projectId);}else{setTurns(t=>[...t,{role:roleId,text:"Action completed. Refreshing authoritative Office state."}]);if("projectId" in result && result.projectId)onProject?.(result.projectId);}});}}>Confirm action</button>
        <button data-testid="cancel-action-button" onClick={reset}>Cancel</button>
      </div>
    )}
    {created && (
      <div className={styles.created} data-testid="project-created-card">
        <p><b>{created.title}</b></p>
        <p>Project accepted. {created.mode==="remote"?"Dispatching the remote workforce…":"Starting."} · Execution mode: {created.mode==="remote"?"Remote (GitHub Actions)":"Local (background runner)"}{created.routingMode?` · Routing: ${created.routingMode}`:""}</p>
        <a data-testid="view-project-link" href={`/office/projects/${created.projectId}`}>View Project</a>
      </div>
    )}
    {reply?.navigation?.href && <a href={reply.navigation.href}>Open requested view</a>}
    {reply?.navigation?.roleId && <button onClick={()=>onNavigate?.(reply.navigation!.roleId!)}>Open agent station</button>}
    <form onSubmit={e=>{e.preventDefault();send(text);}}><label>Your question<textarea ref={textareaRef} value={text} maxLength={4000} onChange={e=>setText(e.target.value)} placeholder={isOrchestrator?ASSIGN_PROJECT_PLACEHOLDER:"Ask about this project, or create a new one…"}/></label><button disabled={busy||!text.trim()}>Send</button><button type="button" disabled={busy} onClick={()=>mic.status==="listening"?mic.stop():mic.start()}>{mic.status==="listening"?"Finish speaking":"Microphone"}</button></form>
    <small>Push to talk: click Microphone, or hold T while this panel is focused. Your browser may send audio to its speech service. Typed input is always available.</small>
  </section>;
}

