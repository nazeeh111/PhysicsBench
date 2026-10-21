// Browser-independent signal processing. Frequency estimates are meaningful above DC.
export const FFT_SIZE = 2048;
export const SYNTH_RATE = 16000;
export const SESSION_MAX_BYTES = 300000;
export const MAX_CAPTURE_SAMPLES = 8192;
export const AUDIO_DEFAULTS = Object.freeze({
  kind: "sine",
  frequency: 440,
  secondFrequency: 660,
  gain: 0.6,
  noise: 0,
});

export function validateSignal(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !["sine", "two-tone", "chirp"].includes(value.kind)
  )
    throw new Error("Choose a supported signal.");
  const p = { kind: value.kind };
  for (const [key, min, max] of [
    ["frequency", 40, 6000],
    ["secondFrequency", 40, 6000],
    ["gain", 0, 1],
    ["noise", 0, 0.5],
  ]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max)
      throw new Error(`${key} must be between ${min} and ${max}.`);
    p[key] = value[key];
  }
  return p;
}
function seededNoise(index) {
  let x = (index + 1) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 2147483648 - 1;
}
export function synthesize(
  parameters,
  count = FFT_SIZE,
  sampleRate = SYNTH_RATE,
  startSample = 0,
) {
  const p = validateSignal(parameters);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_CAPTURE_SAMPLES ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    !Number.isSafeInteger(startSample) ||
    startSample < 0
  )
    throw new Error("Invalid synthesis window.");
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = (startSample + i) / sampleRate;
    let tone;
    if (p.kind === "chirp") {
      // Repeating four-second linear sweep. Reset phase at the repeat boundary.
      const u = t % 4;
      tone = Math.sin(
        2 *
          Math.PI *
          (p.frequency * u + ((p.secondFrequency - p.frequency) * u * u) / 8),
      );
    } else {
      tone = Math.sin(2 * Math.PI * p.frequency * t);
      if (p.kind === "two-tone")
        tone = (tone + Math.sin(2 * Math.PI * p.secondFrequency * t)) / 2;
    }
    result[i] = p.gain * tone + p.noise * seededNoise(startSample + i);
  }
  return result;
}
export function analyze(samples, sampleRate) {
  const n = samples.length;
  if (
    n < 32 ||
    n > MAX_CAPTURE_SAMPLES ||
    (n & (n - 1)) !== 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000
  )
    throw new Error(
      "FFT requires a power-of-two window and a valid sample rate.",
    );
  const real = new Float64Array(n),
    imag = new Float64Array(n);
  let square = 0,
    peak = 0,
    clipped = 0,
    windowSum = 0,
    mean = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(samples[i]) || Math.abs(samples[i]) > 4)
      throw new Error(
        "Samples must be finite normalized values between -4 and 4.",
      );
    mean += samples[i];
    square += samples[i] * samples[i];
    peak = Math.max(peak, Math.abs(samples[i]));
    if (Math.abs(samples[i]) >= 1) clipped++;
  }
  mean /= n;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    real[i] = (samples[i] - mean) * w;
    windowSum += w;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let size = 2; size <= n; size *= 2) {
    const step = (-2 * Math.PI) / size;
    for (let base = 0; base < n; base += size) {
      for (let j = 0; j < size / 2; j++) {
        const c = Math.cos(step * j),
          s = Math.sin(step * j),
          a = base + j,
          b = a + size / 2;
        const tr = c * real[b] - s * imag[b],
          ti = s * real[b] + c * imag[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
      }
    }
  }
  const amplitudes = new Float64Array(n / 2 + 1),
    decibels = new Float64Array(n / 2 + 1);
  let top = 1,
    sum = 0,
    weighted = 0;
  for (let i = 0; i < amplitudes.length; i++) {
    amplitudes[i] =
      (Math.hypot(real[i], imag[i]) * (i === 0 || i === n / 2 ? 1 : 2)) /
      windowSum;
    decibels[i] = Math.max(-120, 20 * Math.log10(amplitudes[i] || 1e-6));
    if (i > 0) {
      sum += amplitudes[i];
      weighted += (amplitudes[i] * i * sampleRate) / n;
      if (amplitudes[i] > amplitudes[top]) top = i;
    }
  }
  let offset = 0;
  if (top > 0 && top < amplitudes.length - 1) {
    const left = Math.log(amplitudes[top - 1] + 1e-20),
      mid = Math.log(amplitudes[top] + 1e-20),
      right = Math.log(amplitudes[top + 1] + 1e-20);
    const denominator = left - 2 * mid + right;
    if (Math.abs(denominator) > 1e-12)
      offset = Math.max(
        -0.5,
        Math.min(0.5, (0.5 * (left - right)) / denominator),
      );
  }
  const rms = Math.sqrt(square / n);
  return {
    amplitudes,
    decibels,
    rms,
    rmsDBFS: rms ? 20 * Math.log10(rms) : -Infinity,
    peak,
    clipped,
    peakFrequency:
      amplitudes[top] > 1e-7 ? ((top + offset) * sampleRate) / n : null,
    centroid: sum > 1e-7 ? weighted / sum : null,
    resolution: sampleRate / n,
    mean,
  };
}
const PROCESSING_SETTINGS = [
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
];
const NUMERIC_SETTINGS = {
  sampleRate: [8000, 192000],
  channelCount: [1, 32],
  sampleSize: [1, 64],
  latency: [0, 60],
};
const SETTING_KEYS = [...PROCESSING_SETTINGS, ...Object.keys(NUMERIC_SETTINGS)];
function plainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function analysisFacts(fftSize) {
  return {
    window: "hann-symmetric",
    fftSize,
    meanRemoval: true,
    spectrum: "one-sided-peak-amplitude",
    level: "dBFS",
  };
}
// Read only non-identifying fields. Never retain deviceId, groupId, or track labels.
export function createAcquisitionMetadata(
  originalSource,
  fftSize = FFT_SIZE,
  reportedSettings = {},
) {
  if (!["simulation", "microphone", "unknown"].includes(originalSource))
    throw new Error("Invalid original audio source.");
  if (!plainRecord(reportedSettings)) reportedSettings = {};
  const metadata = { originalSource, analysis: analysisFacts(fftSize) };
  if (originalSource === "microphone") {
    metadata.microphone = {};
    for (const key of PROCESSING_SETTINGS)
      metadata.microphone[key] =
        typeof reportedSettings[key] === "boolean"
          ? reportedSettings[key]
          : null;
    for (const [key, [min, max]] of Object.entries(NUMERIC_SETTINGS)) {
      const value = reportedSettings[key];
      metadata.microphone[key] =
        Number.isFinite(value) &&
        value >= min &&
        value <= max &&
        (key === "latency" || Number.isInteger(value))
          ? value
          : null;
    }
  }
  return validateAcquisitionMetadata(metadata, fftSize);
}
export function validateAcquisitionMetadata(value, fftSize) {
  if (
    !Number.isInteger(fftSize) ||
    fftSize < 32 ||
    fftSize > MAX_CAPTURE_SAMPLES ||
    (fftSize & (fftSize - 1)) !== 0
  )
    throw new Error("Invalid acquisition FFT size.");
  if (
    !plainRecord(value) ||
    Object.keys(value).some(
      (key) => !["originalSource", "analysis", "microphone"].includes(key),
    ) ||
    !["simulation", "microphone", "unknown"].includes(value.originalSource)
  )
    throw new Error("Invalid acquisition metadata.");
  const expected = analysisFacts(fftSize);
  if (
    !plainRecord(value.analysis) ||
    Object.keys(value.analysis).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, fact]) => value.analysis[key] !== fact)
  )
    throw new Error(
      "Acquisition analysis metadata does not match this sample window.",
    );
  const result = { originalSource: value.originalSource, analysis: expected };
  if (value.microphone !== undefined) {
    if (
      value.originalSource !== "microphone" ||
      !plainRecord(value.microphone) ||
      Object.keys(value.microphone).some((key) => !SETTING_KEYS.includes(key))
    )
      throw new Error(
        "Invalid microphone metadata. Only non-identifying reported settings are accepted.",
      );
    result.microphone = {};
    for (const key of PROCESSING_SETTINGS) {
      const setting = value.microphone[key] ?? null;
      if (setting !== null && typeof setting !== "boolean")
        throw new Error("Invalid microphone processing setting.");
      result.microphone[key] = setting;
    }
    for (const [key, [min, max]] of Object.entries(NUMERIC_SETTINGS)) {
      const setting = value.microphone[key] ?? null;
      if (
        setting !== null &&
        (!Number.isFinite(setting) ||
          setting < min ||
          setting > max ||
          (key !== "latency" && !Number.isInteger(setting)))
      )
        throw new Error("Invalid numeric microphone setting.");
      result.microphone[key] = setting;
    }
  }
  return result;
}
export function serializeCapture({
  samples,
  sampleRate,
  parameters,
  source,
  metadata,
}) {
  const capture = {
    format: "physicsbench-audio",
    version: 1,
    source,
    sampleRate,
    parameters: validateSignal(parameters),
    samples: Array.from(samples),
  };
  if (metadata !== undefined)
    capture.metadata = validateAcquisitionMetadata(metadata, samples.length);
  parseCapture(JSON.stringify(capture));
  return JSON.stringify(capture);
}
export function parseCapture(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > SESSION_MAX_BYTES
  )
    throw new Error("Audio session exceeds the 300 KB limit.");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (
    !value ||
    value.format !== "physicsbench-audio" ||
    value.version !== 1 ||
    !["simulation", "microphone", "replay"].includes(value.source)
  )
    throw new Error("Unsupported audio session.");
  const parameters = validateSignal(value.parameters);
  if (
    !Array.isArray(value.samples) ||
    value.samples.length < 32 ||
    value.samples.length > MAX_CAPTURE_SAMPLES ||
    (value.samples.length & (value.samples.length - 1)) !== 0
  )
    throw new Error(
      "Session samples must be a power-of-two window, from 32 to 8192 samples.",
    );
  const samples = Float32Array.from(
    value.samples.map((x) => {
      if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 4)
        throw new Error("Session contains invalid samples.");
      return x;
    }),
  );
  analyze(samples, value.sampleRate);
  const metadata =
    value.metadata === undefined
      ? undefined
      : validateAcquisitionMetadata(value.metadata, samples.length);
  if (
    metadata &&
    value.source !== "replay" &&
    metadata.originalSource !== value.source
  )
    throw new Error("Acquisition origin conflicts with the capture source.");
  return {
    samples,
    sampleRate: value.sampleRate,
    parameters,
    source: value.source,
    ...(metadata ? { metadata } : {}),
  };
}
export function captureCSV(samples, sampleRate, source, metadata) {
  analyze(samples, sampleRate);
  if (!["simulation", "microphone", "replay"].includes(source))
    throw new Error("Unsupported capture source.");
  const checked =
    metadata === undefined
      ? undefined
      : validateAcquisitionMetadata(metadata, samples.length);
  if (checked && source !== "replay" && checked.originalSource !== source)
    throw new Error("Acquisition origin conflicts with the capture source.");
  const originalSource =
    checked?.originalSource ?? (source === "replay" ? "unknown" : source);
  const acquisitionLine = checked
    ? `# acquisition_metadata=${JSON.stringify(checked)}\n`
    : "";
  return (
    `# PhysicsBench audio; source=${originalSource}; sample_rate_hz=${sampleRate}; amplitude=normalized; level=dBFS\n${acquisitionLine}time_s,amplitude\n` +
    Array.from(
      samples,
      (x, i) => `${(i / sampleRate).toPrecision(10)},${x.toPrecision(9)}`,
    ).join("\n") +
    "\n"
  );
}
