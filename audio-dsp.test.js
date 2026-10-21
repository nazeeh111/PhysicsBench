import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  synthesize,
  AUDIO_DEFAULTS,
  serializeCapture,
  parseCapture,
  captureCSV,
  SESSION_MAX_BYTES,
  createAcquisitionMetadata,
  validateAcquisitionMetadata,
} from "./audio-dsp.js";

test("Hann FFT preserves on-bin sine amplitude and RMS; estimates frequency", () => {
  const samples = synthesize({ ...AUDIO_DEFAULTS, frequency: 500, gain: 0.8 });
  const a = analyze(samples, 16000);
  assert.ok(Math.abs(a.peakFrequency - 500) < 0.01);
  assert.ok(Math.abs(a.amplitudes[64] - 0.8) < 0.001);
  assert.ok(Math.abs(a.rms - 0.8 / Math.sqrt(2)) < 0.0001);
  assert.ok(Math.abs(a.rmsDBFS - 20 * Math.log10(0.8 / Math.sqrt(2))) < 0.001);
  assert.equal(a.resolution, 7.8125);
  assert.equal(a.clipped, 0);
});
test("interpolated estimate resolves a frequency between bins", () => {
  const a = analyze(synthesize({ ...AUDIO_DEFAULTS, frequency: 443.2 }), 16000);
  assert.ok(Math.abs(a.peakFrequency - 443.2) < 0.2);
});
test("two tones retain distinct spectral peaks with expected half amplitudes", () => {
  const a = analyze(
    synthesize({
      ...AUDIO_DEFAULTS,
      kind: "two-tone",
      frequency: 500,
      secondFrequency: 1000,
      gain: 0.8,
    }),
    16000,
  );
  assert.ok(Math.abs(a.amplitudes[64] - 0.4) < 0.001);
  assert.ok(Math.abs(a.amplitudes[128] - 0.4) < 0.001);
  assert.ok(Math.abs(a.centroid - 750) < 1);
});
test("noise is reproducible and synthesis window continuity holds", () => {
  const p = { ...AUDIO_DEFAULTS, noise: 0.2 };
  assert.deepEqual(synthesize(p), synthesize(p));
  assert.deepEqual(synthesize(p, 64, 16000, 64), synthesize(p, 128).slice(64));
});
test("silence, DC and clipping report honestly", () => {
  const silence = analyze(new Float32Array(2048), 16000);
  assert.equal(silence.rmsDBFS, -Infinity);
  assert.equal(silence.peakFrequency, null);
  const dc = analyze(new Float32Array(2048).fill(1), 16000);
  assert.equal(dc.clipped, 2048);
  assert.equal(dc.peakFrequency, null);
  assert.equal(dc.rmsDBFS, 0);
});
test("chirp sweeps from low to high over four seconds", () => {
  const p = {
    ...AUDIO_DEFAULTS,
    kind: "chirp",
    frequency: 400,
    secondFrequency: 1600,
  };
  const early = analyze(synthesize(p, 2048, 16000, 0), 16000);
  const late = analyze(synthesize(p, 2048, 16000, 48000), 16000);
  assert.ok(early.peakFrequency > 400 && early.peakFrequency < 450);
  assert.ok(late.peakFrequency > 1300 && late.peakFrequency < 1350);
});
test("session roundtrip preserves source, parameters and sample values", () => {
  const input = {
    samples: synthesize(AUDIO_DEFAULTS),
    parameters: AUDIO_DEFAULTS,
    source: "simulation",
    sampleRate: 16000,
  };
  const output = parseCapture(serializeCapture(input));
  assert.deepEqual(output.samples, input.samples);
  assert.deepEqual(output.parameters, input.parameters);
  assert.equal(output.source, "simulation");
  const csv = captureCSV(output.samples, output.sampleRate, output.source);
  assert.equal(csv.split("\n").length, 2051);
  assert.match(csv, /time_s,amplitude/);
});
test("untrusted sessions reject oversize, nonnumeric, shape and schema faults", () => {
  assert.throws(
    () => parseCapture(" ".repeat(SESSION_MAX_BYTES + 1)),
    /300 KB/,
  );
  assert.throws(() => parseCapture("{"), /valid JSON/);
  const valid = JSON.parse(
    serializeCapture({
      samples: synthesize(AUDIO_DEFAULTS),
      sampleRate: 16000,
      parameters: AUDIO_DEFAULTS,
      source: "simulation",
    }),
  );
  for (const patch of [
    { sampleRate: "16000" },
    { samples: [1, 2] },
    { samples: new Array(32).fill(null) },
    { source: "arbitrary" },
    { parameters: { ...AUDIO_DEFAULTS, frequency: 100000 } },
  ])
    assert.throws(() => parseCapture(JSON.stringify({ ...valid, ...patch })));
  assert.throws(() => analyze(new Float32Array(33), 16000));
  assert.throws(() => analyze(new Float32Array(32).fill(NaN), 16000));
});

test("acquisition metadata retains only reported non-identifying track settings", () => {
  const metadata = createAcquisitionMetadata("microphone", 2048, {
    echoCancellation: false,
    noiseSuppression: true,
    sampleRate: 48000,
    channelCount: 1,
    sampleSize: 24,
    latency: 0.01,
    deviceId: "do-not-retain",
    groupId: "also-private",
    label: "private name",
  });
  assert.deepEqual(metadata.microphone, {
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: null,
    sampleRate: 48000,
    channelCount: 1,
    sampleSize: 24,
    latency: 0.01,
  });
  assert.equal(metadata.analysis.window, "hann-symmetric");
  assert.equal(metadata.analysis.fftSize, 2048);
  assert.equal(metadata.analysis.meanRemoval, true);
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /do-not-retain|also-private|private name|deviceId|groupId/,
  );
  const samples = synthesize(AUDIO_DEFAULTS);
  const first = parseCapture(
    serializeCapture({
      samples,
      sampleRate: 48000,
      source: "microphone",
      parameters: AUDIO_DEFAULTS,
      metadata,
    }),
  );
  const replayed = parseCapture(
    serializeCapture({ ...first, source: "replay" }),
  );
  assert.equal(replayed.source, "replay");
  assert.equal(replayed.metadata.originalSource, "microphone");
  assert.deepEqual(replayed.metadata, first.metadata);
  assert.match(
    captureCSV(
      replayed.samples,
      replayed.sampleRate,
      "replay",
      replayed.metadata,
    ),
    /source=microphone;/,
  );
  assert.match(
    captureCSV(
      replayed.samples,
      replayed.sampleRate,
      "replay",
      replayed.metadata,
    ),
    /"autoGainControl":null/,
  );
});

test("missing and unusable browser settings explicitly become unknown", () => {
  const metadata = createAcquisitionMetadata("microphone", 2048, {
    echoCancellation: "false",
    sampleRate: -1,
    channelCount: 1.5,
    latency: Infinity,
  });
  assert.ok(
    Object.values(metadata.microphone).every((value) => value === null),
  );
  const legacy = parseCapture(
    serializeCapture({
      samples: synthesize(AUDIO_DEFAULTS),
      sampleRate: 16000,
      source: "replay",
      parameters: AUDIO_DEFAULTS,
    }),
  );
  assert.equal(legacy.metadata, undefined);
  assert.match(
    captureCSV(legacy.samples, legacy.sampleRate, legacy.source),
    /source=unknown;/,
  );
  const upgraded = {
    ...legacy,
    metadata: createAcquisitionMetadata("unknown", legacy.samples.length),
  };
  assert.equal(
    parseCapture(serializeCapture(upgraded)).metadata.originalSource,
    "unknown",
  );
});

test("acquisition schema rejects identifying fields, invalid values and false method claims", () => {
  const good = createAcquisitionMetadata("microphone", 2048);
  const clone = () => structuredClone(good);
  const invalid = [];
  let value = clone();
  value.microphone.deviceId = "private";
  invalid.push(value);
  value = clone();
  value.microphone.echoCancellation = "false";
  invalid.push(value);
  value = clone();
  value.microphone.channelCount = 1.2;
  invalid.push(value);
  value = clone();
  value.microphone.latency = -1;
  invalid.push(value);
  value = clone();
  value.microphone.sampleRate = 999999;
  invalid.push(value);
  value = clone();
  value.analysis.fftSize = 4096;
  invalid.push(value);
  value = clone();
  value.analysis.window = "rectangle";
  invalid.push(value);
  value = clone();
  value.originalSource = "simulation";
  invalid.push(value);
  value = clone();
  value.unboundedNotes = "unnecessary";
  invalid.push(value);
  for (const metadata of invalid)
    assert.throws(() => validateAcquisitionMetadata(metadata, 2048));
  assert.throws(() => createAcquisitionMetadata("microphone", 17));
  const capture = {
    samples: synthesize(AUDIO_DEFAULTS),
    sampleRate: 16000,
    source: "simulation",
    parameters: AUDIO_DEFAULTS,
    metadata: good,
  };
  assert.throws(() => serializeCapture(capture), /origin conflicts/);
  assert.throws(
    () => captureCSV(capture.samples, 16000, "simulation", good),
    /origin conflicts/,
  );
  const text = JSON.stringify({
    format: "physicsbench-audio",
    version: 1,
    samples: Array.from(capture.samples),
    parameters: AUDIO_DEFAULTS,
    sampleRate: 16000,
    source: "microphone",
    metadata: invalid[0],
  });
  assert.throws(() => parseCapture(text), /non-identifying/);
});
