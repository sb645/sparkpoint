export const RINGER_INTENSITY_MAX = 3;

// Each pair uses the same two pitches. Shorter rests and a detuned overtone
// change its character without turning up the master volume.
const levels = [
  { gap: 0.30, rest: 1.00, wave: 'sine',     cents: 0,  drift: 0 },
  { gap: 0.25, rest: 0.76, wave: 'triangle', cents: 8,  drift: 0 },
  { gap: 0.21, rest: 0.55, wave: 'sawtooth', cents: 17, drift: 7 },
  { gap: 0.17, rest: 0.38, wave: 'square',   cents: 28, drift: 15 },
];
const lookahead = 0.10; // seconds on the audio clock
const tickMs = 25;

// A closed context or an already-ended source can reject further operations.
function quietly(action) {
  try { return action(); } catch { /* Audio is optional. */ }
}

export function createRinger(options = {}) {
  const requestedVolume = options.volume ?? 0.15;
  const volume = Number.isFinite(requestedVolume)
    ? Math.max(0, Math.min(0.35, requestedVolume)) : 0.15;
  let context;
  let compressor;
  let master;
  let timer;
  let playing = false;
  let muted = false;
  let disposed = false;
  let intensity = 0;
  let nextTime = 0;
  let secondNote = false;
  const voices = new Set();

  function release(voice) {
    voices.delete(voice);
    voice.osc.onended = null;
    quietly(() => voice.osc.disconnect());
    quietly(() => voice.envelope?.disconnect());
  }

  function silence() {
    clearTimeout(timer);
    timer = undefined;
    for (const voice of voices) {
      quietly(() => voice.osc.stop());
      release(voice);
    }
  }

  async function closeContext() {
    silence();
    const old = context;
    context = master = compressor = undefined;
    if (old) {
      old.onstatechange = null;
      try { await old.close(); } catch { /* It may already be closed. */ }
    }
  }

  function tone(at, frequency, wave, cents, drift, peak) {
    const osc = context.createOscillator();
    const voice = { osc };
    voices.add(voice); // Also released if constructing the graph fails partway.
    const envelope = voice.envelope = context.createGain();
    osc.type = wave;
    osc.frequency.value = frequency;
    osc.detune.setValueAtTime(cents, at);
    osc.detune.linearRampToValueAtTime(cents + drift, at + 0.18);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + 0.014);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    envelope.gain.linearRampToValueAtTime(0, at + 0.20);
    osc.connect(envelope);
    envelope.connect(compressor);
    osc.onended = () => release(voice);
    osc.start(at);
    osc.stop(at + 0.20);
  }

  function schedule() {
    timer = undefined;
    if (!playing || context?.state !== 'running') return;
    try {
      const now = context.currentTime;
      // Drop missed beats after a long stall instead of playing them in a burst.
      if (nextTime < now) nextTime = now + 0.015;
      while (nextTime < now + lookahead) {
        const level = levels[intensity];
        const pitch = secondNote ? 659.25 : 523.25;
        tone(nextTime, pitch, 'sine', 0, 0, 0.34);
        tone(nextTime, pitch, level.wave, level.cents, level.drift, 0.09);
        nextTime += secondNote ? level.rest : level.gap;
        secondNote = !secondNote;
      }
      timer = setTimeout(schedule, tickMs);
    } catch {
      void closeContext();
    }
  }

  function syncClock() {
    if (playing && context?.state === 'running') {
      if (timer === undefined) schedule();
    } else {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  async function unlock() {
    if (disposed) return;
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Audio) return;
    if (!context) {
      try {
        context = new Audio();
        compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 6;
        master = context.createGain();
        master.gain.value = muted ? 0 : volume;
        compressor.connect(master);
        master.connect(context.destination);
        context.onstatechange = syncClock;
      } catch {
        await closeContext();
        return;
      }
    }
    try {
      if (context.state !== 'running') await context.resume();
      syncClock();
    } catch { /* A later user gesture can retry resume(). */ }
  }

  function start() {
    if (disposed || playing) return;
    playing = true;
    secondNote = false;
    nextTime = (context?.currentTime ?? 0) + 0.015;
    syncClock();
  }

  function stop() {
    playing = false;
    silence();
  }

  function setMuted(value) {
    if (muted === Boolean(value) || disposed) return;
    muted = Boolean(value);
    if (!master) return;
    try {
      const gain = master.gain;
      const now = context.currentTime;
      const current = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(current, now);
      gain.linearRampToValueAtTime(muted ? 0 : volume, now + 0.008);
    } catch {
      void closeContext();
    }
  }

  function setIntensity(n) {
    if (!disposed && typeof n === 'number' && !Number.isNaN(n)) {
      intensity = Math.max(0, Math.min(RINGER_INTENSITY_MAX, Math.trunc(n)));
    }
  }

  function dispose() {
    disposed = true;
    playing = false;
    return closeContext();
  }

  return {
    start, stop, setMuted, isMuted: () => muted, isPlaying: () => playing,
    setIntensity, getIntensity: () => intensity, unlock, dispose,
  };
}
