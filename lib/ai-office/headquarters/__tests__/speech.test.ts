import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  OfficeSpeechController,
  selectLocalVoice,
  DEFAULT_VOICE_PROFILE,
  VOICE_PROFILES,
  readVoicePreference,
  saveVoicePreference,
  type SpeechBriefing,
} from "../speech.ts";
import { safeWorldText } from "../world-state.ts";
const voice = {
  name: "Local English",
  voiceURI: "local",
  lang: "en-US",
  localService: true,
  default: true,
} as SpeechSynthesisVoice;
const briefing = (role = "qa-agent", priority: 1 | 2 = 1): SpeechBriefing => ({
  role,
  priority,
  text: "Good evening, Boss. Testing the notes page. No recorded blocker.",
  revision: "r1",
});
function setup(t: TestContext) {
  const utterances: SpeechSynthesisUtterance[] = [];
  let cancels = 0;
  const c = new OfficeSpeechController(
    {
      voices: () => [voice],
      utterance: (text) => ({ text }) as SpeechSynthesisUtterance,
      speak: (u) => {
        utterances.push(u);
      },
      cancel: () => {
        cancels++;
      },
    },
    () => {},
  );
  t.after(() => c.dispose());
  c.unlock();
  return { c, utterances, cancels: () => cancels };
}
test("local-only selection refuses remote defaults and deterministically handles absent voices", () => {
  assert.equal(
    selectLocalVoice(
      [{ ...voice, localService: false }],
      DEFAULT_VOICE_PROFILE,
    ),
    undefined,
  );
  assert.equal(selectLocalVoice([], DEFAULT_VOICE_PROFILE), undefined);
  assert.equal(
    selectLocalVoice(
      [{ ...voice, localService: false }, voice],
      DEFAULT_VOICE_PROFILE,
    ),
    voice,
  );
  assert.equal(
    selectLocalVoice([{ ...voice, lang: "fr-FR" }], DEFAULT_VOICE_PROFILE)
      ?.localService,
    true,
  );
  for (const p of Object.values(VOICE_PROFILES))
    assert.ok(
      p.rate >= 0.8 && p.rate <= 1.2 && p.pitch >= 0.8 && p.pitch <= 1.2,
    );
});
test("one speaker replaces stale speech, exact subtitle text and profile are used", (t) => {
  const { c, utterances, cancels } = setup(t);
  const first = briefing();
  c.speak(first);
  const old = utterances[0].onend;
  assert.equal(utterances[0].text, first.text);
  assert.equal(utterances[0].voice, voice);
  utterances[0].onstart?.({} as SpeechSynthesisEvent);
  assert.equal(c.view.status, "speaking");
  c.speak(briefing("frontend-developer"));
  assert.equal(cancels(), 1);
  assert.equal(utterances[0].onstart, null);
  old?.call(utterances[0], {} as SpeechSynthesisEvent);
  assert.equal(c.view.briefing?.role, "frontend-developer");
  assert.equal(utterances.length, 2);
  assert.equal(utterances[1].rate, VOICE_PROFILES["frontend-developer"].rate);
});
test("detailed briefing wins over automatic greeting; leaving cancels without an audio queue", (t) => {
  const { c, utterances, cancels } = setup(t);
  c.speak(briefing("qa-agent", 2));
  assert.equal(c.speak(briefing()), false);
  c.leave("qa-agent");
  assert.equal(cancels(), 0);
  c.leave("product-owner");
  assert.equal(cancels(), 1);
  assert.equal(c.view.briefing, null);
  assert.equal(utterances.length, 1);
});
test("voice off and missing gesture prevent speech; missing browser keeps text fallback", (t) => {
  const { c, utterances } = setup(t);
  c.speak(briefing());
  c.setEnabled(false);
  assert.equal(c.view.status, "idle");
  assert.equal(c.speak(briefing()), false);
  assert.equal(utterances.length, 1);
  const missing = new OfficeSpeechController(null, () => {});
  t.after(() => missing.dispose());
  assert.equal(missing.speak(briefing()), false);
  missing.unlock();
  assert.equal(missing.speak(briefing()), false);
  assert.equal(missing.view.status, "unavailable");
});
test("preference defaults on and persists off; unavailable storage is harmless", () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
  assert.equal(readVoicePreference(storage), true);
  saveVoicePreference(storage, false);
  assert.equal(readVoicePreference(storage), false);
  assert.equal(
    readVoicePreference({
      getItem: () => {
        throw Error();
      },
    }),
    true,
  );
  assert.doesNotThrow(() =>
    saveVoicePreference(
      {
        setItem: () => {
          throw Error();
        },
      },
      false,
    ),
  );
});
test("end/error detach callbacks and clear speaker; unknown roles use fallback", (t) => {
  const { c, utterances } = setup(t);
  c.speak(briefing("future-agent"));
  assert.equal(utterances[0].pitch, DEFAULT_VOICE_PROFILE.pitch);
  utterances[0].onend?.({} as SpeechSynthesisEvent);
  assert.equal(c.view.status, "idle");
  assert.equal(utterances[0].onend, null);
  c.speak(briefing());
  utterances[1].onerror?.({} as SpeechSynthesisErrorEvent);
  assert.equal(c.view.status, "unavailable");
  assert.equal(utterances[1].onerror, null);
});
test("start timeout cancels a browser that never starts, without accumulating utterances", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { c, utterances } = setup(t);
  c.speak(briefing());
  t.mock.timers.tick(6001);
  assert.equal(c.view.status, "unavailable");
  assert.equal(utterances[0].onstart, null);
});
test("sanitized DTO text remains identical in the utterance", (t) => {
  const { c, utterances } = setup(t);
  const text = safeWorldText(
    "Notes gsk_abcdefghijklmnop Bearer confidential-value",
  );
  assert.ok(!text.includes("confidential-value"));
  assert.ok(!text.includes("gsk_abcdefghijklmnop"));
  c.speak({ ...briefing(), text });
  assert.equal(utterances[0].text, text);
});
