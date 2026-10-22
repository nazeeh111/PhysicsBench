import { fitPolynomial, predictFit } from "./analysis.js";
import {
  grayscale,
  makeTemplate,
  matchTemplate,
  accelerationSensitivity,
} from "./tracking.js";

const W = 960,
  H = 540,
  DURATION = 1.8,
  STEP = 0.075;
const finite = Number.isFinite;
const copy = (value) => JSON.parse(JSON.stringify(value));
const fmt = (value, digits = 3) =>
  finite(value) ? Number(value.toPrecision(digits)).toString() : "—";
const near = (a, b) => Math.abs(a - b) < 0.00001;
const bound = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function generatedRun(scenario = "flight") {
  return {
    type: "motion",
    version: 1,
    id: newId(),
    name:
      scenario === "occlusion"
        ? "Flight behind an obstacle"
        : "A flight under constant gravity",
    question:
      "Can constant horizontal velocity and constant vertical acceleration explain this flight?",
    source: {
      kind: "generated",
      scenario,
      name: "Generated flight specimen",
      width: W,
      height: H,
      duration: DURATION,
      nominalStep: STEP,
      disclosure:
        "Canvas-generated pixels. Tracker observations are extracted from rendered frames; this is not a physical measurement.",
      groundTruth: { gravity: 9.81, metersPerPixel: 0.02 },
      timing: "exact generated time",
    },
    calibration: {
      a: { x: 70, y: 480 },
      b: { x: 170, y: 480 },
      lengthMeters: 2,
      origin: { x: 80, y: 460 },
      yUp: true,
      lengthBoundMeters: 0.01,
      pointBoundPixels: 1,
    },
    observations: [],
    gaps: [],
    model: "ballistic",
    fitStart: 0,
    fitEnd: DURATION,
    cursor: 0,
    selectedId: null,
    notes: "",
    settings: {
      step: STEP,
      searchRadius: 60,
      minSimilarity: 0.78,
      ambiguityMargin: 0.08,
      templateSize: 35,
      chartAxis: "y",
    },
  };
}

export function validateMotionRun(input) {
  if (!input || input.type !== "motion" || input.version !== 1)
    throw new Error("Use a PhysicsBench motion investigation, version 1.");
  const value = copy(input),
    source = value.source,
    c = value.calibration;
  if (value.id === undefined) value.id = newId();
  if (
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 100 ||
    !/^[a-zA-Z0-9_-]+$/.test(value.id)
  )
    throw new Error("Invalid investigation identifier.");
  if (!value.settings)
    value.settings = {
      step: STEP,
      searchRadius: 60,
      minSimilarity: 0.78,
      ambiguityMargin: 0.08,
      templateSize: 35,
      chartAxis: "y",
    };
  const settings = value.settings;
  if (
    ![settings.step, settings.searchRadius, settings.minSimilarity].every(
      finite,
    ) ||
    settings.step < 0.01 ||
    settings.step > 1 ||
    settings.searchRadius < 12 ||
    settings.searchRadius > 120 ||
    settings.minSimilarity < 0.5 ||
    settings.minSimilarity > 0.99 ||
    settings.ambiguityMargin !== 0.08 ||
    settings.templateSize !== 35 ||
    !["x", "y"].includes(settings.chartAxis)
  )
    throw new Error("Invalid tracking or plot settings.");
  const cleanText = (text, max = 4000) =>
    typeof text === "string" && text.length <= max;
  if (
    !source ||
    !["generated", "video"].includes(source.kind) ||
    !cleanText(source.name, 255) ||
    ![source.width, source.height].every(
      (v) => Number.isInteger(v) && v >= 32 && v <= 3840,
    ) ||
    source.width * source.height > 8_400_000 ||
    !finite(source.duration) ||
    source.duration <= 0 ||
    source.duration > 1800
  )
    throw new Error("Invalid source dimensions, duration or name.");
  if (
    source.kind === "generated" &&
    (!["flight", "occlusion"].includes(source.scenario) ||
      source.width !== W ||
      source.height !== H ||
      source.duration !== DURATION)
  )
    throw new Error("Unknown generated specimen.");
  if (
    source.kind === "video" &&
    (!Number.isInteger(source.bytes) ||
      source.bytes <= 0 ||
      source.bytes > 200 * 1024 ** 2)
  )
    throw new Error("Invalid local video metadata.");
  const point = (p) =>
    p &&
    [p.x, p.y].every(finite) &&
    p.x >= 0 &&
    p.x <= source.width &&
    p.y >= 0 &&
    p.y <= source.height;
  if (
    !c ||
    !point(c.a) ||
    !point(c.b) ||
    !point(c.origin) ||
    typeof c.yUp !== "boolean" ||
    (c.lengthMeters !== null &&
      (!finite(c.lengthMeters) ||
        c.lengthMeters < 1e-6 ||
        c.lengthMeters > 1e6)) ||
    !finite(c.lengthBoundMeters) ||
    c.lengthBoundMeters < 0 ||
    c.lengthBoundMeters > 1e6 ||
    !finite(c.pointBoundPixels) ||
    c.pointBoundPixels < 0 ||
    c.pointBoundPixels > 100 ||
    Math.hypot(c.a.x - c.b.x, c.a.y - c.b.y) < 1
  )
    throw new Error("Invalid ruler, origin or sensitivity settings.");
  if (c.lengthMeters !== null && c.lengthBoundMeters >= c.lengthMeters)
    throw new Error("Ruler uncertainty must be smaller than the known length.");
  if (
    !Array.isArray(value.observations) ||
    value.observations.length > 2000 ||
    !Array.isArray(value.gaps) ||
    value.gaps.length > 2000
  )
    throw new Error(
      "Investigations support at most 2,000 points and 2,000 gaps.",
    );
  let previous = -Infinity;
  const ids = new Set();
  for (const p of value.observations) {
    if (
      !point(p) ||
      !finite(p.t) ||
      p.t < 0 ||
      p.t > source.duration ||
      p.t <= previous ||
      typeof p.included !== "boolean" ||
      !["manual", "ncc", "seed"].includes(p.method) ||
      typeof p.id !== "string" ||
      p.id.length > 80 ||
      ids.has(p.id) ||
      (p.confidence != null &&
        (!finite(p.confidence) || p.confidence < -1 || p.confidence > 1)) ||
      (p.ambiguity != null &&
        (!finite(p.ambiguity) || p.ambiguity < 0 || p.ambiguity > 2))
    )
      throw new Error("Invalid observation or duplicate/non-increasing time.");
    previous = p.t;
    ids.add(p.id);
  }
  for (const gap of value.gaps)
    if (
      !finite(gap.t) ||
      gap.t < 0 ||
      gap.t > source.duration ||
      !cleanText(gap.reason, 500)
    )
      throw new Error("Invalid tracking gap.");
  if (
    !["linear", "ballistic", "quadratic"].includes(value.model) ||
    ![value.fitStart, value.fitEnd, value.cursor].every(finite) ||
    value.fitStart < 0 ||
    value.fitEnd > source.duration ||
    value.fitStart >= value.fitEnd ||
    value.cursor < 0 ||
    value.cursor > source.duration ||
    !cleanText(value.name, 200) ||
    !cleanText(value.question, 2000) ||
    !cleanText(value.notes, 6000) ||
    (value.selectedId !== null && !ids.has(value.selectedId))
  )
    throw new Error(
      "Invalid model window, selected point or investigation text.",
    );
  return value;
}

export function mountMotion(container, options = {}) {
  const root = document.createElement("section");
  root.className = "motion-lab";
  root.setAttribute("aria-label", "Motion investigation");
  root.innerHTML = `
    <div class="motion-topline"><p class="eyebrow">Motion / model and measurement</p><span class="motion-source-tag" data-origin></span></div>
    <div class="motion-heading"><div><h2 data-title>A flight under constant gravity</h2><p data-question></p></div><div class="motion-actions"><button type="button" data-save>Save investigation</button><label class="motion-file">Open investigation<input type="file" accept=".json,application/json" data-open></label></div></div>
    <div class="motion-sourcebar"><label>Specimen <select data-source><option value="flight">Generated flight</option><option value="occlusion">Generated occlusion challenge</option><option value="local">Local video…</option></select></label><label class="motion-file">Choose / reattach video<input type="file" accept="video/*" data-video-file></label><span data-source-note></span></div>
    <div class="motion-workspace">
      <div class="motion-main"><div class="motion-result-strip" data-results aria-live="polite"></div>
        <section class="motion-specimen-panel"><div class="motion-panel-heading"><h3>Specimen and reconstructed motion</h3><span data-frame-label></span></div><canvas class="motion-specimen" data-specimen width="960" height="540" tabindex="0" role="img" aria-label="Motion specimen. Select a target to seed or correct tracking. Keyboard coordinate inputs are available in Review points."></canvas><video class="motion-video-decoder" data-decoder width="1" height="1" muted playsinline aria-hidden="true" tabindex="-1"></video>
          <div class="motion-transport"><button type="button" data-prev aria-label="Previous time step">← Step</button><button type="button" data-next aria-label="Next time step">Step →</button><label class="motion-time">Time <input type="range" data-time min="0" max="1.8" step="0.001" value="0"></label><output data-time-label>0.000 s</output><label>Step (s)<input type="number" data-step min="0.01" max="1" step="0.005" value="0.075"></label></div>
          <p class="motion-status" role="status" aria-live="polite" data-status>Preparing the generated specimen.</p>
          <div class="motion-legend"><span>● Cyan: observed</span><span>— Amber: selected model</span><span>× Excluded</span><span>Dashed box: bounded search</span></div>
        </section>

        <div class="motion-chart-grid"><section class="motion-chart-card"><div class="motion-panel-heading"><h3>Position through time</h3><label>Axis <select data-axis><option value="y">Vertical y</option><option value="x">Horizontal x</option></select></label></div><canvas class="motion-chart" data-position width="860" height="265" tabindex="0" role="img" aria-label="Position and fitted model. Click to inspect a time, or use left and right arrow keys."></canvas></section><section class="motion-chart-card"><div class="motion-panel-heading"><h3>What the model misses</h3><span>Observed − predicted</span></div><canvas class="motion-chart" data-residual width="860" height="220" tabindex="0" role="img" aria-label="Fit residuals. Click to inspect a time, or use left and right arrow keys."></canvas></section></div>
      </div>
      <aside class="motion-inspector">
        <section class="motion-panel"><p class="eyebrow">01 / Acquire</p><h3>Follow the same target</h3><p>Select the ball in the specimen to set a seed. Assisted tracking searches nearby pixels; uncertain matches stop for your review.</p><div class="motion-actions"><button type="button" data-seed>Select target</button><button type="button" data-track>Track forward</button><button type="button" data-stop disabled>Stop</button><button type="button" data-undo disabled>Undo</button></div><div class="motion-fields"><label>Search radius (px)<input data-radius type="number" min="12" max="120" value="60"></label><label>Minimum match<input data-threshold type="number" min="0.5" max="0.99" step="0.01" value="0.78"></label></div><p class="small-note" data-match-note>Match scores are pattern similarity, not confidence probabilities.</p><p class="motion-gap" data-gap></p></section>
        <section class="motion-panel"><p class="eyebrow">02 / Compare</p><h3>Choose an explanation</h3><label>Motion model<select data-model><option value="ballistic">Ballistic: x linear, y quadratic</option><option value="linear">Constant velocity: x and y linear</option><option value="quadratic">Constant acceleration: x and y quadratic</option></select></label><div class="motion-fields"><label>Fit from (s)<input type="number" data-fit-start min="0" step="0.001" value="0"></label><label>Fit to (s)<input type="number" data-fit-end min="0" step="0.001" value="1.8"></label></div><button type="button" data-full>Use complete interval</button><p class="small-note" data-model-note></p><div class="motion-model-comparison" data-comparison></div><p class="motion-conclusion" data-conclusion></p></section>
        <details class="motion-details" open><summary>Calibration and sensitivity</summary><p>Ruler and motion must lie in the same plane. Origin is movable; positive x points right. This calibration does not correct perspective or camera motion.</p><div class="motion-actions"><button type="button" data-ruler>Pick ruler endpoints</button><button type="button" data-origin-pick>Pick origin</button></div><div class="motion-fields"><label>Known ruler length (m)<input data-length type="number" min="0.000001" step="any" value="2"></label><label>Length bound ±m<input data-length-bound type="number" min="0" step="0.001" value="0.01"></label><label>Point bound ±px<input data-point-bound type="number" min="0" max="100" step="0.25" value="1"></label><label>Vertical direction<select data-y-direction><option value="up">Positive upward</option><option value="down">Positive downward</option></select></label></div><details class="motion-coordinate-fields"><summary>Enter ruler pixels and origin</summary><div class="motion-fields"><label>Ruler A x (px)<input data-ruler-ax type="number" step="0.1"></label><label>Ruler A y (px)<input data-ruler-ay type="number" step="0.1"></label><label>Ruler B x (px)<input data-ruler-bx type="number" step="0.1"></label><label>Ruler B y (px)<input data-ruler-by type="number" step="0.1"></label><label>Origin x (px)<input data-origin-x type="number" step="0.1"></label><label>Origin y (px)<input data-origin-y type="number" step="0.1"></label></div></details><div class="motion-actions"><button type="button" data-calibrate>Apply calibration</button><button type="button" data-pixels>Use pixels</button></div><p class="small-note" data-calibration-note></p><p class="small-note" data-sensitivity></p></details>
        <details class="motion-details"><summary>Review points and correct tracking</summary><p>Select a point below, then click its correct location in the specimen, or enter pixel coordinates. Corrections replace that time only. Exclusion preserves the original point.</p><div class="motion-fields"><label>Point time<select data-point-select aria-label="Select observation"></select></label><label>X (source px)<input data-point-x type="number" min="0" step="0.1"></label><label>Y (source px, down)<input data-point-y type="number" min="0" step="0.1"></label></div><div class="motion-actions"><button type="button" data-record>Record / correct point</button><button type="button" data-exclude>Exclude point</button><button type="button" data-delete>Delete point</button></div><div class="motion-table-wrap"><table class="motion-table"><thead><tr><th scope="col">Time s</th><th scope="col">x</th><th scope="col">y</th><th scope="col">Use</th></tr></thead><tbody data-table></tbody></table></div></details>
        <details class="motion-details"><summary>Evidence and export</summary><label>Investigation question<textarea data-question-input rows="2" maxlength="2000"></textarea></label><label>Observation notes<textarea data-notes rows="3" maxlength="6000" placeholder="What assumptions matter? What did you exclude, and why?"></textarea></label><p class="small-note" data-evidence></p><div class="motion-actions"><button type="button" data-csv>Export observations CSV</button><button type="button" data-json>Export complete JSON</button></div><p class="small-note">JSON reopens the points, model, calibration and notes. Local video bytes stay separate; reattach the same video after reopening. CSV is a table, not a complete investigation.</p></details>
      </aside>
    </div><p class="error" role="alert" data-error hidden></p>`;
  container.append(root);
  const $ = (query) => root.querySelector(query);
  const on = (node, type, fn) =>
    node.addEventListener(type, fn, { signal: events.signal });
  const events = new AbortController();
  const canvas = $("[data-specimen]"),
    ctx = canvas.getContext("2d");
  const sourceCanvas = document.createElement("canvas"),
    sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const video = $("[data-decoder]");
  const positionCanvas = $("[data-position]"),
    residualCanvas = $("[data-residual]");
  let run = generatedRun(),
    history = [],
    disposed = false,
    tracking = false,
    operation = 0,
    videoURL = null,
    videoReady = false;
  let template = null,
    anchor = null,
    picking = null,
    rulerPoints = [],
    blocked = false,
    observedMediaTime = null,
    presentedFrames = null;
  let fit = null,
    fitError = "",
    selectedAxis = "y",
    chartGeometry = new Map(),
    pointSequence = 0;
  let sourceLoad = 0,
    initialized = false;
  const status = (text) => {
    $("[data-status]").textContent = text;
  };
  const error = (text) => {
    $("[data-error]").textContent = text || "";
    $("[data-error]").hidden = !text;
  };
  function changed(reason) {
    if (disposed) return;
    options.onChange?.(exportRun(), reason);
    root.dispatchEvent(
      new CustomEvent("motion:change", { bubbles: true, detail: { reason } }),
    );
  }
  function remember() {
    history.push(copy(run));
    if (history.length > 24) history.shift();
    $("[data-undo]").disabled = false;
  }
  function scale() {
    const c = run.calibration;
    return c.lengthMeters === null
      ? 1
      : c.lengthMeters / Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  }
  const unit = () => (run.calibration.lengthMeters === null ? "px" : "m");
  function world(p) {
    const c = run.calibration,
      s = scale();
    return {
      t: p.t,
      x: (p.x - c.origin.x) * s,
      y: (p.y - c.origin.y) * s * (c.yUp ? -1 : 1),
      raw: p,
    };
  }
  function included() {
    return run.observations
      .filter(
        (p) =>
          p.included && p.t >= run.fitStart - 1e-8 && p.t <= run.fitEnd + 1e-8,
      )
      .map(world);
  }
  function compute(model) {
    const points = included();
    const fx = fitPolynomial(
      points.map((p) => ({ t: p.t, y: p.x })),
      model === "quadratic" ? 2 : 1,
    );
    const fy = fitPolynomial(
      points.map((p) => ({ t: p.t, y: p.y })),
      model === "linear" ? 1 : 2,
    );
    const radialRMSE = Math.sqrt(
      points.reduce(
        (sum, p) =>
          sum +
          (p.x - predictFit(fx, p.t)) ** 2 +
          (p.y - predictFit(fy, p.t)) ** 2,
        0,
      ) / points.length,
    );
    return {
      x: fx,
      y: fy,
      radialRMSE,
      points,
      ay: fy.degree === 2 ? 2 * fy.coefficients[2] : 0,
      ax: fx.degree === 2 ? 2 * fx.coefficients[2] : 0,
    };
  }
  function generatedFrame(t) {
    const c = sourceCtx;
    c.fillStyle = "#15242a";
    c.fillRect(0, 0, W, H);
    c.strokeStyle = "#23383f";
    c.lineWidth = 1;
    for (let x = 20; x < W; x += 50) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    for (let y = 30; y < H; y += 50) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    c.fillStyle = "#293c41";
    c.fillRect(0, 460, W, 80);
    c.strokeStyle = "#9eafb1";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(70, 480);
    c.lineTo(170, 480);
    c.stroke();
    for (let x = 70; x <= 170; x += 10) {
      c.beginPath();
      c.moveTo(x, 474);
      c.lineTo(x, x % 50 === 20 ? 490 : 484);
      c.stroke();
    }
    c.font = "16px ui-monospace, monospace";
    c.fillStyle = "#a6b9bd";
    c.fillText("2 m generated reference", 70, 516);
    c.font = "14px ui-monospace, monospace";
    c.fillText("GENERATED PIXELS · NOT PHYSICAL EVIDENCE", 34, 35);
    const x = 120 + 370 * t,
      y = 440 - 520 * t + 245.25 * t * t;
    c.save();
    c.translate(x, y);
    c.fillStyle = "#ffb15c";
    c.beginPath();
    c.arc(0, 0, 14, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#753b28";
    c.fillRect(-10, -3, 20, 5);
    c.fillRect(-3, -10, 5, 20);
    c.fillStyle = "#fff3d5";
    c.fillRect(-7, -8, 4, 4);
    c.fillRect(4, 4, 3, 3);
    c.restore();
    // Different-shaped textured distractors exercise pattern matching.
    c.fillStyle = "#5d7a7d";
    c.beginPath();
    c.moveTo(600, 420);
    c.lineTo(623, 385);
    c.lineTo(646, 420);
    c.closePath();
    c.fill();
    c.strokeStyle = "#a6b9bd";
    c.beginPath();
    c.moveTo(619, 399);
    c.lineTo(633, 415);
    c.stroke();
    if (run.source.scenario === "occlusion") {
      c.fillStyle = "#607379";
      c.fillRect(358, 108, 86, 352);
      c.fillStyle = "#b8c7cc";
      c.font = "13px ui-monospace, monospace";
      c.fillText("obstacle", 366, 449);
    }
  }
  function prepareFrame() {
    sourceCanvas.width = run.source.width;
    sourceCanvas.height = run.source.height;
    if (run.source.kind === "generated") generatedFrame(run.cursor);
    else if (videoReady && video.readyState >= 2)
      sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
    else {
      sourceCtx.fillStyle = "#15242a";
      sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      sourceCtx.fillStyle = "#b8c7cc";
      sourceCtx.font = "24px sans-serif";
      sourceCtx.fillText(
        "Reattach the source video to inspect pixels.",
        35,
        100,
      );
    }
  }
  function frameGray() {
    return grayscale(
      sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height),
    );
  }
  function drawSpecimen() {
    canvas.width = run.source.width;
    canvas.height = run.source.height;
    ctx.drawImage(sourceCanvas, 0, 0);
    const lineScale = run.source.width / W;
    ctx.lineWidth = 2.5 * lineScale;
    if (fit) {
      ctx.strokeStyle = "#ffb15c";
      ctx.setLineDash([8 * lineScale, 5 * lineScale]);
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const t = run.fitStart + ((run.fitEnd - run.fitStart) * i) / 120;
        const x = run.calibration.origin.x + predictFit(fit.x, t) / scale();
        const y =
          run.calibration.origin.y +
          (predictFit(fit.y, t) / scale()) * (run.calibration.yUp ? -1 : 1);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of run.observations) {
      const selected = p.id === run.selectedId || near(p.t, run.cursor);
      ctx.strokeStyle = p.included ? "#63d9cc" : "#bc8d84";
      ctx.fillStyle = "#63d9cc";
      if (p.included) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (selected ? 8 : 4) * lineScale, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x - 5 * lineScale, p.y - 5 * lineScale);
        ctx.lineTo(p.x + 5 * lineScale, p.y + 5 * lineScale);
        ctx.moveTo(p.x - 5 * lineScale, p.y + 5 * lineScale);
        ctx.lineTo(p.x + 5 * lineScale, p.y - 5 * lineScale);
        ctx.stroke();
      }
    }
    const c = run.calibration;
    ctx.strokeStyle = "#dbe5df";
    ctx.lineWidth = 2 * lineScale;
    ctx.beginPath();
    ctx.moveTo(c.a.x, c.a.y);
    ctx.lineTo(c.b.x, c.b.y);
    ctx.stroke();
    for (const p of [c.a, c.b, ...rulerPoints]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * lineScale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "#dbe5df";
    ctx.beginPath();
    ctx.moveTo(c.origin.x, c.origin.y);
    ctx.lineTo(c.origin.x + 42 * lineScale, c.origin.y);
    ctx.moveTo(c.origin.x, c.origin.y);
    ctx.lineTo(c.origin.x, c.origin.y + (c.yUp ? -42 : 42) * lineScale);
    ctx.stroke();
    ctx.fillStyle = "#dbe5df";
    ctx.font = `${12 * lineScale}px ui-monospace, monospace`;
    ctx.fillText(
      "x →",
      c.origin.x + 45 * lineScale,
      c.origin.y + 5 * lineScale,
    );
    ctx.fillText(
      c.yUp ? "y ↑" : "y ↓",
      c.origin.x + 5 * lineScale,
      c.origin.y + (c.yUp ? -46 : 50) * lineScale,
    );
    if (anchor && template) {
      const radius = Number($("[data-radius]").value) || 60;
      ctx.strokeStyle = "#b9c6c9";
      ctx.setLineDash([5 * lineScale, 5 * lineScale]);
      ctx.strokeRect(
        anchor.x - radius,
        anchor.y - radius,
        2 * radius,
        2 * radius,
      );
      ctx.setLineDash([]);
    }
    $("[data-frame-label]").textContent =
      `${run.source.width} × ${run.source.height} · ${run.source.kind === "generated" ? "generated time" : !videoReady ? "video not attached" : observedMediaTime === null ? "awaiting presented timestamp" : "requestVideoFrameCallback" in video ? "presented media time" : "approximate media time"}`;
    canvas.setAttribute(
      "aria-label",
      `${run.name}. ${run.observations.length} observed points, ${run.gaps.length} gaps. Current time ${run.cursor.toFixed(3)} seconds. ${picking ? "Click to " + picking + "." : "Click to seed or correct the target."}`,
    );
  }
  function plotChart(target, residual = false) {
    const c = target.getContext("2d"),
      width = Math.max(200, Math.round(target.getBoundingClientRect().width)),
      height = residual ? 200 : 250,
      ratio = Math.min(2, window.devicePixelRatio || 1);
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    const pad = { left: 64, right: 20, top: 22, bottom: 44 };
    c.fillStyle = "#111a1f";
    c.fillRect(0, 0, width, height);
    const points = run.observations.map(world),
      activeFit = fit?.[selectedAxis];
    const valueOf = (p) =>
      residual
        ? activeFit
          ? p[selectedAxis] - predictFit(activeFit, p.t)
          : 0
        : p[selectedAxis];
    const values = points
      .filter(
        (p) =>
          !residual ||
          (activeFit &&
            p.raw.included &&
            p.t >= run.fitStart &&
            p.t <= run.fitEnd),
      )
      .map(valueOf);
    if (!residual && activeFit)
      for (let i = 0; i <= 80; i++)
        values.push(
          predictFit(
            activeFit,
            run.fitStart + ((run.fitEnd - run.fitStart) * i) / 80,
          ),
        );
    let ymin = values.length ? Math.min(...values) : 0,
      ymax = values.length ? Math.max(...values) : 1;
    if (residual) {
      const amplitude = Math.max(
        Math.abs(ymin),
        Math.abs(ymax),
        unit() === "m" ? 0.005 : 0.5,
      );
      ymin = -amplitude * 1.25;
      ymax = amplitude * 1.25;
    } else {
      const span = ymax - ymin || Math.max(Math.abs(ymax) * 0.1, 1);
      ymin -= span * 0.12;
      ymax += span * 0.12;
    }
    const x = (t) =>
      pad.left + (t / run.source.duration) * (width - pad.left - pad.right);
    const y = (v) =>
      height -
      pad.bottom -
      ((v - ymin) / (ymax - ymin)) * (height - pad.top - pad.bottom);
    chartGeometry.set(target, { x, y, pad, width, height });
    c.font = "12px ui-monospace, monospace";
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = ymin + ((ymax - ymin) * i) / 4,
        yy = y(v);
      c.strokeStyle = "#2b3b42";
      c.beginPath();
      c.moveTo(pad.left, yy);
      c.lineTo(width - pad.right, yy);
      c.stroke();
      c.fillStyle = "#b8c7cc";
      c.textAlign = "right";
      c.fillText(fmt(v), pad.left - 8, yy + 4);
    }
    for (let i = 0; i <= 4; i++) {
      const t = (run.source.duration * i) / 4,
        xx = x(t);
      c.strokeStyle = "#26363d";
      c.beginPath();
      c.moveTo(xx, pad.top);
      c.lineTo(xx, height - pad.bottom);
      c.stroke();
      c.fillStyle = "#b8c7cc";
      c.textAlign = "center";
      c.fillText(fmt(t), xx, height - 24);
    }
    c.fillStyle = "#b8c7cc";
    c.textAlign = "left";
    c.fillText(
      `${residual ? "residual" : selectedAxis} (${unit()})`,
      pad.left,
      14,
    );
    c.textAlign = "right";
    c.fillText("time (s)", width - pad.right, height - 7);
    c.save();
    c.beginPath();
    c.rect(
      pad.left,
      pad.top,
      width - pad.left - pad.right,
      height - pad.top - pad.bottom,
    );
    c.clip();
    if (!residual && activeFit) {
      c.strokeStyle = "#ffb15c";
      c.lineWidth = 2.5;
      c.beginPath();
      for (let i = 0; i <= 150; i++) {
        const t = run.fitStart + ((run.fitEnd - run.fitStart) * i) / 150;
        i
          ? c.lineTo(x(t), y(predictFit(activeFit, t)))
          : c.moveTo(x(t), y(predictFit(activeFit, t)));
      }
      c.stroke();
    }
    if (residual) {
      c.strokeStyle = "#a8b8bc";
      c.beginPath();
      c.moveTo(x(0), y(0));
      c.lineTo(x(run.source.duration), y(0));
      c.stroke();
    }
    for (const gap of run.gaps) {
      c.strokeStyle = "#c58b7c";
      c.setLineDash([3, 5]);
      c.beginPath();
      c.moveTo(x(gap.t), pad.top);
      c.lineTo(x(gap.t), height - pad.bottom);
      c.stroke();
      c.setLineDash([]);
    }
    for (const p of points) {
      if (
        residual &&
        (!activeFit ||
          !p.raw.included ||
          p.t < run.fitStart ||
          p.t > run.fitEnd)
      )
        continue;
      const xx = x(p.t),
        yy = y(valueOf(p));
      const active = p.raw.included && p.t >= run.fitStart && p.t <= run.fitEnd;
      c.strokeStyle = active ? "#63d9cc" : "#bc8d84";
      c.fillStyle = active ? "#63d9cc" : "#bc8d84";
      if (!active) {
        c.beginPath();
        c.moveTo(xx - 4, yy - 4);
        c.lineTo(xx + 4, yy + 4);
        c.moveTo(xx - 4, yy + 4);
        c.lineTo(xx + 4, yy - 4);
        c.stroke();
      } else {
        c.beginPath();
        c.arc(xx, yy, p.raw.id === run.selectedId ? 6 : 3.5, 0, 2 * Math.PI);
        c.fill();
      }
    }
    c.strokeStyle = "#e3e9e2";
    c.setLineDash([4, 4]);
    c.beginPath();
    c.moveTo(x(run.cursor), pad.top);
    c.lineTo(x(run.cursor), height - pad.bottom);
    c.stroke();
    c.restore();
    target.setAttribute(
      "aria-label",
      `${residual ? "Residuals" : "Position"} for ${selectedAxis}. ${points.length} observations. ${fit ? `Selected model radial error ${fmt(fit.radialRMSE)} ${unit()}.` : fitError} Selected time ${run.cursor.toFixed(3)} seconds.`,
    );
  }
  function result(label, value, detail) {
    const box = document.createElement("div");
    box.className = "motion-result";
    const small = document.createElement("span"),
      strong = document.createElement("strong"),
      note = document.createElement("small");
    small.textContent = label;
    strong.textContent = value;
    note.textContent = detail;
    box.append(small, strong, note);
    return box;
  }
  function renderAnalysis() {
    fit = null;
    fitError = "";
    try {
      fit = compute(run.model);
    } catch (e) {
      fitError = e.message;
    }
    const used = included(),
      units = unit();
    const counts = result(
      "Observations used",
      `${used.length} / ${run.observations.length}`,
      `${run.gaps.length} unresolved gap${run.gaps.length === 1 ? "" : "s"}`,
    );
    const acceleration = result(
      "Vertical acceleration",
      fit ? `${fmt(fit.ay, 4)} ${units}/s²` : "Collect points",
      fit
        ? run.model === "linear"
          ? "Constrained to zero by this model"
          : "Estimated from tracked positions"
        : fitError,
    );
    const mismatch = result(
      "Model mismatch",
      fit ? `${fmt(fit.radialRMSE)} ${units}` : "—",
      "Root mean square 2D position error",
    );
    $("[data-results]").replaceChildren(counts, acceleration, mismatch);
    const comparison = $("[data-comparison]");
    comparison.replaceChildren();
    for (const [key, label] of [
      ["linear", "Constant velocity"],
      ["ballistic", "Ballistic"],
      ["quadratic", "2D acceleration"],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.comparisonModel = key;
      b.setAttribute("aria-pressed", String(key === run.model));
      let description = "Need more points";
      try {
        description = `${fmt(compute(key).radialRMSE)} ${units} error`;
      } catch {}
      b.textContent = `${label} · ${description}`;
      comparison.append(b);
    }
    $("[data-model-note]").textContent =
      run.model === "ballistic"
        ? "Ballistic assumes no horizontal acceleration and constant vertical acceleration. Gravity is inferred only when the camera is fixed, scale is valid and drag is negligible."
        : run.model === "linear"
          ? "Constant velocity uses straight lines for x(t) and y(t). Curved residuals are evidence that it misses changing velocity."
          : "Separate quadratics allow constant acceleration on both axes. Lower training error with more parameters does not prove a better physical explanation.";
    let conclusion = fitError;
    if (fit) {
      const linear = (() => {
        try {
          return compute("linear");
        } catch {
          return null;
        }
      })();
      conclusion =
        run.model !== "linear" &&
        linear &&
        linear.radialRMSE > fit.radialRMSE * 3
          ? `Constant velocity leaves ${fmt(linear.radialRMSE)} ${units} of mismatch. The selected model reduces that to ${fmt(fit.radialRMSE)} ${units}. Inspect the residuals and assumptions before accepting it.`
          : `This model leaves ${fmt(fit.radialRMSE)} ${units} of mismatch. Residual structure and acquisition assumptions matter alongside this number.`;
      if (run.source.kind === "generated")
        conclusion +=
          " This is a recovery check on generated pixels, not a gravity measurement.";
    }
    $("[data-conclusion]").textContent = conclusion;
    const c = run.calibration,
      rulerPixels = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
    $("[data-calibration-note]").textContent =
      c.lengthMeters === null
        ? `Uncalibrated: source pixels. Ruler spans ${fmt(rulerPixels)} px. No physical acceleration can be inferred.`
        : `Ruler: ${fmt(rulerPixels, 5)} px = ${fmt(c.lengthMeters, 5)} m. Scale ${fmt(scale(), 5)} m/px; origin (${fmt(c.origin.x)}, ${fmt(c.origin.y)}) px; y ${c.yUp ? "upward" : "downward"}.`;
    let sensitivity =
      "Collect at least four included points to inspect acceleration sensitivity.";
    if (fit && run.model !== "linear") {
      try {
        const pointChange = accelerationSensitivity(
          used.map((p) => p.t),
          scale(),
          c.pointBoundPixels,
        ).bound;
        const rulerChange =
          c.lengthMeters === null
            ? 0
            : (Math.abs(fit.ay) * c.lengthBoundMeters) / c.lengthMeters;
        const combined =
          pointChange +
          rulerChange +
          pointChange *
            (c.lengthMeters === null
              ? 0
              : c.lengthBoundMeters / c.lengthMeters);
        sensitivity = `With exact times: independent point edits within ±${fmt(c.pointBoundPixels)} px can change aᵧ by at most ${fmt(pointChange)} ${units}/s²; ruler ±${fmt(c.lengthBoundMeters)} m changes it by ${fmt(rulerChange)} ${units}/s². Combined bound: ±${fmt(combined)} ${units}/s². A worst-case sensitivity bound, not a confidence interval. Timing, perspective, camera motion and model error are excluded.`;
      } catch (e) {
        sensitivity = e.message;
      }
    }
    $("[data-sensitivity]").textContent = sensitivity;
    $("[data-evidence]").textContent =
      `${run.source.kind === "generated" ? run.source.disclosure : `Local video: ${run.source.name}; ${run.source.timing || "timing not verified"}.`} ${run.observations.filter((p) => p.method === "ncc").length} NCC matches, ${run.observations.filter((p) => p.method !== "ncc").length} seeds/manual points. ${run.observations.filter((p) => !p.included).length} exclusions are preserved. Fits treat times as exact.`;
    plotChart(positionCanvas);
    plotChart(residualCanvas, true);
  }
  function renderPoints() {
    const select = $("[data-point-select]");
    select.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Current time / new point";
    select.append(none);
    const body = $("[data-table]");
    body.replaceChildren();
    for (const p of run.observations) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = `${p.t.toFixed(3)} s · ${p.included ? p.method : "excluded"}`;
      select.append(o);
      if (run.observations.indexOf(p) < 100) {
        const tr = document.createElement("tr");
        if (p.id === run.selectedId) tr.className = "motion-selected-row";
        const td = document.createElement("td"),
          b = document.createElement("button");
        b.type = "button";
        b.dataset.pointId = p.id;
        b.textContent = p.t.toFixed(3);
        td.append(b);
        tr.append(td);
        const worldPoint = world(p);
        for (const value of [
          fmt(worldPoint.x, 4),
          fmt(worldPoint.y, 4),
          p.included ? "yes" : "no",
        ]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          tr.append(cell);
        }
        body.append(tr);
      }
    }
    select.value = run.selectedId || "";
    const selected = run.observations.find((p) => p.id === run.selectedId);
    if (selected) {
      $("[data-point-x]").value = fmt(selected.x, 8);
      $("[data-point-y]").value = fmt(selected.y, 8);
    }
    $("[data-exclude]").disabled = !selected;
    $("[data-delete]").disabled = !selected;
    $("[data-exclude]").textContent =
      selected && !selected.included ? "Include point" : "Exclude point";
    const latestGap = run.gaps.at(-1);
    $("[data-gap]").textContent = latestGap
      ? `Gap at ${latestGap.t.toFixed(3)} s: ${latestGap.reason} Inspect this time and manually select the target to continue.`
      : "";
  }
  function render() {
    $("[data-title]").textContent = run.name;
    $("[data-question]").textContent = run.question;
    $("[data-origin]").textContent =
      run.source.kind === "generated"
        ? "SYNTHETIC SPECIMEN"
        : videoReady
          ? "LOCAL VIDEO ATTACHED"
          : "SOURCE VIDEO REQUIRED";
    $("[data-source]").value =
      run.source.kind === "generated" ? run.source.scenario : "local";
    $("[data-source-note]").textContent =
      run.source.kind === "generated"
        ? "Known generated pixels; no physical measurement claimed."
        : `${run.source.name} · ${videoReady ? "local decode; no upload" : "reattach this file to inspect/correct pixels"}`;
    $("[data-time]").max = run.source.duration;
    $("[data-time]").value = run.cursor;
    $("[data-time-label]").textContent = `${run.cursor.toFixed(3)} s`;
    $("[data-step]").value = run.settings.step;
    $("[data-radius]").value = run.settings.searchRadius;
    $("[data-threshold]").value = run.settings.minSimilarity;
    selectedAxis = run.settings.chartAxis;
    $("[data-axis]").value = selectedAxis;
    $("[data-model]").value = run.model;
    $("[data-fit-start]").value = run.fitStart;
    $("[data-fit-end]").value = run.fitEnd;
    $("[data-fit-start]").max = run.source.duration;
    $("[data-fit-end]").max = run.source.duration;
    $("[data-length]").value = run.calibration.lengthMeters ?? "";
    $("[data-length-bound]").value = run.calibration.lengthBoundMeters;
    $("[data-point-bound]").value = run.calibration.pointBoundPixels;
    $("[data-y-direction]").value = run.calibration.yUp ? "up" : "down";
    for (const [key, value] of [
      ["ruler-ax", run.calibration.a.x],
      ["ruler-ay", run.calibration.a.y],
      ["ruler-bx", run.calibration.b.x],
      ["ruler-by", run.calibration.b.y],
      ["origin-x", run.calibration.origin.x],
      ["origin-y", run.calibration.origin.y],
    ])
      $("[data-" + key + "]").value = fmt(value, 9);
    $("[data-question-input]").value = run.question;
    $("[data-notes]").value = run.notes;
    $("[data-track]").disabled =
      tracking ||
      !template ||
      !anchor ||
      blocked ||
      (run.source.kind === "video" &&
        (!videoReady || !("requestVideoFrameCallback" in video)));
    $("[data-stop]").disabled = !tracking;
    $("[data-undo]").disabled = !history.length || tracking;
    $("[data-undo]").textContent =
      `Undo${history.length ? ` (${history.length})` : ""}`;
    renderAnalysis();
    renderPoints();
    drawSpecimen();
  }
  function stop(message) {
    tracking = false;
    operation++;
    video.pause();
    if (message) status(message);
    $("[data-stop]").disabled = true;
    $("[data-track]").disabled = !template || !anchor || blocked;
  }
  function releaseVideo() {
    video.pause();
    video.removeAttribute("src");
    video.load();
    videoReady = false;
    observedMediaTime = null;
    presentedFrames = null;
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = null;
  }
  async function seekFrame(time, requirePresented = false) {
    const token = operation;
    const target = bound(time, 0, run.source.duration);
    if (run.source.kind === "generated") {
      run.cursor = target;
      prepareFrame();
      return target;
    }
    if (!videoReady)
      throw new Error("Reattach the source video before inspecting pixels.");
    const hasFrames = "requestVideoFrameCallback" in video;
    if (requirePresented && !hasFrames)
      throw new Error(
        "This browser cannot report presented video-frame timestamps. Manual tracking remains available.",
      );
    video.pause();
    const actual = await new Promise((resolve, reject) => {
      let callback = null,
        timer;
      const clear = () => {
        clearTimeout(timer);
        video.removeEventListener("seeked", seeked);
        if (callback !== null && "cancelVideoFrameCallback" in video)
          video.cancelVideoFrameCallback(callback);
      };
      const finish = (value, frames = null) => {
        clear();
        if (token !== operation || disposed)
          return reject(new Error("Frame operation canceled."));
        presentedFrames = frames;
        resolve(value);
      };
      const seeked = () => {
        if (!hasFrames) finish(video.currentTime);
      };
      if (hasFrames)
        callback = video.requestVideoFrameCallback((_, metadata) =>
          finish(metadata.mediaTime, metadata.presentedFrames),
        );
      else video.addEventListener("seeked", seeked, { once: true });
      timer = setTimeout(() => {
        clear();
        reject(
          new Error(
            "No presented frame arrived. Try another time; automated tracking will not guess timestamps.",
          ),
        );
      }, 2500);
      if (near(target, video.currentTime) && observedMediaTime !== null)
        finish(observedMediaTime, presentedFrames);
      else video.currentTime = target;
    });
    observedMediaTime = actual;
    run.cursor = actual;
    prepareFrame();
    return actual;
  }
  async function seek(time, selectNearest = true) {
    stop();
    error("");
    try {
      await seekFrame(time);
      if (selectNearest && run.observations.length)
        run.selectedId = run.observations.reduce((best, p) =>
          Math.abs(p.t - run.cursor) < Math.abs(best.t - run.cursor) ? p : best,
        ).id;
      const selected = run.observations.find(
        (p) => p.id === run.selectedId && near(p.t, run.cursor),
      );
      template = null;
      anchor = null;
      if (selected) {
        try {
          template = makeTemplate(
            frameGray(),
            selected.x,
            selected.y,
            run.settings.templateSize,
          );
          anchor = { x: selected.x, y: selected.y, t: selected.t };
        } catch {}
      }
      render();
      changed("cursor");
    } catch (e) {
      if (!disposed) error(e.message);
    }
  }
  function recordPoint(x, y, method = "manual", match = null) {
    if (
      ![x, y].every(finite) ||
      x < 0 ||
      y < 0 ||
      x > run.source.width ||
      y > run.source.height
    )
      throw new Error("Point coordinates must lie within the source frame.");
    if (run.source.kind === "video" && !videoReady)
      throw new Error("Reattach the source video before correcting a point.");
    if (run.source.kind === "video" && observedMediaTime === null)
      throw new Error(
        "No source-frame timestamp is available yet. Seek to another frame before recording a point.",
      );
    if (
      run.observations.length >= 2000 &&
      !run.observations.some((p) => near(p.t, run.cursor))
    )
      throw new Error("This investigation reached its 2,000-point limit.");
    const existing = run.observations.findIndex((p) => near(p.t, run.cursor));
    const point = {
      id:
        existing >= 0
          ? run.observations[existing].id
          : `point-${Date.now().toString(36)}-${++pointSequence}`,
      t: run.cursor,
      x,
      y,
      included: true,
      method,
      confidence: match?.confidence ?? null,
      ambiguity: match?.ambiguity ?? null,
    };
    if (run.source.kind === "video") {
      point.timestampSource =
        "requestVideoFrameCallback" in video
          ? "presented mediaTime"
          : "approximate currentTime";
      if (presentedFrames !== null) point.presentedFrames = presentedFrames;
    }
    if (existing >= 0) run.observations[existing] = point;
    else run.observations.push(point);
    run.observations.sort((a, b) => a.t - b.t);
    run.selectedId = point.id;
    run.gaps = run.gaps.filter((gap) => !near(gap.t, point.t));
    anchor = { x, y, t: point.t };
    blocked = false;
    if (method !== "ncc") {
      try {
        template = makeTemplate(frameGray(), x, y, run.settings.templateSize);
      } catch (e) {
        template = null;
        status(
          `Point saved. Assisted tracking cannot start here: ${e.message}`,
        );
      }
    }
    return point;
  }
  async function trackForward({ rememberBefore = true } = {}) {
    if (!template || !anchor || tracking || blocked) return;
    if (rememberBefore) remember();
    tracking = true;
    const token = ++operation;
    error("");
    render();
    const step = Number($("[data-step]").value),
      radius = Number($("[data-radius]").value),
      threshold = Number($("[data-threshold]").value);
    if (
      ![step, radius, threshold].every(finite) ||
      step < 0.01 ||
      step > 1 ||
      radius < 12 ||
      radius > 120 ||
      threshold < 0.5 ||
      threshold > 0.99
    ) {
      stop();
      error(
        "Use step 0.01–1 s, radius 12–120 px and match threshold 0.50–0.99.",
      );
      render();
      return;
    }
    let time = anchor.t + step,
      count = 0;
    status("Tracking rendered pixels inside the bounded search area…");
    try {
      while (
        time <= run.source.duration + 1e-8 &&
        count < 600 &&
        token === operation &&
        !disposed
      ) {
        const actual = await seekFrame(
          Math.min(time, run.source.duration),
          true,
        );
        if (token !== operation || disposed) break;
        if (actual <= anchor.t + 1e-6) {
          time += step;
          continue;
        }
        const match = matchTemplate(frameGray(), template, anchor, {
          radius,
          threshold,
          ambiguityThreshold: run.settings.ambiguityMargin,
        });
        $("[data-match-note]").textContent =
          `NCC similarity ${fmt(match.confidence)}; separated-match margin ${fmt(match.ambiguity)} (minimum 0.08). Scores are not probabilities.`;
        if (!match.accepted) {
          run.gaps.push({
            t: actual,
            reason: match.reason,
            confidence: match.confidence,
            ambiguity: match.ambiguity,
          });
          blocked = true;
          status(
            `Tracking stopped at ${actual.toFixed(3)} s. No observation was added. Manually correct this frame to continue.`,
          );
          break;
        }
        recordPoint(match.candidate.x, match.candidate.y, "ncc", match);
        count++;
        time = Math.max(time + step, actual + step * 0.5);
        render();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (token === operation && !blocked)
        status(
          count === 600 && time < run.source.duration
            ? "Batch limit reached: 600 accepted matches. Inspect this batch, then Track forward to continue."
            : `Tracking complete: ${count} accepted matches. Inspect both model residuals and the marked frames.`,
        );
    } catch (e) {
      if (!disposed && token === operation) error(e.message);
    }
    if (token === operation) {
      tracking = false;
      render();
      changed("tracking");
    }
  }
  function seedGenerated() {
    prepareFrame();
    recordPoint(120, 440, "seed");
    status(
      "Generated first-frame target seeded. Extracting subsequent observations from rendered pixels.",
    );
  }
  async function loadGenerated(scenario, auto = true) {
    sourceLoad++;
    stop();
    releaseVideo();
    history = [];
    template = null;
    anchor = null;
    blocked = false;
    picking = null;
    rulerPoints = [];
    run = generatedRun(scenario);
    prepareFrame();
    seedGenerated();
    render();
    changed("source");
    if (auto) await trackForward({ rememberBefore: false });
  }
  async function loadVideo(file) {
    if (!file) return;
    if (file.size > 200 * 1024 ** 2 || file.size <= 0) {
      error("Choose a nonempty video no larger than 200 MiB.");
      return;
    }
    stop();
    const token = ++sourceLoad,
      expected = run.source.kind === "video" && !videoReady ? run.source : null;
    if (
      expected &&
      (file.name !== expected.name || file.size !== expected.bytes)
    ) {
      error(
        `This investigation requires ${expected.name} (${expected.bytes} bytes). Choose Generated flight first to begin a different investigation.`,
      );
      return;
    }
    const candidate = document.createElement("video");
    candidate.preload = "auto";
    candidate.muted = true;
    candidate.playsInline = true;
    const url = URL.createObjectURL(file);
    candidate.src = url;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                "Video decoding timed out. Try a browser-supported MP4 or WebM.",
              ),
            ),
          10000,
        );
        candidate.addEventListener(
          "loadeddata",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        candidate.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(
              new Error(
                "This browser could not decode the video. Previous investigation retained.",
              ),
            );
          },
          { once: true },
        );
      });
      if (token !== sourceLoad || disposed) {
        URL.revokeObjectURL(url);
        return;
      }
      const width = candidate.videoWidth,
        height = candidate.videoHeight,
        duration = candidate.duration;
      if (
        ![width, height].every((n) => n >= 32 && n <= 3840) ||
        width * height > 8_400_000 ||
        !finite(duration) ||
        duration <= 0 ||
        duration > 1800
      )
        throw new Error(
          "Use video up to 30 minutes and 8.4 MP, 32–3840 px on each side.",
        );
      if (
        expected &&
        (width !== expected.width ||
          height !== expected.height ||
          Math.abs(duration - expected.duration) > 0.05)
      )
        throw new Error(
          "This video does not match the saved source dimensions and duration.",
        );
      releaseVideo();
      videoURL = url;
      // Register before assigning src, so the initial point receives a real
      // presentation timestamp rather than assuming the first frame is time 0.
      let firstFrameCallback = null,
        firstFrameTimer = null;
      const firstFrame =
        "requestVideoFrameCallback" in video
          ? new Promise((resolve) => {
              firstFrameCallback = video.requestVideoFrameCallback(
                (_, metadata) => {
                  clearTimeout(firstFrameTimer);
                  firstFrameCallback = null;
                  resolve({
                    time: metadata.mediaTime,
                    frames: metadata.presentedFrames,
                  });
                },
              );
              firstFrameTimer = setTimeout(() => {
                if (firstFrameCallback !== null)
                  video.cancelVideoFrameCallback(firstFrameCallback);
                resolve(null);
              }, 2500);
            })
          : Promise.resolve(null);
      video.src = url;
      await new Promise((resolve, reject) => {
        video.addEventListener("loadeddata", resolve, { once: true });
        video.addEventListener(
          "error",
          () => reject(new Error("Video could not be attached.")),
          { once: true },
        );
      });
      const firstPresented = await firstFrame;
      if (disposed || token !== sourceLoad) return;
      videoReady = true;
      observedMediaTime =
        firstPresented?.time ??
        ("requestVideoFrameCallback" in video ? null : video.currentTime);
      presentedFrames = firstPresented?.frames ?? null;
      if (!expected) {
        run = {
          ...generatedRun(),
          name: `Motion in ${file.name}`,
          source: {
            kind: "video",
            name: file.name,
            bytes: file.size,
            lastModified: file.lastModified,
            width,
            height,
            duration,
            timing:
              "requestVideoFrameCallback" in video
                ? "presented mediaTime during assisted tracking"
                : "manual approximate currentTime",
          },
          calibration: {
            a: { x: width * 0.1, y: height * 0.88 },
            b: { x: width * 0.3, y: height * 0.88 },
            lengthMeters: null,
            origin: { x: width * 0.1, y: height * 0.9 },
            yUp: true,
            lengthBoundMeters: 0,
            pointBoundPixels: 1,
          },
          observations: [],
          gaps: [],
          fitStart: 0,
          fitEnd: duration,
          cursor: observedMediaTime ?? 0,
          selectedId: null,
          notes: "",
        };
        history = [];
      }
      template = null;
      anchor = null;
      blocked = false;
      prepareFrame();
      render();
      status(
        expected
          ? "Source reattached by matching filename, size, dimensions and duration. Verify the frame content before editing."
          : `Video attached. Pick a known ruler, then select the target. ${"requestVideoFrameCallback" in video ? "Presented-frame timestamps available." : "Assisted tracking unavailable; manual marking uses approximate media time."}`,
      );
      changed("video");
      if (expected && run.cursor > 0) await seek(run.cursor, false);
    } catch (e) {
      URL.revokeObjectURL(url);
      if (!disposed) error(e.message);
    } finally {
      candidate.removeAttribute("src");
      candidate.load();
    }
  }
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportRun() {
    return copy(run);
  }
  function loadRun(input) {
    const next = validateMotionRun(input);
    initialized = false;
    sourceLoad++;
    stop();
    releaseVideo();
    history = [];
    run = next;
    template = null;
    anchor = null;
    blocked = false;
    picking = null;
    rulerPoints = [];
    prepareFrame();
    render();
    error("");
    status(
      run.source.kind === "video"
        ? `Investigation restored. Reattach ${run.source.name} to inspect/correct source frames. Data and fits are available now.`
        : "Investigation restored with source recipe, observations, exclusions, calibration and model. Select a target to resume tracking.",
    );
    changed("restore");
    return true;
  }
  on($("[data-source]"), "change", (event) => {
    if (event.target.value === "local") {
      $("[data-video-file]").click();
      event.target.value =
        run.source.kind === "generated" ? run.source.scenario : "local";
    } else loadGenerated(event.target.value).catch((e) => error(e.message));
  });
  on($("[data-video-file]"), "change", (event) => {
    loadVideo(event.target.files?.[0]);
    event.target.value = "";
  });
  on($("[data-time]"), "input", (event) => seek(Number(event.target.value)));
  const stepTime = (direction) =>
    seek(run.cursor + direction * (Number($("[data-step]").value) || STEP));
  on($("[data-prev]"), "click", () => stepTime(-1));
  on($("[data-next]"), "click", () => stepTime(1));
  on($("[data-seed]"), "click", () => {
    stop();
    picking = "select target";
    status(
      "Click the same target in the current source frame. This seeds a new fixed template; it does not fabricate future points.",
    );
  });
  on($("[data-track]"), "click", () => trackForward());
  on($("[data-stop]"), "click", () => {
    stop("Tracking stopped. Accepted observations are preserved.");
    render();
    changed("stop");
  });
  on($("[data-undo]"), "click", async () => {
    if (!history.length) return;
    stop();
    run = history.pop();
    template = null;
    anchor = null;
    blocked = false;
    if (run.source.kind === "video" && videoReady)
      await seek(run.cursor, false);
    else {
      prepareFrame();
      render();
    }
    status(
      "Previous investigation state restored. Select the target to resume assisted tracking.",
    );
    changed("undo");
  });
  on(canvas, "click", (event) => {
    stop();
    error("");
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width,
      y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    try {
      if (run.source.kind === "video" && !videoReady)
        throw new Error("Reattach the source video before selecting pixels.");
      if (picking === "pick ruler") {
        rulerPoints.push({ x, y });
        if (rulerPoints.length === 2) {
          if (
            Math.hypot(
              rulerPoints[1].x - rulerPoints[0].x,
              rulerPoints[1].y - rulerPoints[0].y,
            ) < 1
          )
            throw new Error(
              "Ruler endpoints must be at least one source pixel apart.",
            );
          remember();
          run.calibration.a = rulerPoints[0];
          run.calibration.b = rulerPoints[1];
          rulerPoints = [];
          picking = null;
          status(
            "Ruler endpoints recorded. Enter the known length and apply calibration.",
          );
          changed("ruler");
        } else status("Now select the second ruler endpoint.");
      } else if (picking === "pick origin") {
        remember();
        run.calibration.origin = { x, y };
        picking = null;
        status("Coordinate origin updated; observed pixels remain unchanged.");
        changed("origin");
      } else {
        remember();
        recordPoint(x, y);
        picking = null;
        status(
          `Target marked at ${run.cursor.toFixed(3)} s. Track forward or step and correct another frame.`,
        );
        changed("point");
      }
      render();
    } catch (e) {
      error(e.message);
    }
  });
  for (const target of [positionCanvas, residualCanvas]) {
    on(target, "click", (event) => {
      const geometry = chartGeometry.get(target),
        rect = target.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * geometry.width;
      const t = bound(
        ((x - geometry.pad.left) /
          (geometry.width - geometry.pad.left - geometry.pad.right)) *
          run.source.duration,
        0,
        run.source.duration,
      );
      if (run.observations.length) {
        const p = run.observations.reduce((a, b) =>
          Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b,
        );
        seek(p.t).then(() => {
          run.selectedId = p.id;
          renderPoints();
        });
      } else seek(t);
    });
    on(target, "keydown", (event) => {
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        stepTime(event.key === "ArrowLeft" ? -1 : 1);
      }
    });
  }
  on($("[data-axis]"), "change", (event) => {
    selectedAxis = event.target.value;
    run.settings.chartAxis = event.target.value;
    renderAnalysis();
    changed("plot");
  });
  for (const [selector, name, min, max] of [
    ["step", "step", 0.01, 1],
    ["radius", "searchRadius", 12, 120],
    ["threshold", "minSimilarity", 0.5, 0.99],
  ])
    on($("[data-" + selector + "]"), "change", (event) => {
      const next = Number(event.target.value);
      if (
        event.target.value === "" ||
        !finite(next) ||
        next < min ||
        next > max
      ) {
        error(`Use ${min}–${max} for ${name}.`);
        return;
      }
      run.settings[name] = next;
      error("");
      drawSpecimen();
      changed("tracking settings");
    });
  const chooseModel = (value) => {
    if (!["linear", "ballistic", "quadratic"].includes(value)) return;
    remember();
    run.model = value;
    render();
    changed("model");
  };
  on($("[data-model]"), "change", (event) => chooseModel(event.target.value));
  on($("[data-comparison]"), "click", (event) => {
    const button = event.target.closest("[data-comparison-model]");
    if (button) chooseModel(button.dataset.comparisonModel);
  });
  const updateWindow = () => {
    const start = Number($("[data-fit-start]").value),
      end = Number($("[data-fit-end]").value);
    if (
      !finite(start) ||
      !finite(end) ||
      start < 0 ||
      end > run.source.duration ||
      start >= end
    ) {
      error("Fit interval must increase and stay inside the source duration.");
      return;
    }
    remember();
    run.fitStart = start;
    run.fitEnd = end;
    error("");
    render();
    changed("window");
  };
  on($("[data-fit-start]"), "change", updateWindow);
  on($("[data-fit-end]"), "change", updateWindow);
  on($("[data-full]"), "click", () => {
    remember();
    run.fitStart = 0;
    run.fitEnd = run.source.duration;
    render();
    changed("window");
  });
  on($("[data-ruler]"), "click", () => {
    stop();
    rulerPoints = [];
    picking = "pick ruler";
    status(
      "Select the first endpoint of a known length in the plane of motion.",
    );
  });
  on($("[data-origin-pick]"), "click", () => {
    stop();
    picking = "pick origin";
    status(
      "Select the coordinate origin. Positive x points right; vertical direction is set below.",
    );
  });
  on($("[data-calibrate]"), "click", () => {
    const length = Number($("[data-length]").value),
      lengthBound = Number($("[data-length-bound]").value),
      pointBound = Number($("[data-point-bound]").value);
    if (
      $("[data-length]").value === "" ||
      ![length, lengthBound, pointBound].every(finite) ||
      length < 1e-6 ||
      length > 1e6 ||
      lengthBound < 0 ||
      lengthBound >= length ||
      pointBound < 0 ||
      pointBound > 100
    ) {
      error(
        "Enter a positive ruler length, a smaller nonnegative length bound and a point bound of 0–100 pixels.",
      );
      return;
    }
    const coordinate = (name) =>
      $("[data-" + name + "]").value === ""
        ? NaN
        : Number($("[data-" + name + "]").value);
    const a = { x: coordinate("ruler-ax"), y: coordinate("ruler-ay") },
      b = { x: coordinate("ruler-bx"), y: coordinate("ruler-by") },
      origin = { x: coordinate("origin-x"), y: coordinate("origin-y") };
    if (
      ![a, b, origin].every(
        (p) =>
          [p.x, p.y].every(finite) &&
          p.x >= 0 &&
          p.y >= 0 &&
          p.x <= run.source.width &&
          p.y <= run.source.height,
      ) ||
      Math.hypot(a.x - b.x, a.y - b.y) < 1
    ) {
      error(
        "Ruler endpoints and origin must lie inside the source frame; endpoints must be at least one pixel apart.",
      );
      return;
    }
    remember();
    run.calibration = {
      ...run.calibration,
      a,
      b,
      origin,
      lengthMeters: length,
      lengthBoundMeters: lengthBound,
      pointBoundPixels: pointBound,
      yUp: $("[data-y-direction]").value === "up",
    };
    error("");
    render();
    status(
      "Calibration updated. All fits use the original observed pixels with the new scale.",
    );
    changed("calibration");
  });
  on($("[data-pixels]"), "click", () => {
    remember();
    run.calibration.lengthMeters = null;
    run.calibration.lengthBoundMeters = 0;
    run.calibration.yUp = $("[data-y-direction]").value === "up";
    render();
    changed("calibration");
  });
  on($("[data-point-select]"), "change", (event) => {
    const p = run.observations.find((p) => p.id === event.target.value);
    run.selectedId = p?.id ?? null;
    if (p)
      seek(p.t).then(() => {
        run.selectedId = p.id;
        renderPoints();
      });
    else renderPoints();
  });
  on($("[data-table]"), "click", (event) => {
    const b = event.target.closest("[data-point-id]"),
      p = b && run.observations.find((p) => p.id === b.dataset.pointId);
    if (p)
      seek(p.t).then(() => {
        run.selectedId = p.id;
        renderPoints();
      });
  });
  on($("[data-record]"), "click", () => {
    try {
      stop();
      if ($("[data-point-x]").value === "" || $("[data-point-y]").value === "")
        throw new Error("Enter both source-pixel coordinates.");
      remember();
      recordPoint(
        Number($("[data-point-x]").value),
        Number($("[data-point-y]").value),
      );
      render();
      changed("point");
      error("");
    } catch (e) {
      error(e.message);
    }
  });
  on($("[data-exclude]"), "click", () => {
    const p = run.observations.find((p) => p.id === run.selectedId);
    if (p) {
      stop();
      remember();
      p.included = !p.included;
      if (!p.included && anchor && near(anchor.t, p.t)) {
        anchor = null;
        template = null;
      }
      render();
      changed("exclusion");
    }
  });
  on($("[data-delete]"), "click", () => {
    if (!run.selectedId) return;
    stop();
    remember();
    run.observations = run.observations.filter((p) => p.id !== run.selectedId);
    run.selectedId = null;
    anchor = null;
    template = null;
    render();
    changed("delete");
  });
  on($("[data-question-input]"), "change", (event) => {
    remember();
    run.question = event.target.value;
    render();
    changed("question");
  });
  on($("[data-notes]"), "change", (event) => {
    remember();
    run.notes = event.target.value;
    changed("notes");
  });
  const save = () =>
    download(
      "physicsbench-motion.json",
      JSON.stringify(exportRun(), null, 2),
      "application/json",
    );
  on($("[data-save]"), "click", () => {
    try {
      if (options.onSave)
        Promise.resolve(options.onSave(exportRun())).catch((e) =>
          error(e.message),
        );
      else save();
    } catch (e) {
      error(e.message);
    }
  });
  on($("[data-json]"), "click", save);
  on($("[data-csv]"), "click", () => {
    const rows = [
      "time_s,x_source_px,y_source_px,x_" +
        unit() +
        ",y_" +
        unit() +
        ",included,method,ncc_similarity",
    ];
    for (const p of run.observations) {
      const w = world(p);
      rows.push(
        [
          p.t,
          p.x,
          p.y,
          w.x,
          w.y,
          p.included,
          p.method,
          p.confidence ?? "",
        ].join(","),
      );
    }
    download(
      "physicsbench-motion-observations.csv",
      rows.join("\n") + "\n",
      "text/csv",
    );
  });
  on($("[data-open]"), "change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2 * 1024 ** 2)
        throw new Error("Investigation JSON must be at most 2 MiB.");
      const parsed = JSON.parse(await file.text());
      loadRun(parsed);
    } catch (e) {
      error(e.message);
    }
  });
  document.addEventListener(
    "bench:pause",
    () => {
      stop();
      if (!disposed) render();
    },
    { signal: events.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        stop();
        if (!disposed) render();
      }
    },
    { signal: events.signal },
  );
  let chartWidth = 0;
  const resizeCharts = new ResizeObserver(() => {
    const width = Math.round(positionCanvas.getBoundingClientRect().width);
    if (width > 0 && width !== chartWidth && !disposed) {
      chartWidth = width;
      renderAnalysis();
    }
  });
  resizeCharts.observe(positionCanvas.parentElement);
  const cleanup = () => {
    disposed = true;
    sourceLoad++;
    stop();
    events.abort();
    resizeCharts.disconnect();
    releaseVideo();
    root.remove();
  };
  cleanup.exportRun = exportRun;
  cleanup.loadRun = loadRun;
  cleanup.getTitle = () => run.name;
  cleanup.pause = () => {
    stop();
    render();
  };
  if (options.run) loadRun(options.run);
  else {
    prepareFrame();
    render();
    initialized = true;
    Promise.resolve().then(() => {
      if (!disposed && initialized)
        loadGenerated("flight").catch((e) => error(e.message));
    });
  }
  return cleanup;
}
