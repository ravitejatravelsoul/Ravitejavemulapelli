"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Recognition = { continuous:boolean; interimResults:boolean; lang:string; onresult:((event:{results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null; onerror:((event:{error:string})=>void)|null; onend:(()=>void)|null; start():void; stop():void; abort():void };
function recognitionConstructor() {
  const w=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
  return w.SpeechRecognition??w.webkitSpeechRecognition;
}
export function usePushToTalk(onTranscript:(text:string)=>void, cancelSpeech:()=>void) {
  const active=useRef<Recognition|null>(null), transcript=useRef("");
  const callback=useRef(onTranscript);useEffect(()=>{callback.current=onTranscript;},[onTranscript]);
  const [status,setStatus]=useState<"idle"|"listening"|"transcribing">("idle");
  const [error,setError]=useState("");const [heard,setHeard]=useState("");
  const cancel=useCallback(()=>{const r=active.current;active.current=null;if(r){r.onend=null;r.onresult=null;r.onerror=null;r.abort();}setStatus("idle");},[]);
  useEffect(()=>{const hide=()=>{if(document.hidden)cancel();};document.addEventListener("visibilitychange",hide);return()=>{document.removeEventListener("visibilitychange",hide);const r=active.current;if(r){r.onend=null;r.onresult=null;r.onerror=null;r.abort();}};},[cancel]);
  const start=useCallback(()=>{
    if(active.current)return;
    const Constructor=recognitionConstructor();
    if(!Constructor){setError("Speech recognition is unavailable in this browser. Type your question below.");return;}
    cancelSpeech();setError("");setHeard("");transcript.current="";
    const r=new Constructor();active.current=r;r.continuous=false;r.interimResults=true;r.lang="en-US";
    r.onresult=e=>{let all="";for(let i=0;i<e.results.length;i++)all+=e.results[i][0].transcript;transcript.current=all;setHeard(all);};
    r.onerror=e=>{transcript.current="";setError(e.error==="not-allowed"?"Microphone permission denied. You can still type.":"Speech recognition could not finish. Please type or try again.");};
    r.onend=()=>{if(active.current!==r)return;active.current=null;setStatus("idle");const text=transcript.current.trim();if(text)callback.current(text);};
    try{r.start();setStatus("listening");}catch{active.current=null;setStatus("idle");setError("Microphone unavailable. Please type your question.");}
  },[cancelSpeech]);
  const stop=useCallback(()=>{if(active.current){setStatus("transcribing");active.current.stop();}},[]);
  useEffect(()=>{if(status==="idle")return;const timer=setTimeout(cancel,30000);return()=>clearTimeout(timer);},[status,cancel]);
  return {start,stop,cancel,status,error,heard};
}
