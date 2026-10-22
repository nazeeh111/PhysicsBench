import test from "node:test";
import assert from "node:assert/strict";
import {
  generateProtocol,
  analyzeProtocol,
  createSyntheticRecord,
} from "./acoustics.js";

// Independent test oracle: sums delayed time-domain taps. It never imports the production convolution.
function oracleResponse(source, taps, delay, noise = 0, seed = 19) {
  const out = new Float32Array(source.length);
  let state = seed >>> 0;
  for (const [offset, gain] of taps)
    for (let i = 0; i + delay + offset < out.length; i++)
      out[i + delay + offset] += source[i] * gain;
  if (noise)
    for (let i = 0; i < out.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out[i] += (state / 4294967296 - 0.5) * Math.sqrt(12) * noise;
    }
  return out;
}
function fixture({
  fs = 48000,
  delay = 2251,
  taps = [
    [0, 0.65],
    [691, -0.22],
    [1703, 0.12],
  ],
  noise = 0,
  seed = 191,
} = {}) {
  const protocol = generateProtocol(fs, { seed });
  return {
    ...protocol,
    response: oracleResponse(
      protocol.excitation,
      taps,
      delay,
      noise,
      seed + 13,
    ),
  };
}
const near = (value, expected, tolerance, label = "") =>
  assert.ok(
    Math.abs(value - expected) <= tolerance,
    `${label}: ${value} differs from ${expected}`,
  );

test("source protocol has exact contiguous frozen segments and conservative peak amplitude", () => {
  for (const fs of [16000, 44100, 48000, 96000]) {
    const p = generateProtocol(fs);
    let end = 0;
    assert.ok(Object.isFrozen(p.segments));
    for (const s of Object.values(p.segments)) {
      assert.ok(Object.isFrozen(s));
      assert.equal(s.start, end);
      assert.equal(s.length, s.end - s.start);
      end = s.end;
    }
    assert.equal(p.excitation.length, end);
    assert.ok(end <= fs * 4);
    assert.equal(p.durationSeconds, 3.45);
    assert.ok(
      Math.max(...p.excitation.slice(0, 60000).map(Math.abs)) <= 0.030001,
    );
    for (const name of ["prequiet", "trainingTail", "probeTail"])
      assert.ok(
        p.excitation
          .slice(p.segments[name].start, p.segments[name].end)
          .every((v) => v === 0),
      );
    for (const name of ["training", "probe"]) {
      const s = p.segments[name];
      assert.equal(p.excitation[s.start], 0);
      assert.equal(p.excitation[s.end - 1], 0);
    }
  }
});

test("changing independent probe seed leaves training exactly unchanged", () => {
  const a = generateProtocol(48000, { seed: 11 }),
    b = generateProtocol(48000, { seed: 92 });
  assert.deepEqual(
    a.excitation.slice(0, a.segments.probe.start),
    b.excitation.slice(0, b.segments.probe.start),
  );
  assert.notDeepEqual(
    a.excitation.slice(a.segments.probe.start),
    b.excitation.slice(b.segments.probe.start),
  );
});

test("unseen sparse linear systems recover latency and relative reflection amplitudes", () => {
  for (const [seed, delay, taps] of [
    [
      42,
      2251,
      [
        [0, 0.65],
        [691, -0.22],
        [1703, 0.12],
      ],
    ],
    [
      831,
      6913,
      [
        [0, -0.45],
        [509, 0.17],
        [2191, -0.08],
      ],
    ],
    [
      6291,
      179,
      [
        [0, 0.82],
        [137, 0.18],
        [931, -0.31],
      ],
    ],
  ]) {
    const a = analyzeProtocol(fixture({ seed, delay, taps })),
      h = a.impulseResponse.samples,
      k = a.impulseResponse.directPeakIndex;
    assert.equal(a.alignment.delaySamples, delay);
    for (const [offset, gain] of taps.slice(1))
      near(
        h[k + offset] / h[k],
        gain / taps[0][1],
        0.013,
        "relative band-limited peak gain",
      );
    assert.ok(
      a.validation.nrmse < 0.02,
      `held-out error ${a.validation.nrmse}`,
    );
    assert.ok(a.trainingFit.nrmse < 0.07);
    assert.equal(a.validation.independent, true);
    assert.equal(a.trainingFit.independent, false);
    assert.ok(a.impulseResponse.samples.length <= 48000 * 0.25);
  }
});

test("flat digital gain and device latency are measured without implying distance", () => {
  for (const delay of [0, 600, 11200]) {
    const a = analyzeProtocol(fixture({ delay, taps: [[0, 0.4]] }));
    assert.equal(a.alignment.delaySamples, delay);
    assert.equal(a.alignment.includesDeviceLatency, true);
    const gains = a.transfer.magnitudeDb.filter(
      (_, i) =>
        a.transfer.frequenciesHz[i] > 300 && a.transfer.frequenciesHz[i] < 5000,
    );
    for (const gain of gains)
      near(gain, 20 * Math.log10(0.4), 0.06, "digital transfer gain");
    assert.ok(a.validation.nrmse < 0.02);
  }
});

test("held-out response cannot alter fitted kernel, timing, gain or prediction", () => {
  const original = fixture(),
    changed = { ...original, response: original.response.slice() };
  for (let i = original.segments.probe.start; i < changed.response.length; i++)
    changed.response[i] = Math.sin(i * 0.751) * 0.11;
  const a = analyzeProtocol(original),
    b = analyzeProtocol(changed);
  assert.deepEqual(a.impulseResponse, b.impulseResponse);
  assert.deepEqual(a.alignment, b.alignment);
  assert.deepEqual(a.prediction, b.prediction);
  assert.deepEqual(a.trainingFit, b.trainingFit);
  assert.deepEqual(a.transfer, b.transfer);
  assert.equal(a.validation.startSample, b.validation.startSample);
  assert.equal(a.validation.endSample, b.validation.endSample);
  assert.ok(b.validation.nrmse > 0.9);
  assert.ok(b.quality.flags.includes("held-out-model-mismatch"));
});

test("fixed timing rejects a delayed or attenuated probe without refitting it", () => {
  for (const kind of ["delay", "gain"]) {
    const r = fixture(),
      s = r.segments.probe,
      copy = r.response.slice();
    for (let i = s.start; i < r.response.length; i++)
      r.response[i] =
        kind === "gain"
          ? copy[i] * 0.2
          : i >= s.start + 150
            ? copy[i - 150]
            : 0;
    const a = analyzeProtocol(r);
    assert.ok(a.validation.noiseAdjustedNrmse > 0.5);
    assert.ok(a.quality.flags.includes("held-out-model-mismatch"));
  }
});

test("additive measurement noise matches the prequiet baseline", () => {
  const a = analyzeProtocol(fixture({ noise: 0.0008, seed: 991 }));
  near(a.validation.noiseRms, 0.0008, 0.000025);
  assert.ok(a.validation.nrmse > 0.1);
  assert.ok(a.validation.noiseAdjustedNrmse < 0.07);
  assert.ok(
    Math.abs(a.validation.nrmse - a.validation.noiseBaselineNrmse) < 0.015,
  );
});

test("silent and noise-dominated outputs cannot pass as an accurate experiment", () => {
  for (const options of [
    { silentProbe: true },
    { impulse: [0], noiseRms: 0 },
    { noiseRms: 0.03 },
  ]) {
    const a = analyzeProtocol(createSyntheticRecord(options));
    assert.equal(a.validation.sufficientSignal, false);
    assert.equal(a.validation.noiseAdjustedNrmse, null);
    assert.ok(a.quality.flags.includes("insufficient-dynamic-range"));
    assert.equal(a.quality.usable, false);
  }
});

test("nonlinear fixtures fail independent probe validation even with a reasonable training fit", () => {
  const linear = analyzeProtocol(
    createSyntheticRecord({ seed: 981, probeSeed: 629 }),
  );
  const distorted = analyzeProtocol(
    createSyntheticRecord({ seed: 981, probeSeed: 629, nonlinearity: 1 }),
  );
  assert.ok(linear.validation.nrmse < 0.02);
  assert.ok(distorted.validation.noiseAdjustedNrmse > 0.5);
  assert.ok(distorted.validation.nrmse > distorted.trainingFit.nrmse * 2);
  assert.ok(distorted.quality.flags.includes("held-out-model-mismatch"));
});

test("clipping and reported processing get quality flags; noncanonical silence is rejected", () => {
  const clipped = fixture();
  clipped.response[100] = 1;
  clipped.settings = { echoCancellation: true };
  const a = analyzeProtocol(clipped);
  assert.ok(a.quality.flags.includes("clipping"));
  assert.ok(a.quality.flags.includes("microphone-processing-enabled"));
  const silent = fixture();
  silent.excitation.fill(0);
  silent.response.fill(0);
  assert.throws(() => analyzeProtocol(silent), /canonical ac-id-v1 excitation/);
});

test("analysis supports alternate hardware sample rates and deterministic tail fixture", () => {
  for (const fs of [16000, 44100, 96000]) {
    const r = createSyntheticRecord({
      sampleRate: fs,
      seed: 829,
      probeSeed: 101,
    });
    const a = analyzeProtocol(r);
    assert.equal(a.alignment.delaySamples, r.truth.delaySamples);
    assert.ok(a.validation.nrmse < 0.025);
    assert.ok(a.energyDecay.length > 100);
    assert.ok(a.energyDecay.every((p) => Number.isFinite(p.db)));
    assert.equal(a.provenance, undefined);
    assert.equal(r.provenance, "synthetic");
  }
  assert.deepEqual(
    createSyntheticRecord({ seed: 12 }).response,
    createSyntheticRecord({ seed: 12 }).response,
  );
});

test("rejects malformed samples, source timing and unsupported sizes", () => {
  const r = fixture();
  r.response[0] = NaN;
  assert.throws(() => analyzeProtocol(r), /non-finite/);
  const q = fixture();
  q.segments = {
    ...q.segments,
    training: { ...q.segments.training, start: 0 },
  };
  assert.throws(() => analyzeProtocol(q), /sample indices/);
  assert.throws(() => generateProtocol(8000), /sample rate/);
  assert.throws(() => generateProtocol(48000, { amplitude: 1 }), /amplitude/);
});

test("reflection model beats a training-only gain/delay baseline, while pure gain does not", () => {
  const reflected = analyzeProtocol(fixture());
  assert.ok(reflected.baseline.nrmse > 0.3);
  assert.ok(reflected.validation.improvementDb > 25);
  assert.equal(reflected.validation.improvesOverBaseline, true);
  const flat = analyzeProtocol(fixture({ taps: [[0, 0.6]] }));
  assert.ok(flat.baseline.nrmse < 1e-6);
  assert.equal(flat.validation.improvesOverBaseline, false);
  near(flat.baseline.gain, 0.6, 1e-7);
  assert.equal(flat.baseline.delaySamples, 2251);
  const changed = fixture();
  changed.response.fill(0.1, changed.segments.probe.start);
  const b = analyzeProtocol(changed);
  assert.equal(reflected.baseline.gain, b.baseline.gain);
  assert.equal(reflected.baseline.delaySamples, b.baseline.delaySamples);
});

test("import contract rejects unsupported protocols, normalized-range violations and false quiet metadata", () => {
  const a = fixture();
  a.protocolVersion = "unreviewed-v7";
  assert.throws(() => analyzeProtocol(a), /Unsupported acoustic protocol/);
  const b = fixture();
  b.response[120] = 1.001;
  assert.throws(() => analyzeProtocol(b), /normalized/);
  const c = fixture();
  c.excitation[c.segments.trainingTail.start] = 0.01;
  assert.throws(() => analyzeProtocol(c), /quiet and tail/);
  const d = fixture();
  d.durationSeconds = 3;
  assert.throws(() => analyzeProtocol(d), /duration or frequency/);
  const e = fixture();
  e.highHz = 20000;
  assert.throws(() => analyzeProtocol(e), /duration or frequency/);
  const f = fixture();
  f.segments = structuredClone(f.segments);
  f.segments.training.end--;
  f.segments.training.length--;
  f.segments.trainingTail.start--;
  f.segments.trainingTail.length++;
  assert.throws(() => analyzeProtocol(f), /sample indices/);
});

test("effective band-limited pre-ringing is explicit, including near-zero latency", () => {
  const a = analyzeProtocol(fixture({ delay: 0, taps: [[0, 0.6]] }));
  assert.ok(a.impulseResponse.offsetSamples < 0);
  assert.equal(a.impulseResponse.effectivePreRinging, true);
  assert.ok(
    a.limitations.some((v) =>
      /negative kernel offset.*not a physical pre-echo/.test(v),
    ),
  );
});

test("all retained late probe-tail energy is scored and cannot produce a false pass", () => {
  const record = createSyntheticRecord({ sampleRate: 16000 });
  const initial = analyzeProtocol(record);
  assert.equal(initial.validation.endSample, record.response.length);
  assert.ok(initial.validation.startSample <= record.segments.probe.start);
  assert.equal(
    initial.prediction.samples.length,
    initial.validation.sampleCount,
  );
  // Reproduce the former blind interval after the finite 250 ms impulse support.
  const lateStart =
    record.segments.probe.start +
    initial.impulseResponse.offsetSamples +
    record.segments.probe.length +
    initial.impulseResponse.samples.length -
    1;
  assert.ok(lateStart < record.response.length - 1000);
  for (let i = lateStart; i < record.response.length; i++)
    record.response[i] = 0.25 * Math.sin(i * 0.37);
  const late = analyzeProtocol(record);
  assert.deepEqual(late.impulseResponse, initial.impulseResponse);
  assert.deepEqual(late.alignment, initial.alignment);
  assert.deepEqual(late.prediction, initial.prediction);
  assert.equal(late.baseline.gain, initial.baseline.gain);
  assert.equal(late.baseline.delaySamples, initial.baseline.delaySamples);
  assert.equal(late.validation.startSample, initial.validation.startSample);
  assert.equal(late.validation.endSample, initial.validation.endSample);
  assert.ok(late.validation.nrmse > 0.95);
  assert.ok(late.quality.flags.includes("held-out-model-mismatch"));
  assert.equal(late.quality.usable, false);
});

test("capture-integrity gaps reject otherwise good predictions without silently accepting missing audio", () => {
  for (const captureIntegrity of [
    { missingInputFrames: 128, renderGaps: 0 },
    { missingInputFrames: 0, renderGaps: 2 },
    {
      startFrame: 1024,
      endFrame: 56324,
      missingInputFrames: 0,
      discontinuities: 1,
      gapFrames: 128,
      totalFrames: 55200,
    },
    { missingInputFrames: 0, discontinuities: 0, gapFrames: 128 },
  ]) {
    const record = createSyntheticRecord({ sampleRate: 16000 });
    record.captureIntegrity = captureIntegrity;
    const result = analyzeProtocol(record);
    assert.ok(result.validation.nrmse < 0.025);
    assert.equal(result.quality.usable, false);
    assert.equal(result.quality.accepted, false);
    assert.ok(result.quality.flags.some((flag) => flag.startsWith("capture-")));
    assert.deepEqual(result.quality.captureIntegrity, captureIntegrity);
  }
});

test("a real linear reflection beyond the bounded model support is rejected on the full tail", () => {
  const record = fixture({
    fs: 16000,
    delay: 600,
    taps: [
      [0, 0.65],
      [5200, 0.45],
    ],
    seed: 487,
  });
  const result = analyzeProtocol(record);
  assert.equal(result.alignment.delaySamples, 600);
  assert.ok(result.validation.nrmse > 0.45);
  assert.equal(result.quality.usable, false);
  assert.ok(result.quality.flags.includes("held-out-model-mismatch"));
});

test("versioned source contract rejects narrowband substitutions and false seed/amplitude metadata", () => {
  const narrow = createSyntheticRecord({ sampleRate: 16000 });
  for (const name of ["training", "probe"]) {
    const segment = narrow.segments[name];
    for (let i = segment.start; i < segment.end; i++) {
      narrow.excitation[i] =
        0.02 * Math.sin((2 * Math.PI * 1000 * i) / narrow.sampleRate);
      narrow.response[i] = 0.5 * narrow.excitation[i];
    }
  }
  assert.throws(() => analyzeProtocol(narrow), /canonical ac-id-v1 excitation/);
  for (const [key, value] of [
    ["seed", 123456],
    ["amplitude", 0.031],
    ["seed", undefined],
    ["amplitude", undefined],
    ["seed", -1],
    ["seed", 2 ** 32],
    ["amplitude", 0.041],
  ]) {
    const r = createSyntheticRecord({ sampleRate: 16000 });
    r[key] = value;
    assert.throws(() => analyzeProtocol(r), /canonical|Canonical/);
  }
  const altered = createSyntheticRecord({ sampleRate: 16000 });
  altered.excitation[altered.segments.probe.start + 100] *= 0.999;
  assert.throws(
    () => analyzeProtocol(altered),
    /canonical ac-id-v1 excitation/,
  );
});

test("canonical Float32 source survives JSON numeric-array export and complete integrity metadata", () => {
  const r = createSyntheticRecord({ sampleRate: 16000 });
  r.excitation = JSON.parse(JSON.stringify(Array.from(r.excitation)));
  r.response = JSON.parse(JSON.stringify(Array.from(r.response)));
  r.captureIntegrity = {
    startFrame: 1024,
    endFrame: 56224,
    missingInputFrames: 0,
    discontinuities: 0,
    gapFrames: 0,
    totalFrames: 55200,
  };
  const result = analyzeProtocol(r);
  assert.equal(result.quality.usable, true);
  assert.ok(result.validation.nrmse < 0.025);
});
