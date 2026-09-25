"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  OfficeSpeechController,
  readVoicePreference,
  saveVoicePreference,
  type SpeechBriefing,
  type SpeechView,
} from "@/lib/ai-office/headquarters/speech";
export function useOfficeSpeech() {
  const controller = useRef<OfficeSpeechController | null>(null);
  const intentional = useRef<string | null>(null);
  const speaking = useRef<string | null>(null);
  const [enabled, setEnabled] = useState(() => {
    try {
      return readVoicePreference(window.localStorage);
    } catch {
      return true;
    }
  });
  const [view, setView] = useState<SpeechView>({
    status: "idle",
    briefing: null,
  });
  useEffect(() => {
    const engine = window.speechSynthesis;
    const c = new OfficeSpeechController(
      engine && window.SpeechSynthesisUtterance
        ? {
            voices: () => engine.getVoices(),
            utterance: (text) => new SpeechSynthesisUtterance(text),
            speak: (u) => engine.speak(u),
            cancel: () => engine.cancel(),
          }
        : null,
      (next) => {
        speaking.current =
          next.status === "speaking" ? next.briefing!.role : null;
        setView(next);
      },
    );
    controller.current = c;
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* private mode */
    }
    const initial = readVoicePreference(storage);
    c.setEnabled(initial);
    const unlock = () => c.unlock();
    const hide = () => {
      if (document.hidden) c.stop();
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", hide);
    const unload = () => c.stop();
    window.addEventListener("pagehide", unload);
    const warm = () => engine?.getVoices();
    warm();
    engine?.addEventListener("voiceschanged", warm);
    return () => {
      c.dispose();
      controller.current = null;
      window.removeEventListener("pagehide", unload);
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", hide);
      engine?.removeEventListener("voiceschanged", warm);
    };
  }, []);
  const toggle = useCallback(() => {
    const next = !enabled;
    controller.current?.setEnabled(next);
    setEnabled(next);
    try {
      saveVoicePreference(window.localStorage, next);
    } catch {
      /* private mode */
    }
  }, [enabled]);
  const speak = useCallback(
    (briefing: SpeechBriefing) => controller.current?.speak(briefing),
    [],
  );
  const stop = useCallback(() => controller.current?.stop(), []);
  const leave = useCallback(
    (role: string | null) =>
      controller.current?.leave(intentional.current ?? role),
    [],
  );
  const focus = useCallback((role: string | null) => {
    intentional.current = role;
    controller.current?.stop();
  }, []);
  return { enabled, view, speaking, toggle, speak, stop, leave, focus };
}
