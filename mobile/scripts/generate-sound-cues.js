// Synthesizes the in-game sound cues into android res/raw as 16-bit mono WAV.
// The cues are short, dull wooden knocks (a dart landing in the board / a chess piece
// put down on a board) instead of beeps. Re-run after tuning:
//   node ./scripts/generate-sound-cues.js
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'raw');

// Deterministic noise so regenerated files do not change without a tuning change.
let seed = 12345;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// One knock: a few decaying wooden modes plus a short soft noise transient.
// Phone speakers barely reproduce < 300 Hz, so the low "body" also lives in the
// 300-700 Hz modes; the fundamental only adds weight on better speakers.
const addKnock = (buffer, startSeconds, { modes, noise, gain = 1 }) => {
  const start = Math.round(startSeconds * SAMPLE_RATE);
  let lowpassed = 0;
  for (let i = 0; start + i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.0006);
    let sample = 0;
    modes.forEach(({ frequency, amplitude, decay }, index) => {
      // The lowest mode drops slightly in pitch right after impact, which reads as a thud.
      const glide = index === 0 ? 1 + 0.12 * Math.exp(-t / 0.012) : 1;
      sample += amplitude * Math.exp(-t / decay) * Math.sin(2 * Math.PI * frequency * glide * t);
    });
    lowpassed += 0.25 * (random() * 2 - 1 - lowpassed);
    sample += noise * lowpassed * Math.exp(-t / 0.0025);
    buffer[start + i] += gain * attack * sample;
  }
};

const renderCue = (lengthSeconds, knocks) => {
  const buffer = new Float64Array(Math.round(lengthSeconds * SAMPLE_RATE));
  knocks.forEach(knock => addKnock(buffer, knock.at, knock));
  // Gentle overall low-pass keeps the sound dull rather than clicky.
  let previous = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    previous += 0.55 * (buffer[i] - previous);
    buffer[i] = previous;
  }
  const peak = buffer.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  // Short fade-out so the tail never ends in a click.
  const fadeSamples = Math.round(0.02 * SAMPLE_RATE);
  return buffer.map((value, i) => {
    const fade = Math.min(1, (buffer.length - i) / fadeSamples);
    return (value / peak) * 0.9 * fade;
  });
};

const writeWav = (fileName, samples) => {
  const dataSize = samples.length * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  samples.forEach((value, i) => {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), wav);
  console.log(`[generate-sound-cues] wrote ${fileName} (${samples.length} samples)`);
};

// A dart landing: one low wooden thunk.
const dartKnock = {
  modes: [
    { frequency: 190, amplitude: 1.0, decay: 0.06 },
    { frequency: 380, amplitude: 0.7, decay: 0.035 },
    { frequency: 640, amplitude: 0.45, decay: 0.018 },
    { frequency: 1050, amplitude: 0.2, decay: 0.008 },
  ],
  noise: 0.35,
};

// Ready to throw: two lighter taps, like a piece set down twice.
const tapKnock = {
  modes: [
    { frequency: 260, amplitude: 0.8, decay: 0.04 },
    { frequency: 520, amplitude: 0.7, decay: 0.025 },
    { frequency: 870, amplitude: 0.4, decay: 0.012 },
    { frequency: 1400, amplitude: 0.15, decay: 0.006 },
  ],
  noise: 0.3,
};

// Something failed: two slower, deeper thuds going down in pitch.
const thudKnock = baseFrequency => ({
  modes: [
    { frequency: baseFrequency, amplitude: 1.0, decay: 0.08 },
    { frequency: baseFrequency * 2.0, amplitude: 0.75, decay: 0.045 },
    { frequency: baseFrequency * 3.4, amplitude: 0.35, decay: 0.02 },
  ],
  noise: 0.2,
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeWav('cue_dart.wav', renderCue(0.22, [{ at: 0, ...dartKnock }]));
writeWav(
  'cue_ready.wav',
  renderCue(0.32, [
    { at: 0, ...tapKnock },
    { at: 0.15, ...tapKnock },
  ]),
);
writeWav(
  'cue_error.wav',
  renderCue(0.5, [
    { at: 0, ...thudKnock(170) },
    { at: 0.22, ...thudKnock(130), gain: 0.9 },
  ]),
);
