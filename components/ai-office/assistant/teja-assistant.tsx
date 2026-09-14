"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, X, Send, Mic, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { sendAssistantMessageAction, confirmAssistantActionAction } from "@/app/office/actions/assistant";
import { getAssistantAwarenessAction } from "@/app/office/actions/assistant-awareness";
import type { AssistantAwareness } from "@/lib/ai-office/assistant/assistant-data";
import type { PendingAction } from "@/lib/ai-office/assistant/assistant-service";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

// The Web Speech API isn't part of TypeScript's standard DOM lib — a
// minimal local shape for just the surface this component actually uses
// (Section V's browser-native, no-paid-service voice support).
interface MinimalSpeechRecognitionAlternative {
  transcript: string;
}
interface MinimalSpeechRecognitionEvent {
  results: { [index: number]: MinimalSpeechRecognitionAlternative }[];
}
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
}

const QUICK_COMMANDS = ["Office status", "Needs my attention", "Current projects", "Approvals", "Spend", "Overnight summary"];

/** Feature-detected — Section V: explicit activation only, graceful fallback where the browser doesn't support it, no continuous background listening. */
function getSpeechRecognition(): (new () => MinimalSpeechRecognition) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => MinimalSpeechRecognition; webkitSpeechRecognition?: new () => MinimalSpeechRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function TejaAssistant({ assistantName }: { assistantName: string }) {
  const [open, setOpen] = useState(false);
  const [awareness, setAwareness] = useState<AssistantAwareness | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const speechSupported = typeof window !== "undefined" && !!getSpeechRecognition();

  useEffect(() => {
    if (open && awareness === null) {
      getAssistantAwarenessAction().then(setAwareness);
    }
  }, [open, awareness]);

  // Closes on outside click / Escape without ever rendering a full-viewport
  // backdrop element — a prior version used a `fixed inset-0` backdrop to
  // catch outside clicks, which (correctly, by design) intercepted every
  // click anywhere on the page — including the primary sidebar navigation —
  // for as long as the panel stayed open. Since this assistant is meant to
  // be an ambient, non-modal launcher available across every /office/**
  // page (not a dialog the owner must dismiss before doing anything else),
  // the rest of the page must stay fully interactive while it's open.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const speak = useCallback(
    (text: string) => {
      if (!voiceOutput || typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    },
    [voiceOutput],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInput("");
      setBusy(true);
      try {
        if (pending && /^(confirm|yes|do it|go ahead)\.?$/i.test(trimmed)) {
          const result = await confirmAssistantActionAction(pending);
          setMessages((m) => [...m, { role: "assistant", text: result.message }]);
          speak(result.message);
          setPending(null);
          setAwareness(await getAssistantAwarenessAction());
          return;
        }
        if (pending && /^(cancel|no|never ?mind|stop)\.?$/i.test(trimmed)) {
          setMessages((m) => [...m, { role: "assistant", text: "Cancelled." }]);
          setPending(null);
          return;
        }
        const result = await sendAssistantMessageAction(trimmed);
        setMessages((m) => [...m, { role: "assistant", text: result.message }]);
        speak(result.message);
        setPending(result.pendingAction ?? null);
      } finally {
        setBusy(false);
      }
    },
    [busy, pending, speak],
  );

  const toggleMic = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    if (listening) {
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: MinimalSpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) void send(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
    setListening(true);
  }, [listening, send]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${assistantName} assistant`}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-8px_var(--primary)] transition-transform hover:scale-105"
      >
        <Sparkles className="size-4" aria-hidden="true" />
        {assistantName}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${assistantName} — AI Office Chief of Staff`}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden border border-border/60 bg-background shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[36rem] sm:w-[26rem] sm:rounded-2xl"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div>
              <p className="text-sm font-semibold tracking-tight">{assistantName.toUpperCase()}</p>
              <p className="text-[0.65rem] text-muted-foreground uppercase">AI Office Chief of Staff</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={voiceOutput ? "Turn voice output off" : "Turn voice output on"}
                aria-pressed={voiceOutput}
                onClick={() => setVoiceOutput((v) => !v)}
              >
                {voiceOutput ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Close assistant" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {awareness && (
            <div className="border-b border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
              Office {awareness.officeOpen ? "OPEN" : "CLOSED"} · {awareness.activeProjects} project(s) active · {awareness.pendingApprovals} approval(s)
              pending · ${awareness.monthlyLiveSpendUsd.toFixed(2)} monthly LIVE spend
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {QUICK_COMMANDS.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => void send(cmd)}
                    className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-col gap-2.5">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {m.text}
                </div>
              ))}
              {busy && <div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">…</div>}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t border-border/60 p-3"
          >
            {speechSupported && (
              <Button
                type="button"
                variant={listening ? "default" : "outline"}
                size="icon"
                aria-label={listening ? "Stop listening" : "Speak to Teja"}
                aria-pressed={listening}
                onClick={toggleMic}
              >
                <Mic className="size-4" />
              </Button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pending ? "Confirm or cancel…" : "Ask Teja…"}
              className="h-9 flex-1 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Message"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
