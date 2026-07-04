import type { SpaceWeatherCurrent } from "./types";

let audioCtx: AudioContext | null = null;
let beepTimer: ReturnType<typeof setInterval> | null = null;

/** Official storm thresholds used across the dashboard (Kp ≥ 5 or Dst ≤ −50 nT). */
export function isGeomagneticStorm(sw: SpaceWeatherCurrent | null): boolean {
  if (!sw) return false;
  return (sw.kp != null && sw.kp >= 5) || (sw.dst != null && sw.dst <= -50);
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

/** Resume audio after browser autoplay restrictions (call on user gesture). */
export function unlockStormAlarmAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") void ctx.resume();
}

function playBeep(frequency: number, durationMs: number, volume: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
    return;
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ctx.destination);

  const start = ctx.currentTime;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + durationMs / 1000);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

export function stopStormAlarmBeep(): void {
  if (beepTimer != null) {
    clearInterval(beepTimer);
    beepTimer = null;
  }
}

/** Start repeating alarm beeps; returns cleanup that stops the loop. */
export function startStormAlarmBeep(severe = false): () => void {
  stopStormAlarmBeep();

  const intervalMs = severe ? 650 : 1300;
  const frequency = severe ? 980 : 840;
  const volume = severe ? 0.22 : 0.18;
  const durationMs = severe ? 180 : 140;

  const tick = () => playBeep(frequency, durationMs, volume);
  unlockStormAlarmAudio();
  tick();
  beepTimer = setInterval(tick, intervalMs);

  return stopStormAlarmBeep;
}
