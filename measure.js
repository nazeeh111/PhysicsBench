import {
  fitPolynomial,
  parseMeasurementCSV,
  projectileDemo,
  measurementsCSV,
  validatePoints,
  predictFit,
} from "./analysis.js";

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const number = (value, digits = 4) =>
  Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : "—";

export function mountMeasure(container, initialDataset) {
  let disposed = false,
    revision = 0,
    videoURL = null,
    dataset,
    fit = null;
  let videoPoints = [],
    calibrationClicks = [],
    calibrationPick = false,
    videoReady = false,
    videoSession = 0,
    activeVideoFile = null;
  const datasetHistory = [];
  let historySequence = 0,
    currentHistoryKey = null;
  const events = new AbortController();
  const on = (node, name, handler) =>
    node.addEventListener(name, handler, { signal: events.signal });
  const section = make("section", undefined, "measurement-layout");
  const intro = make("div", undefined, "panel");
  intro.append(
    make("p", "FROM MOTION TO EVIDENCE", "eyebrow"),
    make("h2", "Measure. Fit. Question."),
    make(
      "p",
      "Track a local video or bring two columns of observations. Compare a model with evidence, inspect what it misses, and export a reproducible record.",
      "panel-caption",
    ),
  );
  const toolbar = make("div", undefined, "toolbar");
  const demoButton = make("button", "Load projectile demo");
  const csvLabel = make("label", "Import CSV ", "field");
  const csvFile = make("input");
  csvFile.type = "file";
  csvFile.accept = ".csv,text/csv";
  csvFile.setAttribute("aria-label", "Import two-column measurement CSV");
  csvLabel.append(csvFile);
  toolbar.append(demoButton, csvLabel);
  intro.append(toolbar);
  const historyToolbar = make("div", undefined, "toolbar");
  const historyLabel = make("label", "Session dataset ", "field");
  const historySelect = make("select");
  historyLabel.append(historySelect);
  const forgetDataset = make("button", "Remove saved dataset");
  const historyNote = make(
    "p",
    "Up to eight datasets are kept in this tab session. Export important work before closing or refreshing. Repeated edits to one video update its saved track.",
    "small-note",
  );
  historyToolbar.append(historyLabel, forgetDataset);
  intro.append(historyToolbar, historyNote);
  intro.append(
    make(
      "p",
      "CSV: time in seconds, value. Exactly two numeric columns, strictly increasing times, 2–10,000 rows, at most 1 MiB. Optional header: time_s,value. Files stay in this browser.",
      "small-note",
    ),
  );
  const provenance = make("p", undefined, "notice");
  const status = make("p", "", "small-note");
  status.setAttribute("role", "status");
  intro.append(provenance, status);
  section.append(intro);

  const videoPanel = make("details", undefined, "panel");
  videoPanel.append(make("summary", "Track an object in a local video"));
  videoPanel.append(
    make(
      "p",
      "Choose a short, steady, side-on clip. Pause and seek to different times, then click the same point on the object. No camera access or upload. Browser video seeking is approximate; timestamps are the video’s reported time, not a guaranteed frame clock.",
      "small-note",
    ),
  );
  const videoLabel = make("label", "Local video ", "field");
  const videoFile = make("input");
  videoFile.type = "file";
  videoFile.accept = "video/*";
  videoLabel.append(videoFile);
  const video = make("video", undefined, "measurement-video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.setAttribute("aria-label", "Local tracking video");
  const trackingCanvas = make("canvas", undefined, "measurement-canvas");
  trackingCanvas.width = 960;
  trackingCanvas.height = 540;
  trackingCanvas.setAttribute(
    "aria-label",
    "Video frame for manual point tracking. Use the pixel coordinate fields as a keyboard alternative.",
  );
  const videoControls = make("div", undefined, "toolbar");
  const inputField = (label, value, step = "any") => {
    const wrap = make("label", label, "field");
    const input = make("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    wrap.append(input);
    return [wrap, input];
  };
  const [timeWrap, seekTime] = inputField("Seek time (s)", "0", "0.001");
  seekTime.min = "0";
  const seekButton = make("button", "Seek");
  const [xWrap, pixelX] = inputField("X (source px)", "0", "1");
  const [yWrap, pixelY] = inputField("Y (source px, down)", "0", "1");
  const addPoint = make("button", "Record coordinate");
  const removePoint = make("button", "Remove latest time");
  const clearPoints = make("button", "Clear tracking");
  videoControls.append(
    timeWrap,
    seekButton,
    xWrap,
    yWrap,
    addPoint,
    removePoint,
    clearPoints,
  );
  const calibration = make("div", undefined, "toolbar");
  const [distanceWrap, knownDistance] = inputField("Reference length (m)", "");
  knownDistance.min = "0";
  const [pixelWrap, referencePixels] = inputField(
    "Reference length (source px)",
    "",
  );
  referencePixels.min = "0";
  const pickRuler = make("button", "Pick two ruler endpoints");
  const applyScale = make("button", "Apply calibration");
  const usePixels = make("button", "Use pixels");
  calibration.append(distanceWrap, pixelWrap, pickRuler, applyScale, usePixels);
  const videoStatus = make("p", "No video loaded.", "small-note");
  videoStatus.setAttribute("role", "status");
  const trackingList = make("p", "No tracked points.", "small-note");
  videoPanel.append(
    videoLabel,
    video,
    trackingCanvas,
    videoControls,
    calibration,
    make(
      "p",
      "Position is vertical height above the bottom of the video. Without a reference length it is in source pixels. Calibration assumes the ruler and object lie in the same plane, with fixed camera position and negligible perspective distortion. It does not correct camera motion, lens distortion or timing errors.",
      "small-note",
    ),
    videoStatus,
    trackingList,
  );
  section.append(videoPanel);

  const controls = make("div", undefined, "panel");
  controls.append(make("h3", "Choose the model and window"));
  const fitControls = make("div", undefined, "toolbar");
  const modelLabel = make("label", "Model ", "field");
  const model = make("select");
  for (const [value, label] of [
    ["2", "Quadratic · constant acceleration"],
    ["1", "Linear · constant velocity"],
  ]) {
    const option = make("option", label);
    option.value = value;
    model.append(option);
  }
  modelLabel.append(model);
  const unitLabel = make("label", "Value unit ", "field");
  const unitSelect = make("select");
  for (const [value, label] of [
    ["unknown", "Unspecified units"],
    ["m", "Meters (user supplied)"],
    ["px", "Pixels"],
  ]) {
    const option = make("option", label);
    option.value = value;
    unitSelect.append(option);
  }
  unitLabel.append(unitSelect);
  const [startWrap, startTime] = inputField("Fit start (s)", "0");
  const [endWrap, endTime] = inputField("Fit end (s)", "1.2");
  const resetRange = make("button", "Full time range");
  fitControls.append(modelLabel, unitLabel, startWrap, endWrap, resetRange);
  controls.append(fitControls);
  const fitStatus = make("p", "", "small-note");
  fitStatus.setAttribute("role", "status");
  controls.append(fitStatus);
  const metrics = make("div", undefined, "metric-grid");
  controls.append(metrics);
  const equation = make("p", "", "notice");
  controls.append(equation);
  controls.append(
    make(
      "p",
      "Ordinary least squares treats times and calibration as exact. The 95% coefficient intervals assume independent normal errors with constant variance in position. They omit calibration, tracking and timing uncertainty. A quadratic acceleration is a gravity estimate only for vertical free flight with upward-positive position, negligible drag and a stationary camera. A good R² alone does not establish the model.",
      "small-note",
    ),
  );
  section.append(controls);
  const plots = make("div", undefined, "measurement-plots");
  const plotPanel = make("div", undefined, "panel");
  const plotHeading = make("h3", "Observations and fitted motion");
  const plot = make("canvas", undefined, "chart");
  plot.width = 1100;
  plot.height = 420;
  plot.setAttribute("role", "img");
  plotPanel.append(
    plotHeading,
    make(
      "p",
      "Cyan dots: observations. Orange curve: fit within the selected time window.",
      "small-note",
    ),
    plot,
  );
  const residualPanel = make("div", undefined, "panel");
  const residual = make("canvas", undefined, "chart");
  residual.width = 1100;
  residual.height = 260;
  residual.setAttribute("role", "img");
  residualPanel.append(
    make("h3", "Residuals reveal the mismatch"),
    make(
      "p",
      "Observed minus predicted. Structure or curvature can indicate a missing physical effect; isolated spikes can indicate tracking errors.",
      "small-note",
    ),
    residual,
  );
  plots.append(plotPanel, residualPanel);
  section.append(plots);
  const exportPanel = make("div", undefined, "panel");
  const exportToolbar = make("div", undefined, "toolbar");
  const exportCSV = make("button", "Export observations CSV");
  const exportJSON = make("button", "Export analysis JSON");
  exportToolbar.append(exportCSV, exportJSON);
  const tableWrap = make("div", undefined, "table-scroll");
  const table = make("table");
  tableWrap.append(table);
  exportPanel.append(
    make("h3", "The evidence behind the curve"),
    exportToolbar,
    make(
      "p",
      "Table previews the first 50 observations in the fit window. CSV contains all observations, without fitted or fabricated measurements. JSON includes units, provenance, the selected window, calibration and complete fit results.",
      "small-note",
    ),
    tableWrap,
  );
  section.append(exportPanel);
  container.replaceChildren(section);

  function message(text, error = false) {
    status.textContent = text;
    status.className = error ? "error" : "small-note";
  }
  function refreshHistory() {
    historySelect.replaceChildren();
    const placeholder = make(
      "option",
      datasetHistory.length
        ? "Choose a saved dataset"
        : "No saved datasets yet",
    );
    placeholder.value = "";
    historySelect.append(placeholder);
    for (const entry of datasetHistory) {
      const option = make(
        "option",
        `${entry.dataset.name} · ${entry.dataset.points.length} points · ${entry.dataset.unit || "unspecified units"}`,
      );
      option.value = entry.key;
      historySelect.append(option);
    }
    historySelect.value = currentHistoryKey ?? "";
    forgetDataset.disabled = !historySelect.value;
  }
  function setDataset(next, stableKey) {
    const points = validatePoints(next.points);
    const candidate = { ...next, points };
    let nextKey = null;
    if (["csv", "video", "imported", "simulation"].includes(candidate.source)) {
      const existing = datasetHistory.find((entry) =>
        stableKey
          ? entry.key === stableKey
          : entry.dataset.source === candidate.source &&
            entry.dataset.name === candidate.name &&
            entry.dataset.unit === candidate.unit &&
            entry.dataset.points.length === points.length &&
            entry.dataset.points.every(
              (point, i) => point.t === points[i].t && point.y === points[i].y,
            ),
      );
      if (!existing && datasetHistory.length >= 8)
        throw new Error(
          "Session history is full (8 datasets). Export any important work, choose an old saved dataset and remove it before loading another. Current observations are retained.",
        );
      nextKey = existing?.key ?? stableKey ?? `dataset-${++historySequence}`;
      if (existing) existing.dataset = candidate;
      else datasetHistory.push({ key: nextKey, dataset: candidate });
    }
    dataset = candidate;
    currentHistoryKey = nextKey;
    startTime.value = points[0].t;
    endTime.value = points.at(-1).t;
    unitSelect.value = ["m", "px"].includes(dataset.unit)
      ? dataset.unit
      : "unknown";
    unitSelect.disabled =
      dataset.source === "video" ||
      dataset.source === "demo" ||
      dataset.source === "simulation";
    provenance.textContent = `${dataset.name} · ${dataset.provenance}`;
    refreshHistory();
    render();
  }
  on(historySelect, "change", () => {
    const entry = datasetHistory.find(
      (item) => item.key === historySelect.value,
    );
    if (!entry) {
      forgetDataset.disabled = true;
      return;
    }
    revision++;
    video.pause();
    setDataset(entry.dataset, entry.key);
    message(
      "Saved observations restored. The local video controls, if loaded, still refer to the current local clip.",
    );
  });
  on(forgetDataset, "click", () => {
    const index = datasetHistory.findIndex(
      (entry) => entry.key === historySelect.value,
    );
    if (index < 0) return;
    const removed = datasetHistory.splice(index, 1)[0];
    if (currentHistoryKey === removed.key) currentHistoryKey = null;
    refreshHistory();
    message(
      `Removed the saved session entry for ${removed.dataset.name}. The displayed analysis remains available until you replace it. Export it now if needed.`,
    );
  });
  function unitName() {
    return dataset.unit === "m" ? "m" : dataset.unit === "px" ? "px" : "units";
  }
  function render() {
    fit = null;
    metrics.replaceChildren();
    table.replaceChildren();
    equation.textContent = "";
    const start = Number(startTime.value),
      end = Number(endTime.value);
    try {
      if (
        startTime.value === "" ||
        endTime.value === "" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start >= end
      )
        throw new Error("Choose a finite start time before the end time.");
      const points = dataset.points.filter(
        (point) => point.t >= start && point.t <= end,
      );
      fit = fitPolynomial(points, Number(model.value));
      const unit = unitName();
      const metric = (label, value) => {
        const card = make("div", undefined, "metric-card");
        card.append(make("span", label, "small-note"), make("strong", value));
        metrics.append(card);
      };
      metric(
        "Observations / residual degrees of freedom",
        `${fit.n} / ${fit.df}`,
      );
      metric("Residual RMSE", `${number(fit.rmse)} ${unit}`);
      metric("R²", number(fit.r2, 5));
      const coefficient =
        fit.degree === 2 ? fit.coefficients[2] : fit.coefficients[1];
      const derivative = fit.degree === 2 ? 2 * coefficient : coefficient;
      const interval =
        fit.degree === 2 ? fit.ci95[2].map((value) => 2 * value) : fit.ci95[1];
      metric(
        fit.degree === 2 ? `Acceleration (${unit}/s²)` : `Velocity (${unit}/s)`,
        number(derivative),
      );
      metric(
        "95% model interval",
        `${number(interval[0])} to ${number(interval[1])}`,
      );
      if (fit.degree === 2 && dataset.unit === "m")
        metric(
          "Candidate g = −2a (m/s²)",
          `${number(-derivative)} [${number(-interval[1])}, ${number(-interval[0])}]`,
        );
      equation.textContent =
        fit.degree === 2
          ? `Position = ${number(fit.coefficients[0], 6)} + (${number(fit.coefficients[1], 6)})t + (${number(fit.coefficients[2], 6)})t² ${unit}.`
          : `Position = ${number(fit.coefficients[0], 6)} + (${number(fit.coefficients[1], 6)})t ${unit}.`;
      fitStatus.textContent = `${fit.n} of ${dataset.points.length} observations used · ${number(start, 6)}–${number(end, 6)} s. Residual RMSE = √(Σr²/n).`;
      fitStatus.className = "small-note";
      const header = make("tr");
      for (const title of [
        "Time (s)",
        `Observed (${unit})`,
        `Fit (${unit})`,
        `Residual (${unit})`,
      ])
        header.append(make("th", title));
      const head = make("thead");
      head.append(header);
      table.append(head);
      const body = make("tbody");
      for (const point of fit.observations.slice(0, 50)) {
        const row = make("tr");
        for (const value of [point.t, point.y, point.fitted, point.residual])
          row.append(make("td", number(value, 7)));
        body.append(row);
      }
      table.append(body);
      drawPlot(plot, false);
      drawPlot(residual, true);
      plot.setAttribute(
        "aria-label",
        `${dataset.name}: ${fit.n} position observations with ${fit.degree === 2 ? "quadratic" : "linear"} fit. R squared ${number(fit.r2)}. Data available in the table and CSV.`,
      );
      residual.setAttribute(
        "aria-label",
        `Residual plot, root mean square error ${number(fit.rmse)} ${unit}. Values are shown in the table.`,
      );
    } catch (error) {
      fitStatus.textContent = error.message;
      fitStatus.className = "error";
      for (const canvas of [plot, residual]) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#11191e";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
    exportJSON.disabled = !fit;
  }
  function drawPlot(canvas, isResidual) {
    const ctx = canvas.getContext("2d");
    if (!ctx || !fit) return;
    const w = canvas.width,
      h = canvas.height,
      l = 90,
      r = 28,
      top = 25,
      b = 55;
    ctx.fillStyle = "#11191e";
    ctx.fillRect(0, 0, w, h);
    const points = fit.observations;
    const minT = points[0].t,
      maxT = points.at(-1).t;
    const curve = Array.from({ length: 201 }, (_, i) => ({
      t: minT + ((maxT - minT) * i) / 200,
      y: predictFit(fit, minT + ((maxT - minT) * i) / 200),
    }));
    const values = isResidual
      ? points.map((point) => point.residual).concat(0)
      : points.map((point) => point.y).concat(curve.map((point) => point.y));
    let low = Math.min(...values),
      high = Math.max(...values);
    const padding = Math.max((high - low) * 0.15, Math.abs(high) * 0.01, 0.001);
    low -= padding;
    high += padding;
    const x = (t) => l + ((t - minT) / (maxT - minT)) * (w - l - r);
    const y = (value) => top + ((high - value) / (high - low)) * (h - top - b);
    ctx.font = "14px system-ui";
    for (let i = 0; i <= 4; i++) {
      const yy = top + (i / 4) * (h - top - b),
        xx = l + (i / 4) * (w - l - r);
      ctx.strokeStyle = "#27353d";
      ctx.beginPath();
      ctx.moveTo(l, yy);
      ctx.lineTo(w - r, yy);
      ctx.moveTo(xx, top);
      ctx.lineTo(xx, h - b);
      ctx.stroke();
      ctx.fillStyle = "#a9bac2";
      ctx.textAlign = "right";
      ctx.fillText(number(high - (i / 4) * (high - low), 4), l - 12, yy + 5);
      ctx.textAlign = "center";
      ctx.fillText(number(minT + (i / 4) * (maxT - minT)), xx, h - b + 25);
    }
    ctx.fillStyle = "#a9bac2";
    ctx.textAlign = "left";
    ctx.fillText(
      `${isResidual ? "Residual" : "Position"} (${unitName()})`,
      l,
      18,
    );
    ctx.textAlign = "center";
    ctx.fillText("Time (s)", (w + l - r) / 2, h - 8);
    ctx.strokeStyle = "#ff9951";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (isResidual) {
      ctx.moveTo(l, y(0));
      ctx.lineTo(w - r, y(0));
    } else
      curve.forEach((point, i) =>
        i
          ? ctx.lineTo(x(point.t), y(point.y))
          : ctx.moveTo(x(point.t), y(point.y)),
      );
    ctx.stroke();
    ctx.fillStyle = "#63d9cc";
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(
        x(point.t),
        y(isResidual ? point.residual : point.y),
        3.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  function loadDemo() {
    revision++;
    setDataset({
      points: projectileDemo(),
      unit: "m",
      name: "Synthetic projectile demo",
      source: "demo",
      provenance:
        "Generated from y = 0.4 + 6.7t − 4.905t² plus deterministic small perturbations. This is not a real measurement. Ground-truth g = 9.81 m/s².",
    });
    message(
      "Synthetic demo loaded. Try the linear model to expose its curved residual pattern.",
    );
  }
  on(demoButton, "click", loadDemo);
  on(csvFile, "change", async () => {
    const ticket = ++revision;
    const file = csvFile.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024)
        throw new Error("CSV must be at most 1 MiB.");
      const text = await file.text();
      if (disposed || ticket !== revision) return;
      const points = parseMeasurementCSV(text);
      setDataset({
        points,
        unit: "unknown",
        source: "csv",
        name: file.name,
        provenance:
          "User-imported observations. Time is interpreted as seconds; value units and physical interpretation must be supplied by you.",
      });
      message(
        `Imported ${points.length} observations. Set value units only if known.`,
      );
    } catch (error) {
      if (!disposed && ticket === revision)
        message(`${error.message} Previous valid observations retained.`, true);
    } finally {
      if (!disposed && ticket === revision) csvFile.value = "";
    }
  });
  on(model, "change", render);
  on(startTime, "input", render);
  on(endTime, "input", render);
  on(unitSelect, "change", () => {
    dataset.unit = unitSelect.value;
    refreshHistory();
    render();
  });
  on(resetRange, "click", () => {
    startTime.value = dataset.points[0].t;
    endTime.value = dataset.points.at(-1).t;
    render();
  });
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = make("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  on(exportCSV, "click", () =>
    download(
      measurementsCSV(dataset.points),
      "physicsbench-observations.csv",
      "text/csv",
    ),
  );
  on(exportJSON, "click", () => {
    if (!fit) return;
    download(
      JSON.stringify(
        {
          format: "physicsbench-measurement",
          version: 1,
          createdAt: new Date().toISOString(),
          dataset,
          timeUnit: "s",
          fitRange: {
            start: Number(startTime.value),
            end: Number(endTime.value),
          },
          fit,
          uncertaintyAssumptions:
            "Independent normal constant-variance errors in position. Time and calibration treated as exact; their errors are not included.",
          physicsCaveat:
            "g = -2a applies only to upward-positive vertical free flight under constant gravity with negligible drag.",
        },
        null,
        2,
      ),
      "physicsbench-analysis.json",
      "application/json",
    );
  });

  let activeScale = null;
  function paintFrame() {
    if (!videoReady || disposed) return;
    const ctx = trackingCanvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, trackingCanvas.width, trackingCanvas.height);
    for (const point of videoPoints) {
      ctx.strokeStyle = "#ff9951";
      ctx.lineWidth = 2;
      const x = (point.x / video.videoWidth) * trackingCanvas.width,
        y = (point.pixelY / video.videoHeight) * trackingCanvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const point of calibrationClicks) {
      ctx.fillStyle = "#63d9cc";
      ctx.beginPath();
      ctx.arc(
        (point.x / video.videoWidth) * trackingCanvas.width,
        (point.y / video.videoHeight) * trackingCanvas.height,
        5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    seekTime.value = number(video.currentTime, 8);
  }
  function updateTracking() {
    trackingList.textContent = `${videoPoints.length} tracked points${videoPoints.length ? ` · times ${number(videoPoints[0].t)}–${number(videoPoints.at(-1).t)} s` : ""}. ${activeScale ? `${number(activeScale.metersPerPixel, 7)} m/source px.` : "Uncalibrated: source pixels."}`;
    paintFrame();
    if (videoPoints.length >= 2) {
      revision++;
      try {
        setDataset(
          {
            points: videoPoints.map((point) => ({
              t: point.t,
              y:
                (video.videoHeight - point.pixelY) *
                (activeScale?.metersPerPixel ?? 1),
            })),
            unit: activeScale ? "m" : "px",
            name: activeVideoFile?.name ?? "Local video",
            source: "video",
            provenance:
              "Manually tracked local video. Vertical position increases upward from image bottom. Tracking and calibration errors are not included in fit intervals.",
            calibration: activeScale,
            video: {
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration,
            },
            rawTracking: videoPoints.map((point) => ({ ...point })),
          },
          `video-${videoSession}`,
        );
      } catch (error) {
        message(error.message, true);
      }
    } else if (dataset?.source === "video") {
      // Keep the last valid analysis while visibly explaining the new incomplete track.
      message(
        "Tracking has fewer than two points. The last valid analysis remains displayed until enough new points are recorded.",
      );
    }
  }
  function recordPoint(x, y) {
    if (!videoReady || video.seeking || video.readyState < 2) {
      videoStatus.textContent =
        "Wait for a decoded video frame before recording.";
      return;
    }
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > video.videoWidth ||
      y < 0 ||
      y > video.videoHeight
    ) {
      videoStatus.textContent =
        "Coordinates must lie inside the source video frame.";
      return;
    }
    if (videoPoints.length >= 10000) {
      videoStatus.textContent = "Tracking limit reached: 10,000 observations.";
      return;
    }
    video.pause();
    const point = { t: video.currentTime, x, pixelY: y };
    const existing = videoPoints.findIndex(
      (other) => Math.abs(other.t - point.t) < 1e-6,
    );
    if (existing >= 0) videoPoints[existing] = point;
    else videoPoints.push(point);
    videoPoints.sort((a, b) => a.t - b.t);
    videoStatus.textContent = `Recorded at ${number(point.t, 8)} s, (${number(x)}, ${number(y)}) source px. Seek to another time to add a point.`;
    updateTracking();
  }
  on(videoFile, "change", () => {
    const file = videoFile.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      videoFile.value = "";
      videoStatus.textContent =
        "Use a video at most 200 MiB. The current video and analysis are unchanged.";
      return;
    }
    videoSession++;
    videoReady = false;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = null;
    videoPoints = [];
    activeScale = null;
    calibrationClicks = [];
    calibrationPick = false;
    knownDistance.value = "";
    referencePixels.value = "";
    activeVideoFile = file;
    videoURL = URL.createObjectURL(file);
    video.src = videoURL;
    videoStatus.textContent = "Loading local video…";
  });
  on(video, "loadedmetadata", () => {
    if (!videoURL || video.currentSrc !== videoURL) return;
    if (
      !Number.isFinite(video.duration) ||
      video.duration > 1800 ||
      !video.videoWidth ||
      video.videoWidth * video.videoHeight > 3840 * 2160 ||
      Math.max(video.videoWidth, video.videoHeight) > 3840 ||
      Math.max(
        video.videoWidth / video.videoHeight,
        video.videoHeight / video.videoWidth,
      ) > 8
    ) {
      videoStatus.textContent =
        "Use a finite video up to 30 minutes, 8.3 megapixels, 3840 pixels on either side, and aspect ratio at most 8:1. Previous valid analysis retained.";
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(videoURL);
      videoURL = null;
      return;
    }
    videoReady = true;
    const previewScale = Math.min(
      960 / video.videoWidth,
      720 / video.videoHeight,
    );
    trackingCanvas.width = Math.max(
      1,
      Math.round(video.videoWidth * previewScale),
    );
    trackingCanvas.height = Math.max(
      1,
      Math.round(video.videoHeight * previewScale),
    );
    seekTime.max = video.duration;
    pixelX.max = video.videoWidth;
    pixelY.max = video.videoHeight;
    videoStatus.textContent = `${video.videoWidth} × ${video.videoHeight} source pixels · ${number(video.duration)} s. Pause and click the tracking canvas to record a point.`;
    updateTracking();
  });
  on(video, "error", () => {
    if (videoURL)
      videoStatus.textContent =
        "This browser could not decode that video. Try a compatible MP4 or WebM. Previous valid analysis retained.";
  });
  on(video, "seeked", paintFrame);
  on(video, "loadeddata", paintFrame);
  on(video, "pause", paintFrame);
  on(seekButton, "click", () => {
    const t = Number(seekTime.value);
    if (
      !videoReady ||
      seekTime.value === "" ||
      !Number.isFinite(t) ||
      t < 0 ||
      t > video.duration
    ) {
      videoStatus.textContent = "Seek time must be within the loaded video.";
      return;
    }
    video.pause();
    video.currentTime = t;
  });
  on(addPoint, "click", () => {
    if (pixelX.value === "" || pixelY.value === "") {
      videoStatus.textContent = "Enter both source pixel coordinates.";
      return;
    }
    recordPoint(Number(pixelX.value), Number(pixelY.value));
  });
  on(trackingCanvas, "click", (event) => {
    if (!videoReady || video.seeking || video.readyState < 2) return;
    video.pause();
    const bounds = trackingCanvas.getBoundingClientRect();
    const scale = Math.min(
        bounds.width / trackingCanvas.width,
        bounds.height / trackingCanvas.height,
      ),
      imageWidth = trackingCanvas.width * scale,
      imageHeight = trackingCanvas.height * scale,
      imageLeft = bounds.left + (bounds.width - imageWidth) / 2,
      imageTop = bounds.top + (bounds.height - imageHeight) / 2,
      imageX = event.clientX - imageLeft,
      imageY = event.clientY - imageTop;
    if (
      imageX < 0 ||
      imageX > imageWidth ||
      imageY < 0 ||
      imageY > imageHeight
    ) {
      videoStatus.textContent = "Click inside the displayed video frame.";
      return;
    }
    const x = (imageX / imageWidth) * video.videoWidth,
      y = (imageY / imageHeight) * video.videoHeight;
    pixelX.value = number(x, 8);
    pixelY.value = number(y, 8);
    if (calibrationPick) {
      calibrationClicks.push({ x, y });
      if (calibrationClicks.length === 2) {
        referencePixels.value = number(
          Math.hypot(
            calibrationClicks[1].x - calibrationClicks[0].x,
            calibrationClicks[1].y - calibrationClicks[0].y,
          ),
          10,
        );
        calibrationPick = false;
        videoStatus.textContent =
          "Ruler endpoints selected. Enter its real length in meters and apply calibration.";
      } else videoStatus.textContent = "Click the other end of the ruler.";
      paintFrame();
    } else recordPoint(x, y);
  });
  on(pickRuler, "click", () => {
    if (!videoReady) {
      videoStatus.textContent = "Load a video before choosing ruler endpoints.";
      return;
    }
    video.pause();
    calibrationPick = true;
    calibrationClicks = [];
    videoStatus.textContent =
      "Click the first ruler endpoint, then the second. Points used for calibration are separate from tracked motion.";
    paintFrame();
  });
  on(applyScale, "click", () => {
    const meters = Number(knownDistance.value),
      pixels = Number(referencePixels.value);
    if (
      !videoReady ||
      !Number.isFinite(meters) ||
      meters <= 0 ||
      meters > 1e6 ||
      !Number.isFinite(pixels) ||
      pixels < 1 ||
      pixels > Math.hypot(video.videoWidth, video.videoHeight)
    ) {
      videoStatus.textContent =
        "Supply a positive reference length up to 1,000,000 m and a source-pixel distance between 1 and the frame diagonal.";
      return;
    }
    const endpointDistance =
      calibrationClicks.length === 2
        ? Math.hypot(
            calibrationClicks[1].x - calibrationClicks[0].x,
            calibrationClicks[1].y - calibrationClicks[0].y,
          )
        : NaN;
    activeScale = {
      referenceMeters: meters,
      referencePixels: pixels,
      metersPerPixel: meters / pixels,
      endpoints:
        Math.abs(endpointDistance - pixels) < 1e-5
          ? calibrationClicks.map((point) => ({ ...point }))
          : null,
    };
    calibrationPick = false;
    videoStatus.textContent =
      "Calibration applied. Metric estimates assume a fixed camera and a common plane.";
    updateTracking();
  });
  on(usePixels, "click", () => {
    activeScale = null;
    calibrationPick = false;
    videoStatus.textContent =
      "Physical calibration removed. Values are source pixels.";
    updateTracking();
  });
  on(removePoint, "click", () => {
    videoPoints.pop();
    updateTracking();
  });
  on(clearPoints, "click", () => {
    videoPoints = [];
    updateTracking();
  });
  on(document, "bench:pause", () => video.pause());
  try {
    if (initialDataset)
      setDataset({
        ...initialDataset,
        source: "simulation",
        name: initialDataset.name ?? "Simulation dataset",
        provenance:
          initialDataset.provenance ??
          "Simulation-generated position samples; these are not physical measurements.",
      });
    else loadDemo();
  } catch (error) {
    loadDemo();
    message(
      `Initial dataset unavailable: ${error.message} Synthetic demo loaded.`,
      true,
    );
  }
  const cleanup = () => {
    disposed = true;
    revision++;
    events.abort();
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (videoURL) URL.revokeObjectURL(videoURL);
    container.replaceChildren();
  };
  // Existing callers retain the function cleanup API; navigation can update data
  // without unmounting local files or losing prior observations.
  cleanup.loadDataset = (next) => {
    if (disposed) return false;
    revision++;
    video.pause();
    try {
      setDataset({
        ...next,
        source: "simulation",
        name: next.name ?? "Simulation dataset",
        provenance:
          next.provenance ??
          "Simulation-generated position samples; these are not physical measurements.",
      });
      message(
        "New analysis dataset loaded. Earlier datasets remain in Session dataset.",
      );
      return true;
    } catch (error) {
      message(`${error.message} Previous valid observations retained.`, true);
      return false;
    }
  };
  return cleanup;
}
