/** Finite linear input/output identification. All times share the recorded output timeline. */
const TAU = 2 * Math.PI;
const VERSION = "ac-id-v1";
export const ESTIMATOR_VERSION = "acoustic-linear-v2";
const EPS = 1e-24;
function power2(n) {
  let v = 1;
  while (v < n) v *= 2;
  if (v > 524288) throw new RangeError("Recording exceeds analysis limit.");
  return v;
}
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? TAU : -TAU) / size,
      wr = Math.cos(angle),
      wi = Math.sin(angle),
      half = size / 2;
    for (let base = 0; base < n; base += size) {
      let ar = 1,
        ai = 0;
      for (let j = 0; j < half; j++) {
        const a = base + j,
          b = a + half,
          br = re[b] * ar - im[b] * ai,
          bi = re[b] * ai + im[b] * ar;
        re[b] = re[a] - br;
        im[b] = im[a] - bi;
        re[a] += br;
        im[a] += bi;
        const next = ar * wr - ai * wi;
        ai = ar * wi + ai * wr;
        ar = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
function spectrum(x, n) {
  const re = new Float64Array(n),
    im = new Float64Array(n);
  re.set(x.subarray ? x.subarray(0, n) : x.slice(0, n));
  fft(re, im);
  return { re, im };
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rms(x, start = 0, end = x.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, end - start));
}
function peak(x) {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}
function fade(i, n, count) {
  return (
    Math.sin((Math.min(1, Math.min(i, n - 1 - i) / count) * Math.PI) / 2) ** 2
  );
}
function bandWeight(f, lo, hi) {
  const low = Math.min(1, Math.max(0, (f - lo * 0.8) / (lo * 0.2)));
  const high = Math.min(1, Math.max(0, (hi * 1.05 - f) / (hi * 0.05)));
  return (
    Math.sin((low * Math.PI) / 2) ** 2 * Math.sin((high * Math.PI) / 2) ** 2
  );
}
/** Source amplitude is digital full scale, not calibrated sound pressure. */
export function generateProtocol(sampleRate = 48000, options = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 16000 || sampleRate > 96000)
    throw new RangeError("Use a sample rate from 16000 to 96000 Hz.");
  const seed = (options.seed ?? 917303) >>> 0,
    amplitude = options.amplitude ?? 0.03;
  if (!(amplitude >= 0.005 && amplitude <= 0.04))
    throw new RangeError("Source amplitude must be 0.005–0.04.");
  const lowHz = 150,
    highHz = Math.min(6000, sampleRate * 0.4);
  const segments = {};
  let offset = 0;
  for (const [name, seconds] of [
    ["prequiet", 0.15],
    ["training", 1.5],
    ["trainingTail", 0.6],
    ["probe", 0.6],
    ["probeTail", 0.6],
  ]) {
    const length = Math.round(seconds * sampleRate);
    segments[name] = Object.freeze({
      name,
      start: offset,
      end: offset + length,
      length,
    });
    offset += length;
  }
  const excitation = new Float32Array(offset),
    train = segments.training,
    duration = train.length / sampleRate,
    logRatio = Math.log(highHz / lowHz);
  for (let i = 0; i < train.length; i++) {
    const t = i / sampleRate;
    const phase =
      ((TAU * lowHz * duration) / logRatio) *
      Math.expm1((t * logRatio) / duration);
    excitation[train.start + i] =
      amplitude *
      Math.sin(phase) *
      fade(i, train.length, Math.round(sampleRate * 0.015));
  }
  const probe = segments.probe,
    n = power2(probe.length),
    random = rng(seed),
    re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = random() * 2 - 1;
  fft(re, im);
  for (let i = 0; i < n; i++) {
    const w = bandWeight(
      (Math.min(i, n - i) * sampleRate) / n,
      200,
      Math.min(5500, highHz * 0.92),
    );
    re[i] *= w;
    im[i] *= w;
  }
  fft(re, im, true);
  let max = 0;
  for (let i = 0; i < probe.length; i++) {
    re[i] *= fade(i, probe.length, Math.round(sampleRate * 0.015));
    max = Math.max(max, Math.abs(re[i]));
  }
  for (let i = 0; i < probe.length; i++)
    excitation[probe.start + i] = (re[i] / max) * amplitude;
  excitation[train.start] = 0;
  excitation[train.end - 1] = 0;
  excitation[probe.start] = 0;
  excitation[probe.end - 1] = 0;
  return {
    protocolVersion: VERSION,
    sampleRate,
    excitation,
    segments: Object.freeze(segments),
    durationSeconds: offset / sampleRate,
    seed,
    amplitude,
    lowHz,
    highHz,
  };
}
function checkRecord(record) {
  if (!record || record.protocolVersion !== VERSION)
    throw new Error(`Unsupported acoustic protocol; expected ${VERSION}.`);
  const { sampleRate, excitation: x, response: y, segments: s } = record;
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 16000 ||
    sampleRate > 96000 ||
    !(Array.isArray(x) || ArrayBuffer.isView(x)) ||
    !(Array.isArray(y) || ArrayBuffer.isView(y)) ||
    x.length !== y.length ||
    x.length > sampleRate * 4.1
  )
    throw new Error(
      "Expected equally sized source/response arrays, at most 4.1 seconds.",
    );
  let end = 0;
  for (const [name, seconds] of [
    ["prequiet", 0.15],
    ["training", 1.5],
    ["trainingTail", 0.6],
    ["probe", 0.6],
    ["probeTail", 0.6],
  ]) {
    const a = s?.[name];
    if (
      !a ||
      a.start !== end ||
      !Number.isInteger(a.end) ||
      a.end <= a.start ||
      a.length !== a.end - a.start ||
      a.length !== Math.round(seconds * sampleRate)
    )
      throw new Error(
        "Protocol segments must have contiguous exact sample indices.",
      );
    end = a.end;
  }
  if (end !== x.length)
    throw new Error("Protocol segments do not cover the recording.");
  if (
    (record.durationSeconds !== undefined &&
      (!Number.isFinite(record.durationSeconds) ||
        Math.abs(record.durationSeconds - end / sampleRate) > 1e-12)) ||
    (record.lowHz !== undefined && record.lowHz !== 150) ||
    (record.highHz !== undefined &&
      record.highHz !== Math.min(6000, sampleRate * 0.4))
  )
    throw new Error(
      "Protocol duration or frequency metadata does not match ac-id-v1.",
    );
  if (
    !Number.isInteger(record.seed) ||
    record.seed < 0 ||
    record.seed > 0xffffffff ||
    !Number.isFinite(record.amplitude) ||
    record.amplitude < 0.005 ||
    record.amplitude > 0.04
  )
    throw new Error(
      "Canonical source metadata requires a uint32 seed and amplitude from 0.005 to 0.04.",
    );
  const canonical = generateProtocol(sampleRate, {
    seed: record.seed,
    amplitude: record.amplitude,
  }).excitation;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]))
      throw new Error("Recording contains a non-finite sample.");
    if (Math.abs(x[i]) > 1 || Math.abs(y[i]) > 1)
      throw new Error(
        "Digital source/response samples must be normalized within -1 to 1.",
      );
    const active =
      (i >= s.training.start && i < s.training.end) ||
      (i >= s.probe.start && i < s.probe.end);
    if (!active && x[i] !== 0)
      throw new Error(
        "Protocol quiet and tail segments must have zero source excitation.",
      );
    // Exact Float32 values are part of this versioned protocol. A matching label alone
    // cannot establish sweep coverage or an independent broadband probe.
    if (!Object.is(x[i], canonical[i]))
      throw new Error(
        "Source samples do not match the canonical ac-id-v1 excitation for this seed and amplitude.",
      );
  }
}
function convolveFFT(x, h, length) {
  const n = power2(x.length + h.length - 1),
    a = spectrum(x, n),
    b = spectrum(h, n);
  for (let i = 0; i < n; i++) {
    const r = a.re[i] * b.re[i] - a.im[i] * b.im[i];
    a.im[i] = a.re[i] * b.im[i] + a.im[i] * b.re[i];
    a.re[i] = r;
  }
  fft(a.re, a.im, true);
  return a.re.slice(0, length);
}
function scores(actual, predicted, noiseRms) {
  let e = 0,
    p = 0,
    y = 0;
  for (let i = 0; i < actual.length; i++) {
    e += (actual[i] - predicted[i]) ** 2;
    p += predicted[i] ** 2;
    y += actual[i] ** 2;
  }
  const n = actual.length,
    noisePower = noiseRms ** 2,
    actualPower = y / n,
    signalPower = Math.max(0, actualPower - noisePower),
    errorPower = e / n;
  const nrmse = actualPower > EPS ? Math.sqrt(errorPower / actualPower) : null;
  const sufficientSignal = signalPower > Math.max(noisePower * 3, 1e-14);
  return {
    nrmse,
    noiseBaselineNrmse:
      actualPower > EPS ? Math.sqrt(noisePower / actualPower) : null,
    noiseAdjustedNrmse: sufficientSignal
      ? Math.sqrt(Math.max(0, errorPower - noisePower) / signalPower)
      : null,
    responseRms: Math.sqrt(actualPower),
    predictedRms: Math.sqrt(p / n),
    residualRms: Math.sqrt(errorPower),
    noiseRms,
    snrDb:
      noisePower > EPS && signalPower > 0
        ? 10 * Math.log10(signalPower / noisePower)
        : signalPower > 0
          ? 120
          : null,
    sufficientSignal,
    explainedEnergy: actualPower > EPS ? 1 - errorPower / actualPower : null,
    sampleCount: n,
  };
}
/** The probe response is never used for fitting, alignment, gain selection or scoring-window selection. */
export function analyzeProtocol(record) {
  checkRecord(record);
  const { sampleRate: fs, excitation: source, response, segments: s } = record;
  const lowHz = 150,
    highHz = Math.min(6000, fs * 0.4),
    noiseRms = rms(response, s.prequiet.start, s.prequiet.end);
  const x = source.slice(s.training.start, s.training.end),
    y = response.slice(s.training.start, s.trainingTail.end),
    n = power2(y.length + 1);
  const X = spectrum(x, n),
    Y = spectrum(y, n),
    cr = new Float64Array(n),
    ci = new Float64Array(n),
    hr = new Float64Array(n),
    hi = new Float64Array(n);
  let maxPower = 0;
  for (let i = 0; i < n; i++)
    maxPower = Math.max(maxPower, X.re[i] ** 2 + X.im[i] ** 2);
  const regularization = maxPower * 1e-5 + EPS;
  for (let i = 0; i < n; i++) {
    const power = X.re[i] ** 2 + X.im[i] ** 2,
      re = Y.re[i] * X.re[i] + Y.im[i] * X.im[i],
      im = Y.im[i] * X.re[i] - Y.re[i] * X.im[i];
    cr[i] = re;
    ci[i] = im;
    const w = bandWeight((Math.min(i, n - i) * fs) / n, lowHz, highHz);
    hr[i] = (re / (power + regularization)) * w;
    hi[i] = (im / (power + regularization)) * w;
  }
  fft(cr, ci, true);
  fft(hr, hi, true);
  const maxDelay = Math.min(
    Math.round(fs * 0.3),
    s.trainingTail.length - Math.round(fs * 0.25),
  );
  let correlationLagSamples = 0,
    correlationPeak = 0;
  for (let i = 0; i <= maxDelay; i++)
    if (Math.abs(cr[i]) > correlationPeak) {
      correlationPeak = Math.abs(cr[i]);
      correlationLagSamples = i;
    }
  // Refine locally on the inverse-filtered response; no held-out samples enter this estimate.
  let dominant = correlationLagSamples,
    hPeak = 0;
  for (
    let i = Math.max(0, correlationLagSamples - Math.round(fs * 0.02));
    i <= Math.min(maxDelay, correlationLagSamples + Math.round(fs * 0.02));
    i++
  )
    if (Math.abs(hr[i]) > hPeak) {
      dominant = i;
      hPeak = Math.abs(hr[i]);
    }
  // Keep earlier significant arrivals, plus a short lead for the band-limited impulse's ringing.
  let first = dominant;
  for (let i = 0; i < dominant; i++)
    if (Math.abs(hr[i]) > hPeak * 0.15) {
      first = i;
      break;
    }
  const offsetSamples = first - Math.round(fs * 0.025),
    irLength = Math.round(fs * 0.25),
    impulse = Float64Array.from(
      { length: irLength },
      (_, i) => hr[(offsetSamples + i + n) % n],
    );
  // A brief terminal taper limits truncation artifacts; the tested model remains a finite input/output filter.
  const taper = Math.round(fs * 0.01);
  for (let i = Math.max(0, impulse.length - taper); i < impulse.length; i++)
    impulse[i] *=
      0.5 * (1 + Math.cos((Math.PI * (i - (impulse.length - taper))) / taper));
  const trainPrediction = convolveFFT(
      x,
      impulse,
      x.length + impulse.length - 1,
    ),
    probe = source.slice(s.probe.start, s.probe.end),
    probeModel = convolveFFT(probe, impulse, probe.length + impulse.length - 1);
  // Score the complete retained probe and tail, including samples beyond finite model support.
  // The window starts at protocol probe onset (or the earlier train-derived pre-ringing offset).
  // A short finite filter must not escape a late echo merely by stopping its scoring window.
  const trainStart = s.training.start + offsetSamples,
    probeModelStart = s.probe.start + offsetSamples,
    probeStart = Math.min(s.probe.start, probeModelStart);
  const trainCount = Math.min(
      trainPrediction.length,
      s.trainingTail.end - trainStart,
    ),
    probeCount = response.length - probeStart;
  const probePrediction = new Float64Array(probeCount);
  const modelOffset = probeModelStart - probeStart;
  probePrediction.set(
    probeModel.subarray(
      0,
      Math.min(probeModel.length, probeCount - modelOffset),
    ),
    modelOffset,
  );
  const trainingFit = scores(
    response.slice(trainStart, trainStart + trainCount),
    trainPrediction.subarray(0, trainCount),
    noiseRms,
  );
  const probeActual = response.slice(probeStart, probeStart + probeCount);
  const validation = scores(
    probeActual,
    probePrediction.subarray(0, probeCount),
    noiseRms,
  );
  // Fair simple competitor: a single delay and scalar gain estimated from training alone.
  let gainNumerator = 0,
    gainDenominator = 0;
  for (let i = 0; i < x.length; i++) {
    gainNumerator += x[i] * y[i + dominant];
    gainDenominator += x[i] ** 2;
  }
  const baselineGain = gainNumerator / Math.max(gainDenominator, EPS),
    baselinePrediction = new Float64Array(probeCount);
  for (let i = 0; i < probeCount; i++) {
    const j = probeStart + i - s.probe.start - dominant;
    if (j >= 0 && j < probe.length)
      baselinePrediction[i] = baselineGain * probe[j];
  }
  const baseline = {
    ...scores(probeActual, baselinePrediction, noiseRms),
    gain: baselineGain,
    delaySamples: dominant,
    estimatedFrom: "training-only",
  };
  validation.improvementDb =
    validation.residualRms > 1e-12 && baseline.residualRms > 1e-12
      ? 20 * Math.log10(baseline.residualRms / validation.residualRms)
      : null;
  validation.improvesOverBaseline =
    baseline.residualRms > validation.residualRms * 1.05;
  const tfN = power2(impulse.length),
    H = spectrum(impulse, tfN),
    frequenciesHz = [],
    magnitudeDb = [];
  for (let f = lowHz; f <= highHz; f *= 2 ** (1 / 36)) {
    const k = Math.round((f * tfN) / fs);
    frequenciesHz.push((k * fs) / tfN);
    magnitudeDb.push(
      20 * Math.log10(Math.max(1e-12, Math.hypot(H.re[k], H.im[k]))),
    );
  }
  const energyDecay = [];
  let remaining = 0;
  for (const v of impulse) remaining += v * v;
  const total = remaining;
  for (let i = 0; i < impulse.length; i++) {
    if (i % Math.max(1, Math.round(fs / 1000)) === 0)
      energyDecay.push({
        timeSeconds: (offsetSamples + i - dominant) / fs,
        db: 10 * Math.log10(Math.max(1e-12, remaining / Math.max(total, EPS))),
      });
    remaining = Math.max(0, remaining - impulse[i] ** 2);
  }
  let clippedSamples = 0;
  for (const v of response) if (Math.abs(v) >= 0.999) clippedSamples++;
  const flags = [];
  if (clippedSamples) flags.push("clipping");
  if (rms(x) < 1e-4 || maxPower < 1e-10) flags.push("poor-excitation");
  if (!validation.sufficientSignal || !trainingFit.sufficientSignal)
    flags.push("insufficient-dynamic-range");
  if (dominant >= maxDelay - Math.round(fs * 0.005))
    flags.push("arrival-near-search-limit");
  if (
    validation.noiseAdjustedNrmse !== null &&
    validation.noiseAdjustedNrmse > 0.35
  )
    flags.push("held-out-model-mismatch");
  const captureIntegrity = record.captureIntegrity ?? null;
  if (captureIntegrity?.missingInputFrames > 0)
    flags.push("capture-input-missing");
  if (
    captureIntegrity?.renderGaps > 0 ||
    captureIntegrity?.discontinuities > 0 ||
    captureIntegrity?.gapFrames > 0
  )
    flags.push("capture-render-gaps");
  const settings = record.settings ?? record.processingSettings ?? null;
  if (
    settings &&
    ["echoCancellation", "noiseSuppression", "autoGainControl"].some(
      (k) => settings[k] === true,
    )
  )
    flags.push("microphone-processing-enabled");
  return {
    protocolVersion: VERSION,
    estimatorVersion: ESTIMATOR_VERSION,
    sampleRate: fs,
    method:
      "training-only regularized FFT inverse; fixed finite filter; independent probe validation",
    bandHz: [lowHz, highHz],
    regularization,
    alignment: {
      delaySamples: dominant,
      delaySeconds: dominant / fs,
      correlationLagSamples,
      includesDeviceLatency: true,
      estimatedFrom: "training-only",
    },
    impulseResponse: {
      samples: impulse,
      offsetSamples,
      directPeakIndex: dominant - offsetSamples,
      durationSeconds: impulse.length / fs,
      bandLimited: true,
      effectivePreRinging: true,
      leadSeconds: (dominant - offsetSamples) / fs,
    },
    transfer: {
      frequenciesHz,
      magnitudeDb,
      unit: "dB digital input/output gain, uncalibrated",
    },
    energyDecay,
    validation: {
      ...validation,
      startSample: probeStart,
      endSample: probeStart + probeCount,
      independent: true,
    },
    trainingFit: {
      ...trainingFit,
      startSample: trainStart,
      endSample: trainStart + trainCount,
      independent: false,
    },
    prediction: {
      samples: probePrediction.subarray(0, probeCount),
      startSample: probeStart,
    },
    baseline,
    quality: {
      flags,
      usable: flags.length === 0,
      accepted: flags.length === 0,
      clippedSamples,
      noiseRms,
      sourcePeak: peak(source),
      captureIntegrity,
      settings,
      processingStatus: settings ? "reported-settings" : "unknown",
    },
    limitations: [
      "Measures the speaker, microphone, room and device processing together.",
      "Finite band-limited impulse response; no absolute sound level, distance or reverberation-time claim.",
      "Band limiting creates effective ringing before the dominant arrival. A negative kernel offset is this mathematical pre-ringing, not a physical pre-echo or acausal hardware.",
      "Validation tests this probe and operating level; a passing score is not universal linearity.",
    ],
  };
}
/** Independent direct convolution for fixtures and numerical reference checks. */
export function convolveTimeDomain(signal, kernel) {
  const out = new Float64Array(signal.length + kernel.length - 1);
  // Sparse fixtures make this independent oracle fast without using the production FFT.
  for (let j = 0; j < kernel.length; j++)
    if (kernel[j] !== 0)
      for (let i = 0; i < signal.length; i++)
        out[i + j] += signal[i] * kernel[j];
  return out;
}
/** Synthetic, explicitly labelled fixtures; never substitute these for a microphone measurement. */
export function createSyntheticRecord(options = {}) {
  const protocol = generateProtocol(options.sampleRate ?? 48000, {
      seed: options.probeSeed ?? 317,
      amplitude: options.amplitude ?? 0.03,
    }),
    fs = protocol.sampleRate,
    random = rng(options.seed ?? 113);
  const delaySamples = options.delaySamples ?? Math.round(fs * 0.037),
    impulse = options.impulse
      ? Float64Array.from(options.impulse)
      : (() => {
          const h = new Float64Array(Math.round(fs * 0.16));
          h[0] = options.gain ?? 0.72;
          h[Math.round(fs * 0.0113)] = 0.24;
          h[Math.round(fs * 0.0347)] = -0.16;
          for (let j = 0; j < 90; j++) {
            const t = 0.042 + random() * 0.105;
            h[Math.round(t * fs)] +=
              (random() * 2 - 1) * 0.025 * Math.exp(-t / 0.06);
          }
          return h;
        })();
  const kernel = new Float64Array(delaySamples + impulse.length);
  kernel.set(impulse, delaySamples);
  const output = convolveTimeDomain(protocol.excitation, kernel),
    response = new Float32Array(protocol.excitation.length),
    noiseRms = options.noiseRms ?? 0.000025,
    nonlinear = options.nonlinearity ?? 0;
  // Strong cubic distortion has level-dependent behavior; withheld broadband content tests it.
  for (let i = 0; i < response.length; i++) {
    const v = output[i] ?? 0;
    response[i] =
      v +
      (nonlinear * v ** 3) / 0.02 ** 2 +
      noiseRms * Math.sqrt(12) * (random() - 0.5);
  }
  if (options.silentProbe)
    response.fill(
      0,
      protocol.segments.probe.start,
      protocol.segments.probeTail.end,
    );
  return {
    ...protocol,
    response,
    settings: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    provenance: "synthetic",
    truth: { delaySamples, impulse, noiseRms, nonlinearity: nonlinear },
  };
}
