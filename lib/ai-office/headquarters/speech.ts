/** Presentation only: one utterance, no network, no generated facts. */
export type VoiceProfile = {
  rate: number;
  pitch: number;
  language: string;
  character: string;
};
const profile = (
  rate: number,
  pitch: number,
  character: string,
): VoiceProfile => ({ rate, pitch, language: "en-US", character });
export const VOICE_PROFILES: Record<string, VoiceProfile> = {
  orchestrator: profile(0.94, 0.94, "calm executive"),
  "product-owner": profile(1, 1.06, "friendly conversational"),
  "solution-architect": profile(0.9, 0.98, "measured thoughtful"),
  "ui-ux-agent": profile(0.98, 1.09, "warm creative"),
  "frontend-developer": profile(1.06, 1.02, "energetic concise"),
  "backend-developer": profile(1.03, 0.98, "energetic concise"),
  "qa-agent": profile(0.95, 1, "clear analytical"),
  "security-reviewer": profile(0.9, 0.92, "serious deliberate"),
  "code-reviewer": profile(0.93, 0.98, "calm precise"),
  "release-agent": profile(1, 0.97, "crisp operational"),
  "office-engineer": profile(0.96, 0.9, "system-like natural"),
};
export const DEFAULT_VOICE_PROFILE = profile(1, 1, "neutral clear");
export type LocalVoice = Pick<
  SpeechSynthesisVoice,
  "name" | "lang" | "localService" | "default" | "voiceURI"
>;
export function selectLocalVoice<T extends LocalVoice>(
  voices: T[],
  p: VoiceProfile,
): T | undefined {
  const score = (v: T) =>
    (v.lang.toLowerCase() === p.language.toLowerCase()
      ? 4
      : v.lang.split("-")[0] === p.language.split("-")[0]
        ? 2
        : 0) + Number(v.default);
  return voices
    .filter((v) => v.localService === true)
    .sort(
      (a, b) => score(b) - score(a) || a.voiceURI.localeCompare(b.voiceURI),
    )[0];
}
export const VOICE_PREFERENCE = "ai-office-local-voice";
export function readVoicePreference(storage?: Pick<Storage, "getItem">) {
  try {
    return storage?.getItem(VOICE_PREFERENCE) !== "off";
  } catch {
    return true;
  }
}
export function saveVoicePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  enabled: boolean,
) {
  try {
    storage?.setItem(VOICE_PREFERENCE, enabled ? "on" : "off");
  } catch {
    /* storage can be disabled */
  }
}
export type SpeechBriefing = {
  role: string;
  text: string;
  revision: string;
  priority: 1 | 2;
};
export type SpeechView = {
  status: "idle" | "starting" | "speaking" | "unavailable";
  briefing: SpeechBriefing | null;
};
export type SpeechPort = {
  voices(): SpeechSynthesisVoice[];
  utterance(text: string): SpeechSynthesisUtterance;
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
};
export class OfficeSpeechController {
  private utterance: SpeechSynthesisUtterance | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private enabled = true;
  private unlocked = false;
  view: SpeechView = { status: "idle", briefing: null };
  private port: SpeechPort | null;
  private changed: (view: SpeechView) => void;
  constructor(port: SpeechPort | null, changed: (view: SpeechView) => void) {
    this.port = port;
    this.changed = changed;
  }
  private publish(
    status: SpeechView["status"],
    briefing: SpeechBriefing | null = null,
  ) {
    this.view = { status, briefing };
    this.changed(this.view);
  }
  unlock() {
    this.unlocked = true;
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) this.stop();
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.utterance) {
      this.utterance.onstart =
        this.utterance.onend =
        this.utterance.onerror =
          null;
      this.utterance = null;
      try {
        this.port?.cancel();
      } catch {
        /* unavailable browser engine */
      }
    }
    if (this.view.status !== "idle") this.publish("idle");
  }
  leave(role: string | null) {
    if (this.view.briefing && this.view.briefing.role !== role) this.stop();
  }
  speak(briefing: SpeechBriefing) {
    if (!this.enabled || !this.unlocked || !briefing.text.trim()) return false;
    if (
      this.view.briefing?.priority === 2 &&
      briefing.priority === 1 &&
      this.view.briefing.role === briefing.role
    )
      return false;
    this.stop();
    const p = VOICE_PROFILES[briefing.role] ?? DEFAULT_VOICE_PROFILE;
    try {
      const voice = this.port && selectLocalVoice(this.port.voices(), p);
      if (!voice || !this.port || briefing.text.length > 6000) {
        this.publish("unavailable");
        return false;
      }
      const u = this.port.utterance(briefing.text),
        generation = this.generation;
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = p.rate;
      u.pitch = p.pitch;
      u.volume = 1;
      this.utterance = u;
      const current = () => generation === this.generation;
      u.onstart = () => {
        if (current()) {
          clearTimeout(this.timer);
          this.publish("speaking", briefing);
          this.timer = setTimeout(() => this.stop(), 120000);
        }
      };
      u.onend = () => {
        if (current()) this.stop();
      };
      u.onerror = () => {
        if (current()) {
          this.stop();
          this.publish("unavailable");
        }
      };
      this.publish("starting", briefing);
      this.timer = setTimeout(() => {
        if (current()) {
          this.stop();
          this.publish("unavailable");
        }
      }, 6000);
      this.port.speak(u);
      return true;
    } catch {
      this.stop();
      this.publish("unavailable");
      return false;
    }
  }
  dispose() {
    this.stop();
  }
}
