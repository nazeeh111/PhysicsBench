import { generateProtocol } from "./acoustics.js";
import { captureAcousticProtocol } from "./acquisition.js";
import {
  encodeSamples,
  decodeSamples,
  recordingFingerprint,
} from "./experiment.js";
const make = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const pct = (v) =>
  Number.isFinite(v) ? `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%` : "unresolved";
const num = (v, d = 3) =>
  Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : "unresolved";
const LABELS = {
  clipping: "The recording clipped. Lower system volume or input gain.",
  "poor-excitation": "The emitted source is too weak or missing.",
  "insufficient-dynamic-range":
    "The test signal is not resolved above ambient noise.",
  "arrival-near-search-limit":
    "Arrival is near the latency search bound. The recording may not fit this protocol.",
  "held-out-model-mismatch":
    "A fixed linear model does not explain this independent sound at this level.",
  "microphone-processing-enabled":
    "The browser reports active microphone processing. This can change the signal path.",
  "interrupted-capture":
    "The audio input was absent or its render timeline was interrupted. Reacquire before interpreting this recording.",
  "capture-input-missing":
    "Audio input was missing during acquisition; zeros are marked as missing, not treated as valid silence.",
  "capture-render-gaps":
    "The audio render timeline was interrupted. Reacquire before interpreting this recording.",
};
export function mountAcoustic(host) {
  const root = make("section", undefined, "acoustic-lab");
  root.innerHTML = `
 <div class="investigation-heading"><div><p class="eyebrow">ACOUSTIC SYSTEM IDENTIFICATION</p><h1>Can one sound predict another?</h1><p>A generated reference opens automatically. A sweep teaches the model; a separate sound tests it. Change the specimen to challenge the result.</p></div><span class="source-tag" data-source-tag>SYNTHETIC SPECIMEN</span></div>
 <div class="protocol-strip"><span><b>01</b> Emit a known sweep</span><span><b>02</b> Learn a finite filter</span><span><b>03</b> Predict a separate probe</span><span><b>04</b> Inspect the error</span></div>
 <div class="acoustic-workspace">
 <section class="evidence-card"><p class="eyebrow">HELD-OUT EVIDENCE</p><h2 id="acoustic-verdict" tabindex="-1" data-verdict aria-live="polite">Analyzing reference…</h2><div class="evidence-score"><strong data-error>—</strong><span>normalized prediction error</span></div><div class="evidence-pairs"><div><span>Trivial delay + gain</span><strong data-baseline>—</strong></div><div><span>Ambient contribution</span><strong data-noise>—</strong></div><div><span>Training fit</span><strong data-training>—</strong></div><div><span>Probe SNR</span><strong data-snr>—</strong></div></div><p data-verdict-detail class="small-note"></p><ul data-flags class="quality-flags"></ul><a class="specimen-jump" href="#acoustic-specimen">Try a different signal path ↓</a></section>
 <div class="acoustic-main">
 <section class="instrument-surface"><div class="chart-toolbar"><div><h2>Recovered signal path</h2><p>Band-limited response, relative to its dominant arrival</p></div><span data-band></span></div><canvas data-ir width="1200" height="300" role="img" aria-label="Recovered impulse response. Relative arrival times and normalized amplitude."></canvas><div class="ir-summary"><span data-delay></span><span>No absolute distance or room-only inference</span></div></section>
 <section class="instrument-surface"><div class="chart-toolbar"><div><h2>The independent test</h2><p>Recorded probe versus the prediction fixed by training</p></div><div class="chart-legend"><span class="cyan-dot">Recorded</span><span class="amber-dot">Predicted</span></div></div><div class="test-window-controls"><label>Inspect test window<select data-test-view><option value="full">Complete scored interval</option><option value="0.02">20 ms detail</option><option value="0.005">5 ms detail</option></select></label><label>Window start (ms)<input data-test-start type="range" min="0" max="1000" step="1" value="0" disabled></label><output data-test-window>Full interval</output></div><canvas data-prediction width="1200" height="240" role="img" aria-label="Independent probe recording and training-only model prediction"></canvas><canvas data-residual width="1200" height="125" role="img" aria-label="Unexplained residual from the independent probe"></canvas><p class="chart-footnote">The probe never sets the model, gain, alignment or scoring window. The residual uses the same amplitude scale as the recording.</p></section>
 <div class="acoustic-bottom"><section class="instrument-surface"><div class="chart-toolbar"><h2>Transfer magnitude</h2><span>Relative digital gain</span></div><canvas data-transfer width="600" height="240" role="img" aria-label="Frequency-dependent digital input output gain in the excited band"></canvas></section><section class="instrument-surface"><div class="chart-toolbar"><h2>Remaining impulse energy</h2><span>Finite captured response</span></div><canvas data-decay width="600" height="240" role="img" aria-label="Remaining energy of the finite impulse response, not an RT60 measurement"></canvas></section></div>
 </div><aside class="acoustic-inspector">

 <section class="control-card"><h2>Challenge the assumption</h2><label class="stack-field">Specimen<select id="acoustic-specimen" data-specimen><option value="reflective">Reflective path · linear</option><option value="damped">Damped path · linear</option><option value="nonlinear">Nonlinear speaker · challenge</option><option value="silent">Silent probe · failure control</option></select></label><button data-repeat type="button" class="primary">Run another virtual trial</button><p data-trial-outcome class="small-note" role="status"></p><a class="specimen-jump" href="#acoustic-verdict">Inspect the prediction result ↑</a><p class="small-note">Generated input/output data, processed by the same estimator used for recordings. Each trial gets a fresh noise realization.</p><hr><button data-capture-open type="button">Measure this laptop</button><p class="small-note">An opt-in 3.45-second sweep and independent test signal. Measures speakers, microphone, room and processing together.</p><p data-progress class="notice" role="status"></p><button data-cancel type="button" hidden>Cancel acquisition</button></section>
 <section class="control-card"><h2>Experiment record</h2><label class="stack-field">Condition<input data-condition maxlength="80" value="Reflective reference" placeholder="e.g. curtains open"></label><label class="stack-field">Setup note<textarea data-notes maxlength="1200" placeholder="What stayed fixed? What changed?"></textarea></label><div class="toolbar"><button data-save type="button" class="primary">Save this run</button><button data-wave type="button">Export recording WAV</button></div><p class="small-note">Raw source and response are retained. Saved investigations reopen and recompute their analysis.</p><p data-message class="notice" role="status"></p></section>
 </aside></div>
 <details class="method-details"><summary>What this experiment establishes</summary><div class="method-grid"><article><h3>The model</h3><p>A 250 ms band-limited finite impulse response is learned only from the training sweep. Latency is learned from that same training data. The model predicts a separate band-limited random probe without refitting.</p><p>The learned delay includes hardware and browser timing. It does not measure distance. Transfer magnitude includes speakers and microphone; it is not a calibrated room response or dB SPL measurement.</p></article><article><h3>A result can fail</h3><p>Clipping, insufficient signal, active microphone processing and poor held-out prediction are shown explicitly. A passing test only concerns this recording, frequency band and level. A failed test does not identify its cause.</p><p>Try the nonlinear specimen or silent-probe control. A useful estimator must reject those, even if the training fit looks convincing.</p></article><article><h3>Repeated comparisons</h3><p>Save two or more separate acquisitions per named condition, with the same setup and protocol. Select them in Saved runs to compare late impulse energy with observed repeat-to-repeat variation. Resaving one capture does not create a new repetition.</p><p>Reference trials are simulated evidence. Real recordings require your own permission, geometry control and acquisition checks.</p></article></div></details>
 <dialog data-capture-dialog aria-labelledby="capture-heading"><div class="dialog-top"><p class="eyebrow">LOCAL ACQUISITION</p><button data-capture-close type="button" aria-label="Close acquisition dialog">×</button></div><h2 id="capture-heading">Measure the complete signal path</h2><p>This will request your microphone and emit a 3.45-second sequence through your current speakers: a quiet sweep, a pause, and a separate test signal. Digital output peaks at 3%; physical loudness still depends on system volume.</p><p>Use a comfortable system volume, keep the laptop and room still, and avoid talking. No sound is emitted until you choose Begin below. Microphone input is not monitored through speakers.</p><p>Browser processing may limit the experiment. The recording stays on this device. Cancel or switching investigations stops acquisition.</p><div class="toolbar"><button data-begin type="button" class="primary">Begin microphone + test sound</button><button data-capture-abort type="button">Return to reference</button></div></dialog>`;
  host.append(root);
  const $ = (s) => root.querySelector(s),
    life = new AbortController(),
    on = (n, type, fn) => n.addEventListener(type, fn, { signal: life.signal });
  let record = null,
    analysis = null,
    acquisition = null,
    sequence = 0,
    revision = 0,
    runId = null,
    disposed = false,
    busy = false;
  const worker = new Worker(new URL("./acoustic-worker.js", import.meta.url), {
      type: "module",
    }),
    pending = new Map();
  const setupId = crypto.randomUUID();
  let loadedSetupId = setupId;
  worker.onmessage = (event) => {
    const reply = event.data,
      job = pending.get(reply.id);
    if (!job) return;
    pending.delete(reply.id);
    if (reply.error) job.reject(new Error(reply.error));
    else job.resolve(reply);
  };
  worker.onerror = () => {
    for (const job of pending.values())
      job.reject(
        new Error(
          "Scientific analysis worker failed. Previous experiment retained.",
        ),
      );
    pending.clear();
  };
  const solve = (type, options, raw) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, options, record: raw });
    });
  function message(text, error = false) {
    $("[data-message]").textContent = text;
    $("[data-message]").className = error ? "error" : "notice";
  }
  function setBusy(value, text) {
    busy = value;
    $("[data-repeat]").disabled = value;
    $("[data-specimen]").disabled = value;
    $("[data-save]").disabled = value || !record;
    $("[data-wave]").disabled = value || !record;
    $("[data-capture-open]").disabled = value;
    $("[data-progress]").textContent = text || "";
  }
  function fixtureOptions() {
    const mode = $("[data-specimen]").value;
    const h = new Float64Array(2400);
    h[0] = 0.72;
    h[181] = mode === "damped" ? 0.06 : 0.24;
    h[555] = mode === "damped" ? -0.025 : -0.16;
    for (let j = 0; j < 60; j++) {
      const at = 700 + Math.floor(j * 27);
      h[at] =
        (mode === "damped" ? 0.002 : 0.012) *
        Math.sin(j * 2.31) *
        Math.exp(-j / 35);
    }
    return {
      sampleRate: 16000,
      seed: ++sequence + 1301,
      impulse: h,
      nonlinearity: mode === "nonlinear" ? 4 : 0,
      silentProbe: mode === "silent",
    };
  }
  async function reference() {
    const ticket = ++revision;
    setBusy(true, "Estimating from the sweep; the probe remains withheld…");
    try {
      const mode = $("[data-specimen]").value;
      const answer = await solve("synthetic", fixtureOptions());
      if (disposed || ticket !== revision) return;
      const nextRecord = {
        ...answer.record,
        source: "simulation",
        acquisitionId: crypto.randomUUID(),
        specimen: mode,
      };
      nextRecord.evidenceHash = await recordingFingerprint(
        nextRecord.excitation,
        nextRecord.response,
        nextRecord.sampleRate,
      );
      if (disposed || ticket !== revision) return;
      record = nextRecord;
      analysis = answer.analysis;
      loadedSetupId = setupId;
      runId = record.acquisitionId;
      $("[data-condition]").value =
        mode === "damped"
          ? "Damped reference"
          : mode === "nonlinear"
            ? "Nonlinear challenge"
            : mode === "silent"
              ? "Silent control"
              : "Reflective reference";
      $("[data-notes]").value =
        "Generated specimen; no physical microphone measurement.";
      render();
      message(
        "Fresh virtual acquisition. Source and response are available in the run record.",
      );
    } catch (error) {
      if (ticket === revision) message(error.message, true);
    } finally {
      if (ticket === revision) setBusy(false);
    }
  }
  function accept(raw, result) {
    record = raw;
    analysis = result;
    runId = raw.acquisitionId || crypto.randomUUID();
    if (["reflective", "damped", "nonlinear", "silent"].includes(raw.specimen))
      $("[data-specimen]").value = raw.specimen;
    render();
  }
  function render() {
    if (!analysis) return;
    const v = analysis.validation,
      flags = analysis.quality.flags,
      accepted = analysis.quality.usable;
    $("[data-source-tag]").textContent = record.imported
      ? record.source === "microphone"
        ? "IMPORTED · MICROPHONE SOURCE DECLARED"
        : "IMPORTED · SYNTHETIC SPECIMEN"
      : record.source === "microphone"
        ? "LOCAL MICROPHONE RECORDING"
        : "SYNTHETIC SPECIMEN";
    $("[data-source-tag]").className =
      "source-tag " + (record.source === "microphone" ? "measured" : "");
    $("[data-verdict]").textContent = accepted
      ? "Prediction survives this test"
      : flags.includes("held-out-model-mismatch")
        ? "Linear model rejected"
        : "Evidence is inconclusive";
    $("[data-verdict]").dataset.verdict = accepted ? "pass" : "fail";
    $("[data-trial-outcome]").textContent = `${$("[data-verdict]").textContent}. Prediction error: ${pct(v.nrmse)}.`;
    $("[data-error]").textContent = pct(v.nrmse);
    $("[data-training]").textContent = pct(analysis.trainingFit.nrmse);
    $("[data-noise]").textContent = pct(v.noiseBaselineNrmse);
    $("[data-baseline]").textContent = pct(analysis.baseline?.nrmse);
    $("[data-snr]").textContent = Number.isFinite(v.snrDb)
      ? `${v.snrDb.toFixed(1)} dB`
      : "unresolved";
    $("[data-verdict-detail]").textContent = accepted
      ? "The fixed filter explains this probe within an exploratory screening rule: noise-adjusted error ≤35%, resolved signal, no clipping, capture gaps or reported processing. This is not a calibrated acceptance threshold."
      : "The result is withheld or rejected. Inspect the flags before interpreting a response curve.";
    $("[data-flags]").replaceChildren(
      ...flags.map((f) => make("li", LABELS[f] || f)),
    );
    $("[data-band]").textContent =
      `${analysis.bandHz[0]}–${analysis.bandHz[1]} Hz · ${record.sampleRate.toLocaleString()} samples/s`;
    $("[data-delay]").textContent =
      `Dominant arrival ${(analysis.alignment.delaySeconds * 1000).toFixed(2)} ms after emission; includes device latency`;
    drawAll();
    $("[data-save]").disabled = false;
    $("[data-wave]").disabled = false;
  }
  function chart(
    canvas,
    {
      x0 = 0,
      x1 = 1,
      y0 = -1,
      y1 = 1,
      xlabel = "",
      ylabel = "",
      logX = false,
    } = {},
  ) {
    const c = canvas.getContext("2d"),
      w = Math.max(200, Math.round(canvas.getBoundingClientRect().width)),
      h = canvas.hasAttribute("data-ir")
        ? Math.max(200, Math.min(300, w * 0.3))
        : canvas.hasAttribute("data-residual")
          ? 140
          : 220,
      ratio = Math.min(2, window.devicePixelRatio || 1),
      left = 65,
      right = w - 20,
      top = 22,
      bottom = h - 40;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.fillStyle = "#10171c";
    c.fillRect(0, 0, w, h);
    c.font = "11px ui-monospace, monospace";
    c.lineWidth = 1;
    const X = (x) =>
        left +
        (logX ? Math.log(x / x0) / Math.log(x1 / x0) : (x - x0) / (x1 - x0)) *
          (right - left),
      Y = (y) =>
        bottom - ((y - y0) / Math.max(1e-12, y1 - y0)) * (bottom - top);
    for (let i = 0; i <= 4; i++) {
      const x = logX ? x0 * (x1 / x0) ** (i / 4) : x0 + ((x1 - x0) * i) / 4,
        y = y0 + ((y1 - y0) * i) / 4;
      c.strokeStyle = "#2a363d";
      c.beginPath();
      c.moveTo(left, Y(y));
      c.lineTo(right, Y(y));
      c.moveTo(X(x), top);
      c.lineTo(X(x), bottom);
      c.stroke();
      c.fillStyle = "#a6bbc4";
      c.textAlign = "right";
      c.fillText(num(y), left - 10, Y(y) + 4);
      c.textAlign = "center";
      c.fillText(num(x), X(x), bottom + 22);
    }
    c.fillStyle = "#a6bbc4";
    c.textAlign = "left";
    c.fillText(ylabel, left, 13);
    c.textAlign = "right";
    c.fillText(xlabel, right, h - 4);
    return { c, X, Y, left, right, top, bottom };
  }
  function path(
    plot,
    values,
    xAt,
    color,
    rangeStart = 0,
    rangeEnd = values.length,
  ) {
    const { c, X, Y, left, right, top, bottom } = plot;
    c.save();
    c.beginPath();
    c.rect(left, top, right - left, bottom - top);
    c.clip();
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.beginPath();
    const stride = Math.max(
      1,
      Math.floor((rangeEnd - rangeStart) / (right - left)),
    );
    for (let i = rangeStart; i < rangeEnd; i += stride) {
      const x = X(xAt(i));
      let low = Infinity,
        high = -Infinity;
      for (let j = i; j < Math.min(rangeEnd, i + stride); j++) {
        low = Math.min(low, values[j]);
        high = Math.max(high, values[j]);
      }
      if (stride === 1) {
        if (i === rangeStart) c.moveTo(x, Y(values[i]));
        else c.lineTo(x, Y(values[i]));
      } else {
        c.moveTo(x, Y(low));
        c.lineTo(x, Y(high));
      }
    }
    c.stroke();
    c.restore();
  }
  function drawAll() {
    if (!analysis) return;
    const ir = analysis.impulseResponse,
      s = ir.samples,
      peak = Math.max(1e-9, ...Array.from(s, Math.abs)),
      dominant = analysis.alignment.delaySamples;
    const x0 = ((ir.offsetSamples - dominant) / record.sampleRate) * 1000,
      x1 =
        ((ir.offsetSamples + s.length - dominant) / record.sampleRate) * 1000;
    let p = chart($("[data-ir]"), {
      x0,
      x1,
      y0: -1.1,
      y1: 1.1,
      xlabel: "Relative arrival time (ms)",
      ylabel: "Normalized response",
    });
    path(
      p,
      Array.from(s, (x) => x / peak),
      (i) => ((ir.offsetSamples + i - dominant) / record.sampleRate) * 1000,
      "#dfe995",
    );
    const pred = analysis.prediction.samples,
      start = analysis.prediction.startSample,
      n = pred.length,
      actual = record.response.subarray(start, start + n),
      residual = Float32Array.from(actual, (v, i) => v - pred[i]);
    let max = 1e-7;
    for (const values of [actual, pred])
      for (const value of values) max = Math.max(max, Math.abs(value));
    const view = $("[data-test-view]").value,
      seconds = view === "full" ? n / record.sampleRate : Number(view),
      lastStart = Math.max(0, n / record.sampleRate - seconds);
    $("[data-test-start]").max = String(lastStart * 1000);
    $("[data-test-start]").disabled = view === "full";
    const begin =
        view === "full"
          ? 0
          : Math.floor(
              Math.min(lastStart, Number($("[data-test-start]").value) / 1000) *
                record.sampleRate,
            ),
      end = Math.min(n, begin + Math.round(seconds * record.sampleRate));
    $("[data-test-window]").textContent =
      view === "full"
        ? "Full scored interval"
        : `${((begin / record.sampleRate) * 1000).toFixed(1)}–${((end / record.sampleRate) * 1000).toFixed(1)} ms · score unchanged`;
    p = chart($("[data-prediction]"), {
      x0: begin / record.sampleRate,
      x1: end / record.sampleRate,
      y0: -max * 1.08,
      y1: max * 1.08,
      xlabel: "Time since fixed test-window start (s)",
      ylabel: "Digital amplitude",
    });
    path(p, actual, (i) => i / record.sampleRate, "#63d9cc", begin, end);
    path(p, pred, (i) => i / record.sampleRate, "#ffb15c", begin, end);
    p = chart($("[data-residual]"), {
      x0: begin / record.sampleRate,
      x1: end / record.sampleRate,
      y0: -max * 1.08,
      y1: max * 1.08,
      xlabel: "Same amplitude scale as recording",
      ylabel: "Residual",
    });
    path(p, residual, (i) => i / record.sampleRate, "#d8909b", begin, end);
    const tf = analysis.transfer,
      lo = Math.max(-70, Math.min(...tf.magnitudeDb)),
      hi = Math.max(0, ...tf.magnitudeDb) + 3;
    p = chart($("[data-transfer]"), {
      x0: analysis.bandHz[0],
      x1: analysis.bandHz[1],
      y0: lo - 3,
      y1: hi,
      xlabel: "Frequency (Hz, logarithmic)",
      ylabel: "Digital gain (dB)",
      logX: true,
    });
    path(p, tf.magnitudeDb, (i) => tf.frequenciesHz[i], "#63d9cc");
    const decay = analysis.energyDecay;
    p = chart($("[data-decay]"), {
      x0: Math.max(0, decay[0]?.timeSeconds || 0),
      x1: Math.max(0.01, decay.at(-1)?.timeSeconds || 0.25),
      y0: -60,
      y1: 0,
      xlabel: "Relative time (s)",
      ylabel: "Remaining energy (dB)",
    });
    path(
      p,
      decay.map((x) => x.db),
      (i) => decay[i].timeSeconds,
      "#dfe995",
    );
  }
  function stopCapture() {
    if (acquisition) {
      acquisition.cancel();
      acquisition = null;
    }
    $("[data-cancel]").hidden = true;
  }
  let chartWidth = 0;
  const resizeCharts = new ResizeObserver(() => {
    const width = Math.round($(".acoustic-main").getBoundingClientRect().width);
    if (width > 0 && width !== chartWidth && !disposed) {
      chartWidth = width;
      drawAll();
    }
  });
  resizeCharts.observe($(".acoustic-main"));
  on($("[data-test-view]"), "change", drawAll);
  on($("[data-test-start]"), "input", drawAll);
  on($("[data-prediction]"), "click", (event) => {
    const bounds = event.currentTarget.getBoundingClientRect(),
      fraction = Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / bounds.width),
      );
    $("[data-test-view]").value = "0.02";
    $("[data-test-start]").value = String(
      Math.max(
        0,
        ((fraction * analysis.prediction.samples.length) / record.sampleRate) *
          1000 -
          10,
      ),
    );
    drawAll();
  });
  on($("[data-repeat]"), "click", reference);
  on($("[data-specimen]"), "change", reference);
  on($("[data-capture-open]"), "click", () =>
    $("[data-capture-dialog]").showModal(),
  );
  for (const key of ["[data-capture-close]", "[data-capture-abort]"])
    on($(key), "click", () => $("[data-capture-dialog]").close());
  on($("[data-begin]"), "click", async () => {
    if (acquisition) return;
    $("[data-capture-dialog]").close();
    const ticket = ++revision;
    setBusy(true, "Waiting for microphone permission…");
    $("[data-cancel]").hidden = false;
    const operation = captureAcousticProtocol(generateProtocol, (state) => {
      $("[data-progress]").textContent =
        state.stage === "permission"
          ? "Waiting for microphone permission…"
          : `Recording the source and response: ${Math.round(state.fraction * 100)}%`;
    });
    acquisition = operation;
    try {
      const raw = await operation.promise;
      if (disposed || ticket !== revision) return;
      raw.settings = raw.captureSettings;
      raw.acquisitionId = crypto.randomUUID();
      raw.evidenceHash = await recordingFingerprint(
        raw.excitation,
        raw.response,
        raw.sampleRate,
      );
      const result = await solve("record", null, raw);
      if (disposed || ticket !== revision) return;
      loadedSetupId = setupId;
      accept(raw, result.analysis);
      $("[data-condition]").value = "Untitled condition";
      $("[data-notes]").value =
        "Describe fixed geometry and the change before comparing repeated runs.";
      message(
        "Acquisition complete. Raw samples stayed local; microphone and output are stopped.",
      );
    } catch (error) {
      if (!disposed && ticket === revision) message(error.message, true);
    } finally {
      if (acquisition === operation) acquisition = null;
      if (!disposed && ticket === revision) {
        $("[data-cancel]").hidden = true;
        setBusy(false);
      }
    }
  });
  on($("[data-cancel]"), "click", stopCapture);
  on(document, "bench:pause", () => {
    stopCapture();
    if ($("[data-capture-dialog]").open) $("[data-capture-dialog]").close();
  });
  on(document, "visibilitychange", () => {
    if (document.hidden) stopCapture();
  });
  on(window, "pagehide", stopCapture);
  on($("[data-save]"), "click", () =>
    document.dispatchEvent(new CustomEvent("bench:save-current")),
  );
  on($("[data-wave]"), "click", () => {
    if (!record) return;
    const b = new ArrayBuffer(44 + record.response.length * 4),
      v = new DataView(b),
      text = (offset, t) => {
        for (let i = 0; i < t.length; i++)
          v.setUint8(offset + i, t.charCodeAt(i));
      };
    text(0, "RIFF");
    v.setUint32(4, b.byteLength - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 3, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, record.sampleRate, true);
    v.setUint32(28, record.sampleRate * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 32, true);
    text(36, "data");
    v.setUint32(40, record.response.length * 4, true);
    record.response.forEach((x, i) => v.setFloat32(44 + i * 4, x, true));
    download(new Blob([b], { type: "audio/wav" }), "physicsbench-response.wav");
  });
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = make("a");
    a.href = url;
    a.download = name;
    root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const cleanup = () => {
    disposed = true;
    stopCapture();
    life.abort();
    worker.terminate();
    resizeCharts.disconnect();
    for (const job of pending.values())
      job.reject(new Error("Investigation closed."));
    pending.clear();
    root.remove();
  };
  cleanup.exportRun = () => {
    if (!record || busy)
      throw new Error("Wait for a completed acquisition before saving.");
    const v = analysis.validation,
      ir = analysis.impulseResponse;
    let total = 0,
      tail = 0;
    ir.samples.forEach((x, i) => {
      total += x * x;
      if (i > ir.directPeakIndex + Math.round(record.sampleRate * 0.008))
        tail += x * x;
    });
    return {
      type: "acoustic",
      version: 1,
      acquisitionId: runId,
      captureFingerprint: record.evidenceHash,
      source: record.source,
      setupId: loadedSetupId,
      condition: $("[data-condition]").value.trim() || "Untitled condition",
      notes: $("[data-notes]").value,
      protocolVersion: record.protocolVersion,
      sampleRate: record.sampleRate,
      summary: {
        nrmse: v.nrmse,
        accepted: analysis.quality.usable,
        tailEnergyRatio: total ? tail / total : 0,
      },
      capture: {
        protocolVersion: record.protocolVersion,
        sampleRate: record.sampleRate,
        segments: record.segments,
        durationSeconds: record.durationSeconds,
        seed: record.seed,
        amplitude: record.amplitude,
        lowHz: record.lowHz,
        highHz: record.highHz,
        settings: record.settings || null,
        captureIntegrity: record.captureIntegrity || null,
        capturedAt: record.capturedAt || null,
        timing: record.timing || "Generated fixed sample timeline",
        analysisVersion: analysis.estimatorVersion,
        appVersion: "0.3.0",
        source: record.source,
        specimen: record.specimen || null,
        excitation: encodeSamples(record.excitation),
        response: encodeSamples(record.response),
      },
    };
  };
  cleanup.loadRun = async (data) => {
    if (
      data?.type !== "acoustic" ||
      data.version !== 1 ||
      typeof data.acquisitionId !== "string" ||
      data.acquisitionId.length < 8 ||
      data.acquisitionId.length > 100 ||
      typeof data.setupId !== "string" ||
      data.setupId.length < 8 ||
      data.setupId.length > 100 ||
      !["simulation", "microphone"].includes(data.source) ||
      !data.capture ||
      typeof data.condition !== "string" ||
      data.condition.length > 80 ||
      typeof data.notes !== "string" ||
      data.notes.length > 1200
    )
      throw new Error("Unsupported acoustic investigation.");
    const c = data.capture,
      raw = {
        ...c,
        excitation: decodeSamples(c.excitation),
        response: decodeSamples(c.response),
        source: data.source,
        acquisitionId: data.acquisitionId,
        imported: true,
      };
    const ticket = ++revision;
    setBusy(true, "Recomputing the saved raw recording…");
    try {
      const answer = await solve("record", null, raw);
      if (disposed || ticket !== revision) return;
      raw.evidenceHash = await recordingFingerprint(
        raw.excitation,
        raw.response,
        raw.sampleRate,
      );
      if (disposed || ticket !== revision) return;
      loadedSetupId = typeof data.setupId === "string" ? data.setupId : setupId;
      accept(raw, answer.analysis);
      $("[data-condition]").value = data.condition;
      $("[data-notes]").value = data.notes;
      message(
        "Raw samples reopened and analyzed again. Cached scores were not trusted.",
      );
    } finally {
      if (ticket === revision) setBusy(false);
    }
  };
  cleanup.getTitle = () => `Acoustic · ${$("[data-condition]").value}`;
  reference();
  return cleanup;
}
