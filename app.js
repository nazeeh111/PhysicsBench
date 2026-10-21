import { sweepModel, exportSweep } from "./sweep.js";
import { LABS, defaults, createModel, sampleModel } from "./models.js";
import {
  exportSession,
  importSession,
  exportCSV,
  importCSV,
  SESSION_MAX_BYTES,
  CSV_MAX_BYTES,
} from "./data.js";

const $ = (id) => document.getElementById(id);
const ns = "http://www.w3.org/2000/svg";
const fmt = (n, digits = 3) =>
  Number.isFinite(n)
    ? Number(n.toPrecision(digits + 1)).toLocaleString("en", {
        maximumFractionDigits: digits + 2,
      })
    : "—";
const paramsByLab = Object.fromEntries(
  Object.keys(LABS).map((key) => [key, defaults(key)]),
);
let lab = "projectile",
  model = createModel(lab, paramsByLab[lab]),
  time = 0,
  playing = false,
  frame = 0,
  lastStamp = 0;
let samples = [],
  comparison = null,
  plotGeometry = null,
  importSequence = 0;
let selectedPlot = null,
  sweepResult = null;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function svg(tag, attributes = {}, text) {
  const el = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes))
    el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}
function line(parent, x1, y1, x2, y2, className = "axis") {
  parent.append(svg("line", { x1, y1, x2, y2, class: className }));
}
function label(parent, x, y, text, anchor = "start") {
  parent.append(svg("text", { x, y, "text-anchor": anchor }, text));
}
function clearSVG(target, title, description, prefix) {
  target.replaceChildren(
    svg("title", { id: `${prefix}-title` }, title),
    svg("desc", { id: `${prefix}-description` }, description),
  );
  target.setAttribute(
    "aria-labelledby",
    `${prefix}-title ${prefix}-description`,
  );
}
function notice(text) {
  $("notice").textContent = text;
}
function clearError() {
  $("error").hidden = true;
  $("error").textContent = "";
}
function report(error) {
  $("error").textContent =
    `${error.message || "The file could not be read."} Last valid experiment retained.`;
  $("error").hidden = false;
}
function pause(message) {
  playing = false;
  cancelAnimationFrame(frame);
  updatePlay();
  if (message) notice(message);
}
function updatePlay() {
  $("play").textContent = reducedMotion.matches
    ? "Step"
    : playing
      ? "Pause"
      : time >= model.duration && model.duration > 0
        ? "Replay"
        : "Play";
  $("play").disabled = model.duration === 0;
}
function install(nextLab, nextParams, nextTime = 0) {
  const nextModel = createModel(nextLab, nextParams); // Construct before replacing any valid state.
  if (
    !Number.isFinite(nextTime) ||
    nextTime < 0 ||
    nextTime > nextModel.duration
  )
    throw new Error("Invalid session time.");
  pause();
  lab = nextLab;
  paramsByLab[lab] = nextModel.params;
  model = nextModel;
  time = nextTime;
  comparison = null;
  importSequence += 1;
  renderExperiment();
  clearError();
}
function renderExperiment() {
  const spec = LABS[lab];
  selectedPlot = { ...spec.plot };
  renderPresets();
  renderSweepControls();
  document
    .querySelectorAll("[data-lab]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.lab === lab)),
    );
  $("lab-name").textContent = spec.name;
  $("lab-subtitle").textContent = spec.subtitle;
  $("parameter-fields").replaceChildren();
  for (const p of spec.parameters) {
    const wrapper = element("div", undefined, "field"),
      labelling = element("label", p.label),
      unit = element("span", p.unit, "unit");
    const input = element("input");
    input.type = "number";
    input.id = `parameter-${p.key}`;
    input.name = p.key;
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = "any";
    input.required = true;
    input.value = String(model.params[p.key]);
    labelling.htmlFor = input.id;
    labelling.append(unit);
    input.setAttribute("aria-describedby", "parameter-help");
    wrapper.append(labelling, input);
    $("parameter-fields").append(wrapper);
  }
  $("parameters").querySelector(".small-note").id = "parameter-help";
  $("equations").replaceChildren(
    ...spec.equations.map((text) => element("li", text)),
  );
  $("assumptions").replaceChildren(
    ...spec.assumptions.map((text) => element("li", text)),
  );
  $("source-link").textContent = `OpenStax: ${spec.source[0]}`;
  $("source-link").href = spec.source[1];
  $("model-window").textContent =
    lab === "projectile"
      ? `Flight time ${fmt(model.duration)} s · apex ${fmt(model.summary.apex)} m`
      : lab === "oscillator"
        ? `Period ${fmt(model.summary.period)} s · four periods`
        : model.eventTime === null
          ? "No future contact: bodies are not approaching."
          : model.eventTime > model.duration
            ? Number.isFinite(model.eventTime)
              ? `Contact at ${fmt(model.eventTime)} s, beyond the ${fmt(model.duration)} s window.`
              : `Contact is beyond the ${fmt(model.duration)} s viewing window.`
            : `Contact at ${fmt(model.eventTime)} s · outgoing state at contact`;
  $("scene-scale").textContent =
    lab === "projectile"
      ? "Equal spatial scale on both axes. The arrow shows velocity direction at a fixed length."
      : lab === "oscillator"
        ? "Displacement is measured from equilibrium. Spring and block geometry are illustrative; arrow shows restoring-force direction."
        : "Centre positions and 1 m contact width use the horizontal metre scale. Arrows show velocity direction at fixed length.";
  $("time").max = String(model.duration || 1);
  $("time").disabled = model.duration === 0;
  $("time-range").textContent = `0–${fmt(model.duration)} s`;
  samples = sampleModel(model);
  $("secondary-legend").hidden = lab !== "collision";
  $("comparison-legend").hidden = true;
  $("clear-comparison").hidden = true;
  $("comparison-note").textContent =
    "CSV files contain reproducible PhysicsBench model samples, units and parameters. Import a file from this lab to compare; measured-data CSV is not supported.";
  $("plot-title").textContent = `${spec.plot.label} over time`;
  const quantity = $("plot-quantity");
  quantity.replaceChildren(
    ...model.columns
      .filter((c) => c.key !== "t")
      .map((c) => {
        const o = element("option", `${c.label} (${c.unit})`);
        o.value = c.key;
        return o;
      }),
  );
  quantity.value = spec.plot.key;
  renderTable();
  renderPlot();
  renderState();
}
function renderTable() {
  const row = element("tr");
  for (const c of model.columns) {
    const th = element("th", `${c.label} (${c.unit})`);
    th.scope = "col";
    row.append(th);
  }
  $("sample-head").replaceChildren(row);
  const rows =
    model.duration === 0
      ? [model.stateAt(0)]
      : Array.from({ length: 11 }, (_, i) =>
          model.stateAt(model.duration * (i / 10)),
        );
  $("sample-caption").textContent =
    model.duration === 0
      ? "Immediate contact: one state"
      : "Eleven evenly spaced states from the current model. CSV exports up to 201 samples.";
  $("sample-body").replaceChildren(
    ...rows.map((state) => {
      const tr = element("tr");
      for (const c of model.columns)
        tr.append(element("td", fmt(state[c.key], 5)));
      return tr;
    }),
  );
}
// One SVG unit equals one layout pixel, so axis text remains readable on phones.
// Recompute only drawing geometry on resize; model parameters and time stay intact.
function drawingWidth(target, height) {
  const width = Math.max(260, target.clientWidth);
  target.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return width;
}
function renderScene(state) {
  const target = $("scene");
  clearSVG(
    target,
    `${LABS[lab].name} motion`,
    $("current-summary").textContent,
    "scene",
  );
  const width = drawingWidth(target, 300),
    left = 58,
    right = width - 24,
    spanWidth = right - left;
  const ticks = width < 480 ? 3 : 4;
  const defs = svg("defs"),
    marker = svg("marker", {
      id: "direction-arrow",
      viewBox: "0 0 8 8",
      refX: 7,
      refY: 4,
      markerWidth: 5,
      markerHeight: 5,
      orient: "auto",
    });
  marker.append(svg("path", { d: "M0 0 L8 4 L0 8z", fill: "#b7cad2" }));
  defs.append(marker);
  target.append(defs);
  const vector = (x, y, dx, dy) => {
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1e-12)
      target.append(
        svg("line", {
          x1: x,
          y1: y,
          x2: x + (24 * dx) / magnitude,
          y2: y + (24 * dy) / magnitude,
          class: "vector",
          "marker-end": "url(#direction-arrow)",
        }),
      );
  };
  if (lab === "projectile") {
    const scale = Math.min(
      spanWidth / Math.max(1, model.summary.horizontalDisplacement),
      214 / Math.max(1, model.summary.apex),
    );
    const X = (x) => left + x * scale,
      Y = (y) => 250 - y * scale;
    for (let i = 0; i <= ticks; i++) {
      const x = left + (i * spanWidth) / ticks,
        y = 250 - (i * 214) / ticks;
      line(target, x, 36, x, 250, "grid-line");
      line(target, left, y, right, y, "grid-line");
      label(target, x, 270, fmt((x - left) / scale), "middle");
      label(target, left - 9, y + 4, fmt((250 - y) / scale), "end");
    }
    label(target, right, 293, "x (m)", "end");
    label(target, left, 19, "y (m)");
    target.append(
      svg("path", {
        class: "trace",
        d: samples
          .map((s, i) => `${i ? "L" : "M"}${X(s.x)},${Y(s.y)}`)
          .join(" "),
      }),
    );
    target.append(
      svg("circle", {
        cx: X(state.x),
        cy: Y(state.y),
        r: 6,
        class: "body-one",
      }),
    );
    vector(X(state.x), Y(state.y), state.vx, -state.vy);
    $("scene-note").textContent =
      time === model.duration ? "Ground contact · pre-impact" : "Free flight";
  } else if (lab === "oscillator") {
    const span = Math.max(0.25, model.summary.amplitude),
      centre = left + spanWidth * 0.62,
      amplitudePixels = spanWidth * 0.27;
    const X = (x) => centre + (x / span) * amplitudePixels,
      bodyX = X(state.x);
    line(target, left, 200, right, 200);
    line(target, X(0), 55, X(0), 220, "cursor");
    target.append(
      svg("rect", { x: left, y: 92, width: 10, height: 108, fill: "#547078" }),
    );
    const start = left + 10,
      finish = bodyX - 20,
      count = 12;
    let spring = `M${start} 145`;
    for (let i = 1; i < count; i++)
      spring += ` L${start + ((finish - start) * i) / count} ${145 + (i % 2 ? -10 : 10)}`;
    spring += ` L${finish} 145`;
    target.append(svg("path", { d: spring, class: "trace" }));
    target.append(
      svg("rect", {
        x: bodyX - 20,
        y: 120,
        width: 40,
        height: 50,
        rx: 4,
        class: "body-one",
      }),
    );
    label(target, bodyX, 188, `${fmt(model.params.mass)} kg`, "middle");
    vector(bodyX, 100, state.force, 0);
    for (const v of [-span, 0, span]) {
      line(target, X(v), 198, X(v), 207);
      label(target, X(v), 227, fmt(v), "middle");
    }
    label(target, right, 260, "Displacement x (m)", "end");
    label(target, X(0), 43, "Equilibrium", "middle");
    $("scene-note").textContent = "Frictionless horizontal track";
  } else {
    const event =
      model.eventTime !== null && model.eventTime <= model.duration
        ? model.stateAt(model.eventTime)
        : model.stateAt(0);
    const endpoints = [model.stateAt(0), model.stateAt(model.duration), event];
    const low = Math.min(...endpoints.flatMap((s) => [s.x1, s.x2])) - 1.5,
      high = Math.max(...endpoints.flatMap((s) => [s.x1, s.x2])) + 1.5;
    const X = (x) => left + ((x - low) / (high - low)) * spanWidth,
      bodyWidth = spanWidth / (high - low);
    line(target, left, 205, right, 205);
    for (let i = 0; i <= ticks; i++) {
      const x = low + ((high - low) * i) / ticks;
      line(target, X(x), 204, X(x), 211);
      label(target, X(x), 234, fmt(x), "middle");
    }
    for (const [number, x, velocity, mass] of [
      [1, state.x1, state.v1, model.params.mass1],
      [2, state.x2, state.v2, model.params.mass2],
    ]) {
      target.append(
        svg("rect", {
          x: X(x) - bodyWidth / 2,
          y: 150,
          width: bodyWidth,
          height: 54,
          rx: Math.min(3, bodyWidth / 4),
          class: number === 1 ? "body-one" : "body-two",
        }),
      );
      const labelX = Math.max(65, Math.min(width - 65, X(x)));
      label(
        target,
        labelX,
        number === 1 ? 95 : 65,
        `Body ${number} · ${fmt(mass)} kg`,
        "middle",
      );
      line(target, labelX, number === 1 ? 103 : 73, X(x), 148, "cursor");
      vector(X(x), number === 1 ? 130 : 118, velocity, 0);
    }
    label(target, right, 260, "Centre position x (m)", "end");
    $("scene-note").textContent =
      model.eventTime === null
        ? "No future contact"
        : time < model.eventTime
          ? "Incoming velocities"
          : "Outgoing velocities";
  }
}
function renderPlot() {
  const plot = $("plot"),
    spec = selectedPlot || LABS[lab].plot,
    key = spec.key;
  clearSVG(
    plot,
    `${spec.label} against time`,
    "Current model is solid; body 2 is dashed; an imported sample set is dotted. A vertical line marks selected time.",
    "plot-accessible",
  );
  const width = drawingWidth(plot, 270),
    left = 62,
    right = width - 28,
    spanWidth = right - left,
    ticks = width < 480 ? 3 : 4;
  const ref = comparison
    ? comparison.rows.map((row) =>
        Object.fromEntries(comparison.columns.map((c, i) => [c.key, row[i]])),
      )
    : [];
  const allValues = [
    ...samples.map((s) => s[key]),
    ...ref.map((s) => s[key]),
    ...(lab === "collision" && key === "v1" ? samples.map((s) => s.v2) : []),
  ];
  const rawMin = Math.min(0, ...allValues),
    rawMax = Math.max(0, ...allValues),
    pad = Math.max(0.1, (rawMax - rawMin) * 0.12),
    low = rawMin - pad,
    high = rawMax + pad;
  const maxTime = Math.max(model.duration, ref.at(-1)?.t || 0, 0.001),
    X = (t) => left + (t / maxTime) * spanWidth,
    Y = (v) => 218 - ((v - low) / (high - low)) * 178;
  for (let i = 0; i <= ticks; i++) {
    const t = (maxTime * i) / ticks,
      v = low + ((high - low) * i) / ticks;
    line(plot, X(t), 40, X(t), 218, "grid-line");
    line(plot, left, Y(v), right, Y(v), "grid-line");
    label(plot, X(t), 240, fmt(t), "middle");
    label(plot, left - 11, Y(v) + 4, fmt(v), "end");
  }
  label(plot, left, 22, `${spec.label} (${spec.unit})`);
  label(plot, right, 263, "Time (s)", "end");
  const path = (states, field, className) =>
    plot.append(
      svg("path", {
        class: className,
        d: states
          .map((s, i) => `${i ? "L" : "M"}${X(s.t)},${Y(s[field])}`)
          .join(" "),
      }),
    );
  path(samples, key, "trace");
  if (lab === "collision" && key === "v1")
    path(samples, "v2", "trace secondary");
  if (ref.length) path(ref, key, "trace comparison");
  const cursor = svg("line", {
    x1: X(time),
    x2: X(time),
    y1: 34,
    y2: 224,
    class: "cursor",
  });
  plot.append(cursor);
  plotGeometry = { cursor, X };
}
function renderState() {
  const s = model.stateAt(time);
  $("time").value = String(time);
  $("time-output").value = `${fmt(time)} s`;
  let readings, summary;
  if (lab === "projectile") {
    readings = [
      ["Horizontal position", s.x, "m"],
      ["Height", s.y, "m"],
      ["Speed", s.speed, "m/s"],
      ["Specific energy", s.energySpecific, "J/kg"],
    ];
    summary = `Velocity (${fmt(s.vx)}, ${fmt(s.vy)}) m/s. Specific energy change from launch: ${(s.energySpecific - model.stateAt(0).energySpecific).toExponential(1)} J/kg.`;
  } else if (lab === "oscillator") {
    readings = [
      ["Displacement", s.x, "m"],
      ["Velocity", s.v, "m/s"],
      ["Restoring force", s.force, "N"],
      ["Total energy", s.energy, "J"],
    ];
    summary = `Kinetic ${fmt(s.kinetic)} J; spring potential ${fmt(s.potential)} J. Energy change: ${(s.energy - model.stateAt(0).energy).toExponential(1)} J.`;
  } else {
    readings = [
      ["Body 1 velocity", s.v1, "m/s"],
      ["Body 2 velocity", s.v2, "m/s"],
      ["Total momentum", s.momentum, "kg·m/s"],
      ["Kinetic energy", s.kinetic, "J"],
    ];
    summary = `Surface gap ${fmt(s.separation)} m; kinetic energy lost ${fmt(s.lostEnergy)} J. Momentum change: ${(s.momentum - model.summary.initialMomentum).toExponential(1)} kg·m/s.`;
  }
  $("readings").replaceChildren(
    ...readings.map(([name, value, unit]) => {
      const pair = element("div");
      pair.append(element("dt", name), element("dd", `${fmt(value)} ${unit}`));
      return pair;
    }),
  );
  $("current-summary").textContent = summary;
  renderScene(s);
  if (plotGeometry) {
    const x = plotGeometry.X(time);
    plotGeometry.cursor.setAttribute("x1", x);
    plotGeometry.cursor.setAttribute("x2", x);
  }
  updatePlay();
}
$("parameters").addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement)
    event.target.removeAttribute("aria-invalid");
  pause("Unapplied values. Apply & reset to update the experiment.");
});
$("parameters").addEventListener("submit", (event) => {
  event.preventDefault();
  clearError();
  try {
    const next = {};
    for (const p of LABS[lab].parameters) {
      const input = $(`parameter-${p.key}`),
        value = input.value.trim() === "" ? NaN : Number(input.value);
      if (!Number.isFinite(value) || value < p.min || value > p.max) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
        throw new Error(`${p.label}: enter ${p.min} to ${p.max} ${p.unit}.`);
      }
      next[p.key] = value;
    }
    install(lab, next);
    notice("Parameters applied. Time reset; paused.");
  } catch (error) {
    report(error);
  }
});
document.querySelectorAll("[data-lab]").forEach((button) =>
  button.addEventListener("click", () => {
    install(button.dataset.lab, paramsByLab[button.dataset.lab]);
    notice("Experiment selected. Paused at the initial state.");
  }),
);
function tick(stamp) {
  if (!playing) return;
  const dt = Math.min(0.1, Math.max(0, (stamp - lastStamp) / 1000));
  lastStamp = stamp;
  time = Math.min(model.duration, time + dt * Number($("rate").value));
  renderState();
  if (time >= model.duration)
    pause(
      lab === "projectile"
        ? "Ground contact. Readings are the instant before impact."
        : "End of viewing interval. Replay or scrub to inspect.",
    );
  else frame = requestAnimationFrame(tick);
}
$("play").addEventListener("click", () => {
  if (reducedMotion.matches) {
    time =
      time >= model.duration
        ? 0
        : Math.min(
            model.duration,
            time + (model.duration / 120) * Number($("rate").value),
          );
    renderState();
    notice(
      "Reduced motion: advanced one step. The time slider remains available.",
    );
    return;
  }
  if (playing) {
    pause("Paused. Scrub time to inspect an exact state.");
    return;
  }
  if (time >= model.duration) time = 0;
  playing = true;
  lastStamp = performance.now();
  updatePlay();
  notice("Playing. Values use the exact analytical model.");
  frame = requestAnimationFrame(tick);
});
$("reset").addEventListener("click", () => {
  pause();
  time = 0;
  renderState();
  notice("Time reset; parameters unchanged.");
});
$("time").addEventListener("input", () => {
  pause();
  time = Math.min(model.duration, Math.max(0, Number($("time").value)));
  renderState();
});
$("time").addEventListener("change", () =>
  notice(`Paused at ${fmt(time)} seconds.`),
);
reducedMotion.addEventListener("change", () =>
  pause(
    reducedMotion.matches
      ? "Reduced motion enabled: Play is replaced by Step."
      : "Paused. Continuous playback is available.",
  ),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) pause("Paused while the page is hidden.");
});
function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = element("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("session-export").addEventListener("click", () => {
  pause();
  download(
    exportSession(lab, model.params, time),
    "application/json",
    "physicsbench-session.json",
  );
  notice("Session exported: active lab, parameters and exact selected time.");
});
$("csv-export").addEventListener("click", () => {
  download(
    exportCSV(lab, model.params),
    "text/csv;charset=utf-8",
    "physicsbench-samples.csv",
  );
  notice("CSV exported from the current model over the full viewing interval.");
});
function importFile(button, input, limit, parse, accept) {
  $(button).addEventListener("click", () => {
    pause();
    $(input).click();
  });
  $(input).addEventListener("change", async () => {
    const file = $(input).files?.[0];
    if (!file) return;
    const sequence = ++importSequence;
    try {
      if (file.size > limit)
        throw new Error(`File exceeds the ${limit / 1024} KiB limit.`);
      const text = await file.text();
      if (sequence !== importSequence) return; // Ignore a stale read after another import or a parameter/lab change.
      const next = parse(text);
      accept(next);
      clearError();
    } catch (error) {
      if (sequence === importSequence) report(error);
    } finally {
      $(input).value = "";
    }
  });
}
importFile(
  "session-import",
  "session-file",
  SESSION_MAX_BYTES,
  importSession,
  (next) => {
    install(next.lab, next.params, next.time);
    notice(
      "Session restored and paused. Parameters and selected time are ready to inspect.",
    );
  },
);
importFile("csv-import", "csv-file", CSV_MAX_BYTES, importCSV, (next) => {
  if (next.lab !== lab)
    throw new Error(
      `Choose ${LABS[next.lab].name} before comparing this file.`,
    );
  comparison = next;
  $("comparison-legend").hidden = false;
  $("clear-comparison").hidden = false;
  $("comparison-note").textContent =
    `Imported ${next.rows.length} model samples. ${LABS[lab].parameters.map((p) => `${p.label}: ${fmt(next.params[p.key])} ${p.unit}`).join("; ")}. Current conditions and time are unchanged.`;
  renderPlot();
  notice("Validated CSV comparison added. Current model unchanged.");
});
$("clear-comparison").addEventListener("click", () => {
  comparison = null;
  $("comparison-legend").hidden = true;
  $("clear-comparison").hidden = true;
  $("comparison-note").textContent =
    "Comparison cleared. Export samples to save the current model, or compare another PhysicsBench CSV from this lab.";
  renderPlot();
  notice("Comparison cleared; current model unchanged.");
});
renderExperiment();
const observedWidths = new WeakMap();
const resizeObserver = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    if (observedWidths.get(target) === contentRect.width) continue;
    observedWidths.set(target, contentRect.width);
    if (target.id === "plot") renderPlot();
    else renderScene(model.stateAt(time));
  }
});
resizeObserver.observe($("scene"));
resizeObserver.observe($("plot"));
if (reducedMotion.matches)
  notice(
    "Reduced motion enabled. Use Step or the time slider; the experiment starts paused.",
  );

function renderPresets() {
  const definitions = {
    projectile: [
      ["Earth", { gravity: 9.81 }],
      ["Moon", { gravity: 1.62 }],
      ["Mars", { gravity: 3.71 }],
      ["Maximum range", { speed: 20, angle: 45, height: 0, gravity: 9.81 }],
    ],
    oscillator: [
      ["Slow oscillation", { mass: 2, stiffness: 2 }],
      ["Fast oscillation", { mass: 0.5, stiffness: 20 }],
      ["At rest", { displacement: 0, velocity: 0 }],
    ],
    collision: [
      ["Elastic", { restitution: 1 }],
      ["Partly elastic", { restitution: 0.5 }],
      ["Stick together", { restitution: 0 }],
      ["No contact", { velocity1: -2, velocity2: 2 }],
    ],
  };
  $("preset-buttons").replaceChildren(
    element("span", "TRY A PRESET", "eyebrow"),
    ...definitions[lab].map(([name, change]) => {
      const b = element("button", name);
      b.type = "button";
      b.addEventListener("click", () => {
        install(lab, { ...model.params, ...change });
        notice(`${name} preset applied. Paused.`);
      });
      return b;
    }),
  );
}
function renderSweepControls() {
  sweepResult = null;
  $("sweep-export").disabled = true;
  $("sweep-chart").replaceChildren();
  $("sweep-summary").textContent = "Choose a parameter and run a sweep.";
  $("sweep-error").hidden = true;
  $("sweep-parameter").replaceChildren(
    ...LABS[lab].parameters.map((p) => {
      const o = element("option", `${p.label} (${p.unit})`);
      o.value = p.key;
      return o;
    }),
  );
  if (lab === "projectile") $("sweep-parameter").value = "angle";
  if (lab === "collision") $("sweep-parameter").value = "restitution";
  setSweepBounds();
}
function setSweepBounds() {
  const p = LABS[lab].parameters.find(
    (p) => p.key === $("sweep-parameter").value,
  );
  $("sweep-min").value = p.min;
  $("sweep-max").value = p.max;
}
function drawSweep() {
  if (!sweepResult) return;
  const target = $("sweep-chart"),
    width = drawingWidth(target, 270),
    left = 65,
    right = width - 28,
    bottom = 220,
    top = 28;
  clearSVG(
    target,
    `${sweepResult.metric.label} parameter sweep`,
    $("sweep-summary").textContent,
    "sweep",
  );
  const rows = sweepResult.rows,
    xmin = rows[0].x,
    xmax = rows.at(-1).x,
    ymin = Math.min(0, ...rows.map((r) => r.y)),
    ymax = Math.max(1e-8, ...rows.map((r) => r.y));
  const X = (x) => left + ((x - xmin) / (xmax - xmin)) * (right - left),
    Y = (y) =>
      bottom - ((y - ymin) / Math.max(1e-8, ymax - ymin)) * (bottom - top - 12);
  for (let i = 0; i <= 4; i++) {
    const x = xmin + ((xmax - xmin) * i) / 4,
      y = ymin + ((ymax - ymin) * i) / 4;
    line(target, X(x), top, X(x), bottom, "grid-line");
    line(target, left, Y(y), right, Y(y), "grid-line");
    label(target, X(x), 244, fmt(x), "middle");
    label(target, left - 10, Y(y) + 4, fmt(y), "end");
  }
  label(
    target,
    left,
    17,
    `${sweepResult.metric.label} (${sweepResult.metric.unit})`,
  );
  label(
    target,
    right,
    265,
    `${sweepResult.parameterLabel} (${sweepResult.parameterUnit})`,
    "end",
  );
  target.append(
    svg("path", {
      class: "trace",
      d: rows.map((r, i) => `${i ? "L" : "M"}${X(r.x)},${Y(r.y)}`).join(" "),
    }),
  );
}
$("plot-quantity").addEventListener("change", () => {
  const c = model.columns.find((c) => c.key === $("plot-quantity").value);
  selectedPlot = { key: c.key, label: c.label, unit: c.unit };
  $("plot-title").textContent = `${c.label} over time`;
  $("secondary-legend").hidden = !(lab === "collision" && c.key === "v1");
  renderPlot();
});
$("send-analysis").addEventListener("click", () => {
  pause();
  const points = samples.map((s) => ({
    t: s.t,
    y: lab === "collision" ? s.x1 : lab === "projectile" ? s.y : s.x,
  }));
  document.dispatchEvent(
    new CustomEvent("bench:analyze", {
      detail: {
        points,
        unit: "m",
        name: `${LABS[lab].name} model`,
        provenance: `Analytical simulation; not measured data. Parameters: ${JSON.stringify(model.params)}`,
      },
    }),
  );
});
$("sweep-toggle").addEventListener("click", () => {
  const opened = $("sweep-panel").hidden;
  $("sweep-panel").hidden = !opened;
  $("sweep-toggle").setAttribute("aria-expanded", String(opened));
  if (opened) drawSweep();
});
$("sweep-parameter").addEventListener("change", setSweepBounds);
$("sweep-run").addEventListener("click", () => {
  try {
    const lo = $("sweep-min").value.trim(),
      hi = $("sweep-max").value.trim();
    if (!lo || !hi) throw new Error("Enter both sweep bounds.");
    const next = sweepModel(
      lab,
      model.params,
      $("sweep-parameter").value,
      Number(lo),
      Number(hi),
    );
    sweepResult = next;
    $("sweep-error").hidden = true;
    $("sweep-export").disabled = false;
    const best = next.rows.reduce((a, b) => (a.y > b.y ? a : b));
    $("sweep-summary").textContent =
      `41 model predictions. Largest sampled ${next.metric.label.toLowerCase()}: ${fmt(best.y)} ${next.metric.unit} at ${fmt(best.x)} ${next.parameterUnit}. This is a discrete sweep, not a proof of a global optimum.`;
    drawSweep();
  } catch (error) {
    $("sweep-error").textContent = error.message;
    $("sweep-error").hidden = false;
  }
});
$("sweep-export").addEventListener("click", () => {
  if (sweepResult)
    download(exportSweep(sweepResult), "text/csv", "physicsbench-sweep.csv");
});
document.addEventListener("bench:pause", () => pause());
new ResizeObserver(() => {
  if (!$("sweep-panel").hidden) drawSweep();
}).observe($("sweep-panel"));
