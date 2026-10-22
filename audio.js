import {
  FFT_SIZE,
  SYNTH_RATE,
  AUDIO_DEFAULTS,
  SESSION_MAX_BYTES,
  analyze,
  synthesize,
  validateSignal,
  serializeCapture,
  parseCapture,
  captureCSV,
  createAcquisitionMetadata,
} from "./audio-dsp.js";

const hz = (n) => (n === null ? "No signal" : `${n.toFixed(1)} Hz`);
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};

/** Isolated instrument lifecycle. Never requests permission or produces sound on mount. */
export function mountAudio(container) {
  const root = node("section", undefined, "audio-lab");
  root.setAttribute("aria-label", "Audio spectrum instrument");
  root.innerHTML = `
    <div class="experiment-heading"><div><p class="eyebrow">Instrument 04 / Acoustic signals</p><h2 class="instrument-title">See sound take shape.</h2><p class="small-note">A waveform, a spectrum, and a history of frequencies. Start with a reproducible signal or connect your microphone.</p></div></div>
    <div class="audio-layout">
      <div class="audio-plots">
        <section class="panel audio-card"><div class="panel-caption"><h2>Waveform</h2><span data-window class="small-note"></span></div><canvas data-wave class="chart" width="1024" height="210" role="img" aria-label="Waveform: normalized amplitude versus time"></canvas><p class="small-note">Amplitude is normalized to digital full scale. Dashed lines mark ±1.</p></section>
        <section class="panel audio-card"><div class="panel-caption"><h2>Frequency spectrum</h2><span class="small-note">Hann window · linear frequency</span></div><canvas data-spectrum class="chart" width="1024" height="235" role="img" aria-label="Spectrum: peak amplitude in dBFS versus frequency"></canvas><p class="small-note">A Hann window reduces spectral leakage. Spectrum levels show peak sine amplitude; the RMS metric shows average signal energy.</p></section>
        <section class="panel audio-card"><div class="panel-caption"><h2>Spectrogram</h2><span class="small-note">Older ← time → now · brighter = stronger</span></div><canvas data-history class="chart" width="1024" height="200" role="img" aria-label="Scrolling spectrogram: frequency vertically, time horizontally"></canvas><p class="small-note" data-history-note>History is empty. Press Run analysis to watch frequencies change.</p></section>
      </div>
      <aside class="audio-controls panel audio-card" aria-label="Audio controls">
        <p class="eyebrow">Signal desk</p><h2 data-source>Simulated signal</h2><p class="small-note">Simulation works without a microphone or speakers.</p>
        <div class="field"><label for="audio-kind">Signal</label><select id="audio-kind"><option value="sine">Pure sine</option><option value="two-tone">Two tones</option><option value="chirp">Four-second sweep</option></select></div>
        <div class="field"><label for="audio-frequency">Frequency / start (Hz)</label><input id="audio-frequency" type="number" min="40" max="6000" step="1" value="440" required></div>
        <div class="field"><label for="audio-second">Second / end (Hz)</label><input id="audio-second" type="number" min="40" max="6000" step="1" value="660" required></div>
        <div class="field"><label for="audio-gain">Signal amplitude (0–1)</label><input id="audio-gain" type="number" min="0" max="1" step="0.05" value="0.6" required></div>
        <div class="field"><label for="audio-noise">Noise amplitude (0–0.5)</label><input id="audio-noise" type="number" min="0" max="0.5" step="0.01" value="0" required></div>
        <div class="toolbar"><button type="button" class="primary" data-run>Run analysis</button><button type="button" data-reset>Reset</button></div>
        <div class="toolbar"><button type="button" data-mic>Connect microphone</button><button type="button" data-sim hidden>Use simulation</button></div>
        <p class="small-note">Microphone access is optional and starts only when requested. Audio stays on this device. Your browser may apply its own input processing.</p><p class="small-note" data-acquisition></p>
        <button type="button" data-tone>Hear quiet reference tone</button><p class="small-note">Optional sine at the first frequency, at 2% digital amplitude. Device loudness depends on your system volume. Stops when paused or this tab is hidden.</p>
        <div class="notice audio-status" data-status role="status">Ready. Simulation is paused. No sound is playing.</div><p class="error" data-error role="alert" hidden></p>
        <hr><p class="eyebrow">Digital measurements</p><div class="metric-grid" data-metrics></div>
        <p class="small-note">dBFS means decibels relative to digital full scale. These readings are not calibrated sound-pressure levels (dB SPL). Peak frequency is an estimate of the strongest spectral bin, improved by interpolation.</p>
        <hr><p class="eyebrow">Capture & replay</p><div class="toolbar"><button type="button" data-csv>Export samples CSV</button><button type="button" data-save>Save audio session</button></div>
        <div class="field"><label for="audio-file">Replay session JSON</label><input id="audio-file" class="audio-file" type="file" accept=".json,application/json"></div>
        <p class="small-note">Exports save the current sample window, not a recording. A session replays that exact window and restores signal settings. JSON limit: 300 KB.</p>
      </aside>
    </div>`;
  container.append(root);
  const $ = (selector) => root.querySelector(selector);
  const life = new AbortController();
  const listen = (el, type, fn) =>
    el.addEventListener(type, fn, { signal: life.signal });
  const wave = $("[data-wave]"),
    spectrum = $("[data-spectrum]"),
    history = $("[data-history]");
  const wc = wave.getContext("2d"),
    sc = spectrum.getContext("2d"),
    hc = history.getContext("2d");
  let parameters = { ...AUDIO_DEFAULTS },
    samples = synthesize(parameters),
    sampleRate = SYNTH_RATE,
    source = "simulation";
  let metadata = createAcquisitionMetadata("simulation");
  let running = false,
    disposed = false,
    frame = 0,
    stamp = 0,
    sampleOffset = 0,
    historyFrames = 0;
  let inputContext = null,
    stream = null,
    analyser = null,
    inputNode = null,
    micSequence = 0,
    micPending = false;
  let toneContext = null,
    toneOscillator = null,
    toneSequence = 0,
    tonePending = false,
    importSequence = 0;
  let result = analyze(samples, sampleRate);
  const error = (message) => {
    $("[data-error]").hidden = !message;
    $("[data-error]").textContent = message;
  };
  const status = (message) => {
    $("[data-status]").textContent = message;
  };
  const close = (context) => {
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  };
  function stopTone() {
    toneSequence++;
    tonePending = false;
    if (toneOscillator) {
      try {
        toneOscillator.stop();
      } catch {}
      toneOscillator.disconnect();
    }
    toneOscillator = null;
    close(toneContext);
    toneContext = null;
    $("[data-tone]").textContent = "Hear quiet reference tone";
    $("[data-tone]").setAttribute("aria-pressed", "false");
  }
  function stopMicrophone() {
    micSequence++;
    micPending = false;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    if (inputNode) inputNode.disconnect();
    inputNode = null;
    analyser = null;
    close(inputContext);
    inputContext = null;
    $("[data-mic]").textContent = "Connect microphone";
  }
  function acquisitionNote() {
    const prefix = `Origin: ${metadata.originalSource}. Symmetric Hann window, ${samples.length.toLocaleString()}-point FFT; mean removed.`;
    if (metadata.originalSource !== "microphone") {
      $("[data-acquisition]").textContent =
        `${prefix} ${metadata.originalSource === "unknown" ? "Original acquisition settings were not saved in this older session." : "Deterministic simulated samples; no microphone processing applies."}`;
      return;
    }
    const settings = metadata.microphone || {};
    const boolean = (value) =>
      value === true ? "on" : value === false ? "off" : "unknown";
    const numeric = (key, unit = "") =>
      settings[key] == null ? "unknown" : `${settings[key]}${unit}`;
    $("[data-acquisition]").textContent =
      `${prefix} Browser-reported microphone settings: echo cancellation ${boolean(settings.echoCancellation)}; noise suppression ${boolean(settings.noiseSuppression)}; automatic gain ${boolean(settings.autoGainControl)}; track sample rate ${numeric("sampleRate", " Hz")}; channels ${numeric("channelCount")}; sample size ${numeric("sampleSize", " bits")}; latency ${numeric("latency", " s")}. Unknown means the browser did not report a usable value. Reported settings are not an independent hardware measurement.`;
  }
  function controls() {
    acquisitionNote();
    $("[data-source]").textContent =
      source === "microphone"
        ? "Live microphone"
        : source === "replay"
          ? "Captured window replay"
          : "Simulated signal";
    $("[data-run]").textContent = running ? "Pause analysis" : "Run analysis";
    $("[data-run]").disabled = source === "replay";
    $("[data-run]").setAttribute("aria-pressed", String(running));
    $("[data-sim]").hidden = source === "simulation" && !micPending;
    for (const id of [
      "#audio-kind",
      "#audio-frequency",
      "#audio-second",
      "#audio-gain",
      "#audio-noise",
    ])
      $(id).disabled = source !== "simulation";
    $("#audio-second").disabled =
      source !== "simulation" || parameters.kind === "sine";
    $("[data-tone]").disabled = source !== "simulation" || micPending;
  }
  function clearHistory() {
    historyFrames = 0;
    if (hc) {
      hc.fillStyle = "#0c1d29";
      hc.fillRect(0, 0, history.width, history.height);
    }
    $("[data-history-note]").textContent =
      "History is empty. Press Run analysis to watch frequencies change.";
  }
  function pause(message, releaseInput = false) {
    running = false;
    cancelAnimationFrame(frame);
    frame = 0;
    stopTone();
    if (releaseInput && (source === "microphone" || micPending)) {
      stopMicrophone();
      source = "replay";
    }
    controls();
    if (message) status(message);
  }
  function plotBase(ctx, canvas, yTicks, xLabel) {
    const w = canvas.width,
      h = canvas.height,
      left = 60,
      top = 16,
      right = w - 18,
      bottom = h - 35;
    ctx.fillStyle = "#102432";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "13px system-ui";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    for (const [fraction, label] of yTicks) {
      const y = top + (bottom - top) * fraction;
      ctx.strokeStyle = "#29404d";
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = "#b5c5ce";
      ctx.textAlign = "right";
      ctx.fillText(label, left - 10, y);
    }
    ctx.fillStyle = "#b5c5ce";
    ctx.textAlign = "right";
    ctx.fillText(xLabel, right, h - 12);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }
  function paint(addHistory = false) {
    result = analyze(samples, sampleRate);
    $("[data-window]").textContent =
      `${samples.length.toLocaleString()} samples · ${((samples.length / sampleRate) * 1000).toFixed(1)} ms · ${(sampleRate / 1000).toFixed(1)} kHz`;
    const metrics = [
      ["Peak frequency", hz(result.peakFrequency)],
      [
        "RMS level",
        Number.isFinite(result.rmsDBFS)
          ? `${result.rmsDBFS.toFixed(1)} dBFS`
          : "−∞ dBFS",
      ],
      ["Spectral centroid", hz(result.centroid)],
      ["Bin spacing", `${result.resolution.toFixed(2)} Hz`],
      ["Peak amplitude", result.peak.toFixed(3)],
      ["At / above full scale", `${result.clipped} / ${samples.length}`],
    ];
    $("[data-metrics]").replaceChildren(
      ...metrics.map(([label, value]) => {
        const item = node("div", undefined, "audio-metric");
        item.append(node("span", label, "small-note"), node("strong", value));
        return item;
      }),
    );
    const maxHz = Math.min(6000, sampleRate / 2);
    if (wc) {
      const p = plotBase(
        wc,
        wave,
        [
          [0, "+1"],
          [0.5, "0"],
          [1, "−1"],
        ],
        `${((samples.length / sampleRate) * 1000).toFixed(1)} ms →`,
      );
      wc.save();
      wc.beginPath();
      wc.rect(p.left, p.top, p.width, p.height);
      wc.clip();
      wc.strokeStyle = "#80e2d1";
      wc.lineWidth = 1.5;
      wc.beginPath();
      // Min/max envelope preserves narrow spikes when samples outnumber horizontal pixels.
      for (let x = 0; x < p.width; x++) {
        const begin = Math.floor((x / p.width) * samples.length),
          end = Math.max(
            begin + 1,
            Math.floor(((x + 1) / p.width) * samples.length),
          );
        let low = samples[begin],
          high = low;
        for (let i = begin; i < end; i++) {
          low = Math.min(low, samples[i]);
          high = Math.max(high, samples[i]);
        }
        wc.moveTo(p.left + x, p.top + ((1 - high) * p.height) / 2);
        wc.lineTo(p.left + x, p.top + ((1 - low) * p.height) / 2 + 0.8);
      }
      wc.stroke();
      wc.restore();
    }
    if (sc) {
      const p = plotBase(
        sc,
        spectrum,
        [
          [0, "0 dBFS"],
          [0.5, "−50"],
          [1, "−100"],
        ],
        "Frequency (Hz) →",
      );
      sc.save();
      sc.beginPath();
      sc.rect(p.left, p.top, p.width, p.height);
      sc.clip();
      sc.strokeStyle = "#f3bb72";
      sc.lineWidth = 1.6;
      sc.beginPath();
      for (
        let i = 0;
        i < result.decibels.length && i * result.resolution <= maxHz;
        i++
      ) {
        const x = p.left + ((i * result.resolution) / maxHz) * p.width,
          y =
            p.top +
            (Math.max(0, Math.min(100, -result.decibels[i])) / 100) * p.height;
        if (i) sc.lineTo(x, y);
        else sc.moveTo(x, y);
      }
      sc.stroke();
      sc.restore();
      sc.fillStyle = "#b5c5ce";
      sc.textAlign = "center";
      for (let i = 0; i <= 4; i++)
        sc.fillText(
          String(Math.round((maxHz * i) / 4)),
          p.left + (p.width * i) / 4,
          p.bottom + 14,
        );
    }
    if (hc && addHistory) {
      const shift = 3,
        left = 60,
        right = history.width - 18,
        top = 12,
        bottom = history.height - 25;
      hc.drawImage(
        history,
        left + shift,
        top,
        right - left - shift,
        bottom - top,
        left,
        top,
        right - left - shift,
        bottom - top,
      );
      for (let y = top; y < bottom; y++) {
        const bin = Math.min(
          result.decibels.length - 1,
          Math.round(
            (((bottom - y) / (bottom - top)) * maxHz) / result.resolution,
          ),
        );
        const intensity = Math.max(
          0,
          Math.min(1, (result.decibels[bin] + 90) / 90),
        );
        hc.fillStyle = `hsl(${210 - intensity * 175} ${35 + intensity * 55}% ${8 + intensity * 66}%)`;
        hc.fillRect(right - shift, y, shift, 1);
      }
      hc.fillStyle = "#0c1d29";
      hc.fillRect(0, 0, left, history.height);
      hc.fillRect(0, bottom, history.width, history.height - bottom);
      hc.font = "13px system-ui";
      hc.fillStyle = "#b5c5ce";
      hc.textAlign = "right";
      hc.fillText(`${maxHz} Hz`, left - 7, top + 8);
      hc.fillText("0 Hz", left - 7, bottom - 3);
      hc.fillText("Now", right, history.height - 6);
      historyFrames++;
      $("[data-history-note]").textContent =
        `${historyFrames} analysis frames. Columns arrive about 12 times per second while running; gaps when paused are omitted. Color range: −90 to 0 dBFS.`;
    }
  }
  function tick(now) {
    if (!running || disposed) return;
    if (!stamp || now - stamp >= 80) {
      if (source === "microphone" && analyser)
        analyser.getFloatTimeDomainData(samples);
      else if (source === "simulation") {
        const elapsed = stamp ? Math.min((now - stamp) / 1000, 0.25) : 0;
        sampleOffset += Math.round(elapsed * sampleRate);
        samples = synthesize(parameters, FFT_SIZE, sampleRate, sampleOffset);
      }
      stamp = now;
      paint(true);
    }
    frame = requestAnimationFrame(tick);
  }
  function run() {
    if (running || source === "replay" || disposed) return;
    running = true;
    stamp = 0;
    controls();
    status(
      source === "microphone"
        ? "Analyzing live microphone input locally. No sound is sent to your speakers."
        : "Analyzing deterministic simulated samples. No sound is playing unless you enable the reference tone.",
    );
    frame = requestAnimationFrame(tick);
  }
  function useSimulation() {
    importSequence++;
    pause();
    stopMicrophone();
    source = "simulation";
    sampleRate = SYNTH_RATE;
    sampleOffset = 0;
    metadata = createAcquisitionMetadata("simulation");
    samples = synthesize(parameters);
    clearHistory();
    paint();
    controls();
    status("Simulation ready. No microphone or speakers are active.");
    error("");
  }
  async function connectMicrophone() {
    if (micPending) {
      useSimulation();
      status(
        "Microphone request canceled. Any stream arriving from that request will be closed.",
      );
      return;
    }
    if (source === "microphone") {
      useSimulation();
      return;
    }
    importSequence++;
    error("");
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !Audio) {
      error(
        "Microphone capture is unavailable here. Use simulation, or open this app on HTTPS or localhost in a supported browser.",
      );
      return;
    }
    pause();
    stopMicrophone();
    const sequence = micSequence;
    micPending = true;
    $("[data-mic]").textContent = "Cancel microphone request";
    controls();
    status(
      "Waiting for your browser’s microphone permission. You can cancel this request here.",
    );
    let pendingStream = null,
      pendingContext = null;
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (disposed || sequence !== micSequence) {
        pendingStream.getTracks().forEach((track) => track.stop());
        return;
      }
      pendingContext = new Audio();
      // Publish resources before awaiting resume so cancellation can stop them immediately.
      stream = pendingStream;
      inputContext = pendingContext;
      await pendingContext.resume();
      if (disposed || sequence !== micSequence) {
        close(pendingContext);
        return;
      }
      const nextAnalyser = pendingContext.createAnalyser();
      nextAnalyser.fftSize = FFT_SIZE;
      const nextInput = pendingContext.createMediaStreamSource(pendingStream);
      nextInput.connect(nextAnalyser);
      stream = pendingStream;
      inputContext = pendingContext;
      inputNode = nextInput;
      analyser = nextAnalyser;
      let reportedSettings = {};
      try {
        reportedSettings = stream.getTracks()[0]?.getSettings?.() || {};
      } catch {
        /* Absent settings remain explicitly unknown. */
      }
      metadata = createAcquisitionMetadata(
        "microphone",
        FFT_SIZE,
        reportedSettings,
      );
      stopTone();
      source = "microphone";
      sampleRate = pendingContext.sampleRate;
      samples = new Float32Array(FFT_SIZE);
      micPending = false;
      $("[data-mic]").textContent = "Disconnect microphone";
      clearHistory();
      controls();
      run();
      for (const track of stream.getTracks())
        listen(track, "ended", () => {
          if (source === "microphone") {
            pause(
              "Microphone disconnected. The last sample window is retained.",
              true,
            );
          }
        });
    } catch (cause) {
      if (pendingStream)
        pendingStream.getTracks().forEach((track) => track.stop());
      close(pendingContext);
      if (disposed || sequence !== micSequence) return;
      stopMicrophone();
      controls();
      error(
        cause?.name === "NotAllowedError"
          ? "Microphone permission was denied. Simulation remains available. Change permission in your browser only if you want to try again."
          : `Microphone could not start (${cause?.name || "capture error"}). Simulation remains available.`,
      );
      status("No microphone is active. Your last sample window is retained.");
    }
  }
  async function referenceTone() {
    if (toneContext || tonePending) {
      stopTone();
      status("Reference tone stopped.");
      return;
    }
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) {
      error(
        "Audio output is unavailable in this browser. Analysis still works.",
      );
      return;
    }
    stopTone();
    const sequence = toneSequence;
    tonePending = true;
    $("[data-tone]").textContent = "Stop reference tone";
    $("[data-tone]").setAttribute("aria-pressed", "true");
    let context;
    try {
      context = new Audio();
      toneContext = context;
      await context.resume();
      if (disposed || sequence !== toneSequence) {
        close(context);
        return;
      }
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = parameters.frequency;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.02, context.currentTime + 0.05);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      toneOscillator = oscillator;
      tonePending = false;
      status(
        `Reference sine playing at ${parameters.frequency} Hz and 2% digital amplitude. Press Stop reference tone to stop.`,
      );
    } catch {
      close(context);
      if (sequence === toneSequence && !disposed) {
        stopTone();
        error("Audio output could not start. Analysis still works.");
      }
    }
  }
  function readParameters() {
    const next = {
      kind: $("#audio-kind").value,
      frequency: Number($("#audio-frequency").value),
      secondFrequency: Number($("#audio-second").value),
      gain: Number($("#audio-gain").value),
      noise: Number($("#audio-noise").value),
    };
    for (const input of root.querySelectorAll('input[type="number"]'))
      if (!input.checkValidity()) {
        input.reportValidity();
        throw new Error("Enter valid signal values before continuing.");
      }
    return validateSignal(next);
  }
  function fillParameters() {
    $("#audio-kind").value = parameters.kind;
    $("#audio-frequency").value = parameters.frequency;
    $("#audio-second").value = parameters.secondFrequency;
    $("#audio-gain").value = parameters.gain;
    $("#audio-noise").value = parameters.noise;
  }
  function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = node("a");
    anchor.href = url;
    anchor.download = filename;
    root.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const id of [
    "#audio-kind",
    "#audio-frequency",
    "#audio-second",
    "#audio-gain",
    "#audio-noise",
  ])
    listen($(id), "change", () => {
      try {
        const next = readParameters();
        importSequence++;
        parameters = next;
        sampleOffset = 0;
        stopTone();
        error("");
        samples = synthesize(parameters);
        clearHistory();
        paint();
        controls();
      } catch (cause) {
        error(cause.message);
      }
    });
  listen($("[data-run]"), "click", () => {
    if (running)
      pause(
        "Analysis paused. Current samples remain available for export.",
        true,
      );
    else {
      try {
        if (source === "simulation") parameters = readParameters();
        error("");
        run();
      } catch (cause) {
        error(cause.message);
      }
    }
  });
  listen($("[data-reset]"), "click", () => {
    parameters = { ...AUDIO_DEFAULTS };
    fillParameters();
    useSimulation();
  });
  listen($("[data-mic]"), "click", connectMicrophone);
  listen($("[data-sim]"), "click", useSimulation);
  listen($("[data-tone]"), "click", referenceTone);
  listen($("[data-csv]"), "click", () =>
    download(
      captureCSV(samples, sampleRate, source, metadata),
      "text/csv",
      "physicsbench-audio.csv",
    ),
  );
  listen($("[data-save]"), "click", () =>
    download(
      serializeCapture({ samples, sampleRate, parameters, source, metadata }),
      "application/json",
      "physicsbench-audio.json",
    ),
  );
  listen($("#audio-file"), "change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sequence = ++importSequence;
    try {
      if (file.size > SESSION_MAX_BYTES)
        throw new Error("Audio session exceeds the 300 KB limit.");
      const next = parseCapture(await file.text());
      if (disposed || sequence !== importSequence) return;
      pause();
      stopMicrophone();
      samples = next.samples;
      sampleRate = next.sampleRate;
      parameters = next.parameters;
      source = "replay";
      metadata =
        next.metadata ||
        createAcquisitionMetadata(
          next.source === "replay" ? "unknown" : next.source,
          samples.length,
        );
      fillParameters();
      clearHistory();
      paint(true);
      controls();
      error("");
      status(
        `Replaying a captured ${metadata.originalSource} window. Audio is silent. Use simulation to generate a new signal.`,
      );
    } catch (cause) {
      if (!disposed && sequence === importSequence)
        error(`${cause.message} Last valid capture retained.`);
    }
  });
  listen(document, "bench:pause", () =>
    pause(
      "Paused while switching instruments. Audio and microphone are stopped; the current sample window is retained.",
      true,
    ),
  );
  listen(document, "visibilitychange", () => {
    if (document.hidden)
      pause(
        "Paused because this tab was hidden. Audio and microphone are stopped.",
        true,
      );
  });
  listen(globalThis, "pagehide", () =>
    pause("Paused. Audio and microphone are stopped.", true),
  );
  clearHistory();
  paint();
  controls();
  if (!wc || !sc || !hc)
    error(
      "Canvas rendering is unavailable. Numeric signal measurements and exports still work.",
    );
  return () => {
    disposed = true;
    importSequence++;
    pause();
    stopMicrophone();
    life.abort();
    root.remove();
  };
}
