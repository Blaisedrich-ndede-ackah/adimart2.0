type ScanBeepType = 'success' | 'warning' | 'error';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (audioCtx) return audioCtx;

  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) return null;

  audioCtx = new AudioContextCtor();
  return audioCtx;
}

export function primeScanBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // iOS/Safari commonly requires a user gesture to start audio.
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

export function playScanBeep(type: ScanBeepType): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    // Might still work if we get a user gesture soon after.
    void ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const volume =
    type === 'success' ? 0.08 : type === 'warning' ? 0.05 : 0.06;

  const beep = (freq: number, durationSec: number, offsetSec: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + offsetSec);

    // Quick attack + exponential decay envelope
    gain.gain.setValueAtTime(0.0001, now + offsetSec);
    gain.gain.linearRampToValueAtTime(volume, now + offsetSec + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offsetSec + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + offsetSec);
    osc.stop(now + offsetSec + durationSec + 0.02);
  };

  if (type === 'success') {
    beep(880, 0.08, 0);
    beep(1040, 0.10, 0.09);
    return;
  }

  if (type === 'warning') {
    beep(440, 0.12, 0);
    return;
  }

  // error / fail
  beep(220, 0.22, 0);
}

