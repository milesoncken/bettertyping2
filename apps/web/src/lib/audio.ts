/**
 * Keystroke audio, synthesised rather than sampled.
 *
 * Five switch profiles built from noise bursts and filtered tones, so the whole
 * sound design costs a few hundred bytes instead of a sample pack. Off by
 * default — browsers block audio before a gesture anyway, and a typing site that
 * makes noise unbidden is a typing site people close.
 */

export const PROFILES = ["off", "linear", "tactile", "clicky", "typewriter", "soft"] as const;
export type Profile = (typeof PROFILES)[number];

interface Voice {
  /** Bandpass centre, Hz. */
  freq: number;
  q: number;
  /** Amplitude decay, seconds. */
  decay: number;
  gain: number;
  /** Sine body mixed under the noise, Hz. 0 for none. */
  body: number;
}

const VOICES: Record<Exclude<Profile, "off">, Voice> = {
  linear: { freq: 1100, q: 1.1, decay: 0.035, gain: 0.16, body: 190 },
  tactile: { freq: 1700, q: 2.2, decay: 0.045, gain: 0.2, body: 230 },
  clicky: { freq: 3200, q: 3.4, decay: 0.03, gain: 0.22, body: 420 },
  typewriter: { freq: 2400, q: 1.4, decay: 0.09, gain: 0.26, body: 120 },
  soft: { freq: 700, q: 0.9, decay: 0.055, gain: 0.11, body: 150 },
};

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

const STORAGE_KEY = "bt.audio.profile";

export function loadProfile(): Profile {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return PROFILES.includes(saved as Profile) ? (saved as Profile) : "off";
  } catch {
    return "off";
  }
}

export function saveProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // A blocked storage API is not a reason to fail a keystroke.
  }
}

/** Must be called from a user gesture. Safe to call repeatedly. */
function ensureContext(): AudioContext | null {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();

  const seconds = 0.25;
  const length = Math.floor(ctx.sampleRate * seconds);
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

/** One keystroke. `correct: false` drops the pitch, so errors are audible. */
export function playKey(profile: Profile, correct: boolean): void {
  if (profile === "off") return;
  const audio = ensureContext();
  if (!audio || !noise) return;

  const voice = VOICES[profile];
  const now = audio.currentTime;
  const detune = 0.94 + Math.random() * 0.12;
  const freq = voice.freq * detune * (correct ? 1 : 0.55);

  const source = audio.createBufferSource();
  source.buffer = noise;
  source.playbackRate.value = 0.9 + Math.random() * 0.2;

  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = voice.q;

  const gain = audio.createGain();
  gain.gain.setValueAtTime(voice.gain * (correct ? 1 : 1.25), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.decay);

  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(now);
  source.stop(now + voice.decay + 0.02);

  if (voice.body > 0) {
    const body = audio.createOscillator();
    body.type = "sine";
    body.frequency.value = voice.body * (correct ? 1 : 0.6);
    const bodyGain = audio.createGain();
    bodyGain.gain.setValueAtTime(voice.gain * 0.5, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + voice.decay * 1.4);
    body.connect(bodyGain).connect(audio.destination);
    body.start(now);
    body.stop(now + voice.decay * 1.5);
  }
}

/**
 * The results swell. A quiet major-ninth voicing that rises as the trace lands,
 * tuned to finish before the numbers do so it reads as arrival, not fanfare.
 */
export function playSwell(profile: Profile): void {
  if (profile === "off") return;
  const audio = ensureContext();
  if (!audio) return;

  const now = audio.currentTime;
  const root = 174.6; // F3
  for (const [i, ratio] of [1, 1.5, 2, 2.25].entries()) {
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = root * ratio;

    const gain = audio.createGain();
    const peak = 0.09 / (i + 1.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.18 + i * 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);

    osc.connect(gain).connect(audio.destination);
    osc.start(now + i * 0.04);
    osc.stop(now + 1.6);
  }
}
