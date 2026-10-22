import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHandler, loadAssets } from "./serve.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = process.env.BROWSER_ARTIFACT_DIR || ".browser-artifacts";
await mkdir(out, { recursive: true });
let server,
  base = process.env.BENCH_URL;
if (!base) {
  server = createServer(createHandler(await loadAssets()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
}
const browser = await chromium.launch({ headless: true });
console.log(`Browser: Chromium ${browser.version()}`);
try {
  const context = await browser.newContext({
      viewport: { width: 1536, height: 1050 },
      deviceScaleFactor: 2,
    }),
    page = await context.newPage(),
    errors = [],
    httpFailures = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) httpFailures.push([r.status(), r.url()]);
  });
  await page.goto(base);
  await page.locator("[data-verdict][data-verdict=pass]").waitFor();
  await page.waitForFunction(
    () => !document.querySelector("#record-save").disabled,
  );
  assert.match(
    await page.locator("[data-source-tag]").innerText(),
    /SYNTHETIC/,
  );
  const firstScore = await page
    .locator(".acoustic-lab [data-error]")
    .innerText();
  await page.locator("[data-test-view]").selectOption("0.02");
  await page.locator("[data-test-start]").fill("200");
  assert.equal(
    await page.locator(".acoustic-lab [data-error]").innerText(),
    firstScore,
  );
  await page.locator("[data-test-view]").selectOption("full");
  await page.screenshot({ path: `${out}/acoustic-investigation.png` });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#record-export").click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path()),
    original = JSON.parse(bytes.toString());
  assert.equal(original.kind, "acoustic");
  assert.equal(original.data.captureFingerprint.length, 64);
  await page.locator("#record-save").click();
  await page.waitForFunction(
    () => document.querySelector("#run-count").textContent === "1",
  );
  await page.locator("#record-save").click();
  assert.equal(await page.locator("#run-count").innerText(), "1");
  await page.locator("[data-specimen]").selectOption("nonlinear");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-verdict]")?.textContent ===
      "Linear model rejected",
  );
  await page.screenshot({ path: `${out}/nonlinear-rejection.png` });
  await page.locator("[data-specimen]").selectOption("silent");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-verdict]")?.textContent ===
      "Evidence is inconclusive",
  );
  const bad = { ...original, data: { ...original.data, acquisitionId: "" } };
  await page
    .locator("#record-file")
    .setInputFiles({
      name: "missing-id.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bad)),
    });
  await page.waitForFunction(() =>
    document
      .querySelector("#shell-status")
      .textContent.includes("Unsupported acoustic"),
  );
  assert.match(
    await page.locator("[data-verdict]").innerText(),
    /inconclusive/,
  );
  await page
    .locator("#record-file")
    .setInputFiles({
      name: "saved.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await page.waitForFunction(() =>
    document.querySelector("#shell-status").textContent.includes("Reopened"),
  );
  assert.equal(
    await page.locator(".acoustic-lab [data-error]").innerText(),
    firstScore,
  );
  // Distinct virtual acquisitions, fixed underlying path, explicit A/B conditions.
  await page.locator("[data-repeat]").click();
  await page.waitForFunction(
    () => !document.querySelector(".acoustic-lab [data-repeat]").disabled,
  );
  await page.locator("[data-condition]").fill("Reflective reference");
  await page.locator("#record-save").click();
  await page.waitForFunction(
    () => document.querySelector("#run-count").textContent === "2",
  );
  for (let i = 0; i < 2; i++) {
    await page.locator("[data-specimen]").selectOption("damped");
    if (i) await page.locator("[data-repeat]").click();
    await page.waitForFunction(
      () => !document.querySelector(".acoustic-lab [data-repeat]").disabled,
    );
    await page.locator("#record-save").click();
    await page.waitForFunction(
      (n) => document.querySelector("#run-count").textContent === String(n),
      i + 3,
    );
  }
  await page.locator("#runs-open").click();
  await page.locator("#runs-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator(".run-row input").count(), 4);
  await page
    .locator(".run-row input")
    .evaluateAll((inputs) => inputs.forEach((input) => (input.checked = true)));
  await page.locator("#runs-compare").click();
  assert.match(
    await page.locator("#run-comparison").innerText(),
    /acquisitions/,
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator("[data-verdict][data-verdict=pass]").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#run-count").textContent === "4",
  );
  await page.locator("[data-mode=motion]").click();
  await page.waitForFunction(() =>
    document
      .querySelector(".motion-lab [data-status]")
      ?.textContent.includes("complete"),
  );
  assert.match(
    await page.locator(".motion-result-strip").innerText(),
    /25 \/ 25/,
  );
  assert.match(await page.locator(".motion-result-strip").innerText(), /-9\.8/);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${out}/motion-investigation.png` });
  const motionExport = page.waitForEvent("download");
  await page.locator("#record-export").click();
  const motionData = JSON.parse(
    await readFile(await (await motionExport).path(), "utf8"),
  );
  assert.equal(motionData.kind, "motion");
  assert.equal(motionData.data.observations.length, 25);
  await page.locator(".motion-lab [data-model]").selectOption("linear");
  assert.match(await page.locator(".motion-result-strip").innerText(), /1\.28/);
  await page.locator(".motion-lab [data-model]").selectOption("ballistic");
  await page.locator(".motion-lab [data-source]").selectOption("occlusion");
  await page.waitForFunction(() =>
    document
      .querySelector(".motion-lab [data-gap]")
      ?.textContent.includes("Gap"),
  );
  const gapCount = await page.locator(".motion-result-strip").innerText();
  assert.match(gapCount, /unresolved gap/);
  await page.screenshot({ path: `${out}/tracking-failure.png` });
  await page
    .locator("#record-file")
    .setInputFiles({
      name: "flight.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(motionData)),
    });
  await page.waitForFunction(() =>
    document
      .querySelector(".motion-lab [data-status]")
      ?.textContent.includes("restored"),
  );
  assert.match(
    await page.locator(".motion-result-strip").innerText(),
    /25 \/ 25/,
  );
  await page.locator(".motion-lab [data-time]").fill("0.6");
  await page.locator(".motion-lab [data-position]").focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(
    await page.locator(".motion-lab [data-time]").inputValue(),
    "0.6",
  );
  const positionBounds = await page
    .locator(".motion-lab [data-position]")
    .boundingBox();
  await page.locator(".motion-lab [data-position]").click({
    position: { x: 64 + (positionBounds.width - 84) / 2, y: 75 },
  });
  await page.waitForFunction(() => {
    const time = Number(document.querySelector(".motion-lab [data-time]").value);
    return time > 0.8 && time < 1;
  });
  const review = page
    .locator(".motion-lab details")
    .filter({
      has: page.getByText("Review points and correct tracking", {
        exact: true,
      }),
    });
  await review.locator("summary").click();
  await page.locator(".motion-lab [data-exclude]").click();
  assert.match(
    await page.locator(".motion-result-strip").innerText(),
    /24 \/ 25/,
  );
  await page.locator(".motion-lab [data-undo]").click();
  assert.match(
    await page.locator(".motion-result-strip").innerText(),
    /25 \/ 25/,
  );
  // Rejecting a replacement must not detach the still-valid track from its source.
  await page.locator('[data-mode="measure"]').click();
  const measurement = page.locator(".measurement-layout"),
    videoPanel = measurement
      .locator("details")
      .filter({ hasText: "Track an object in a local video" });
  await videoPanel.locator("summary").click();
  await measurement
    .getByLabel("Local video")
    .setInputFiles("test-fixtures/tracking-portrait.webm");
  await page.waitForFunction(() => {
    const video = document.querySelector(".measurement-layout video");
    return video?.videoWidth > 0 && video.readyState >= 2 && !video.seeking;
  });
  const trackingCanvas = measurement.locator("canvas.measurement-canvas"),
    canvasGeometry = await trackingCanvas.evaluate((canvas) => {
      const bounds = canvas.getBoundingClientRect(),
        ratio = canvas.width / canvas.height,
        renderedWidth = Math.min(bounds.width, bounds.height * ratio),
        renderedHeight = Math.min(bounds.height, bounds.width / ratio);
      return {
        renderedWidth,
        renderedHeight,
        offsetX: (bounds.width - renderedWidth) / 2,
        offsetY: (bounds.height - renderedHeight) / 2,
        sourceWidth: document.querySelector(".measurement-layout video").videoWidth,
        sourceHeight: document.querySelector(".measurement-layout video").videoHeight,
      };
    }),
    videoStatus = videoPanel.locator('p[role="status"]');
  await trackingCanvas.click({
    position: {
      x: canvasGeometry.offsetX + canvasGeometry.renderedWidth * 0.25,
      y: canvasGeometry.offsetY + canvasGeometry.renderedHeight * 0.5,
    },
  });
  const recorded = (await videoStatus.innerText()).match(
    /\(([^,]+), ([^)]+)\) source px/,
  );
  assert.ok(recorded, await videoStatus.innerText());
  assert.ok(Math.abs(Number(recorded[1]) - canvasGeometry.sourceWidth * 0.25) < 2);
  assert.ok(Math.abs(Number(recorded[2]) - canvasGeometry.sourceHeight * 0.5) < 2);
  await trackingCanvas.click({
    position: { x: canvasGeometry.offsetX / 2, y: canvasGeometry.renderedHeight / 2 },
  });
  assert.match(await videoStatus.innerText(), /Click inside the displayed video frame/);
  assert.match(await measurement.innerText(), /1 tracked points/);
  await videoPanel
    .getByRole("button", { name: "Clear tracking", exact: true })
    .click();
  const seekTime = measurement.getByLabel("Seek time (s)"),
    seek = measurement.getByRole("button", { name: "Seek", exact: true }),
    x = measurement.getByLabel("X (source px)"),
    y = measurement.getByLabel("Y (source px, down)"),
    record = measurement.getByRole("button", {
      name: "Record coordinate",
      exact: true,
    });
  for (const [time, px, py] of [
    [0.2, 100, 200],
    [0.6, 110, 190],
    [1.0, 120, 160],
    [1.4, 130, 110],
  ]) {
    await seekTime.fill(String(time));
    await seek.click();
    await page.waitForFunction(
      (target) => {
        const video = document.querySelector(".measurement-layout video");
        return (
          video?.readyState >= 2 &&
          !video.seeking &&
          Math.abs(video.currentTime - target) < 0.05
        );
      },
      time,
    );
    await x.fill(String(px));
    await y.fill(String(py));
    await record.click();
  }
  assert.match(await measurement.innerText(), /4 tracked points/);
  async function exportMeasure() {
    const downloadPromise = page.waitForEvent("download");
    await measurement
      .getByRole("button", { name: "Export analysis JSON", exact: true })
      .click();
    const download = await downloadPromise;
    return JSON.parse(await readFile(await download.path(), "utf8"));
  }
  const originalTrack = await exportMeasure();
  assert.equal(originalTrack.dataset.name, "tracking-portrait.webm");
  assert.ok(originalTrack.dataset.video.width > 0);
  await measurement
    .getByLabel("Local video")
    .evaluate((input) => {
      const rejected = new File([], "oversized-replacement.mp4", {
        type: "video/mp4",
      });
      Object.defineProperty(rejected, "size", {
        value: 200 * 1024 * 1024 + 1,
      });
      const transfer = new DataTransfer();
      transfer.items.add(rejected);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await page.waitForFunction(() =>
    document
      .querySelector(".measurement-layout")
      ?.textContent.includes("Use a video at most 200 MiB"),
  );
  await measurement.getByRole("button", { name: "Use pixels", exact: true }).click();
  const afterRejectedReplacement = await exportMeasure();
  assert.deepEqual(afterRejectedReplacement.dataset, originalTrack.dataset);
  await page.locator('[data-mode="motion"]').click();
  console.log("PASS: an oversized replacement preserves the existing video track");
  // Local video decodes and uses the frame actually presented, not requested seek time.
  await page
    .locator(".motion-lab [data-video-file]")
    .setInputFiles("test-fixtures/tracking.mp4");
  await page.waitForFunction(() =>
    document
      .querySelector(".motion-lab [data-origin]")
      ?.textContent.includes("LOCAL VIDEO ATTACHED"),
  );
  await page.locator(".motion-lab [data-time]").fill("0.75");
  await page.waitForFunction(() => {
    const t = parseFloat(
      document.querySelector(".motion-lab [data-time-label]")?.textContent,
    );
    return t >= 0.7 && t <= 0.751;
  });
  assert.match(
    await page.locator(".motion-lab [data-frame-label]").innerText(),
    /presented media time/,
  );
  assert.match(
    await page.locator(".motion-lab [data-origin]").innerText(),
    /LOCAL VIDEO/,
  );
  // Retained mechanics and file formats still work.
  await page.locator("[data-mode=mechanics]").click();
  await page.getByRole("button", { name: "Moon", exact: true }).click();
  assert.equal(await page.locator("#parameter-gravity").inputValue(), "1.62");
  await page.locator("#sweep-toggle").click();
  await page.locator("#sweep-run").click();
  assert.match(
    await page.locator("#sweep-summary").innerText(),
    /41 model predictions/,
  );
  await page.locator("#send-analysis").click();
  assert.match(
    await page.locator(".measurement-layout").innerText(),
    /Analytical simulation/,
  );
  for (const width of [1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of [
      "acoustic",
      "motion",
      "mechanics",
      "audio",
      "measure",
    ]) {
      await page.locator(`[data-mode=${mode}]`).click();
      await page.waitForTimeout(50);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${mode}: page overflow at ${width}`,
      );
      if (mode === "acoustic" || mode === "motion") {
        const selector =
          mode === "acoustic"
            ? ".acoustic-lab [data-ir]"
            : ".motion-lab [data-position]";
        assert.ok(
          await page.locator(selector).evaluate((canvas) => {
            const display = canvas.getBoundingClientRect();
            return (
              Math.abs(canvas.width / 2 - display.width) < 2 &&
              display.height >= 190
            );
          }),
          `${mode}: readable plots at ${width}`,
        );
      }
    }
    if (width === 390) {
      await page.locator("[data-mode=acoustic]").click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${out}/acoustic-mobile.png` });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("[data-mode=mechanics]").click();
  assert.equal(await page.locator("#play").innerText(), "Step");
  await page.locator("#guide-open").click();
  assert.equal(await page.locator("#guide-dialog").isVisible(), true);
  await page.keyboard.press("Escape");
  // Actual AudioWorklet execution in an OfflineAudioContext, without physical capture/output.
  const offline = await page.evaluate(async () => {
    const { generateProtocol, analyzeProtocol } = await import(
      "./acoustics.js"
    );
    const protocol = generateProtocol(16000),
      ctx = new OfflineAudioContext(
        1,
        protocol.excitation.length + 1024,
        16000,
      );
    await ctx.audioWorklet.addModule("./capture-worklet.js");
    const processor = new AudioWorkletNode(ctx, "investigation-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const buffer = ctx.createBuffer(1, protocol.excitation.length, 16000),
      channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++)
      channel[i] =
        0.5 * protocol.excitation[i] +
        (i >= 640 ? 0.2 * protocol.excitation[i - 640] : 0);
    const input = ctx.createBufferSource();
    input.buffer = buffer;
    input.connect(processor);
    processor.connect(ctx.destination);
    const recorded = new Promise((resolve, reject) => {
      processor.port.onmessage = (e) => {
        if (e.data.type === "complete") resolve(e.data);
      };
      processor.onprocessorerror = () => reject(new Error("processor failed"));
    });
    processor.port.postMessage({
      type: "start",
      excitation: protocol.excitation,
    });
    input.start();
    await ctx.startRendering();
    const result = await recorded;
    const analyzed = analyzeProtocol({
      ...protocol,
      response: result.response,
      captureIntegrity: result.integrity,
    });
    return {
      health: result.integrity,
      error: analyzed.validation.nrmse,
      accepted: analyzed.quality.usable,
      baseline: analyzed.baseline.nrmse,
    };
  });
  assert.equal(offline.health.missingInputFrames, 0);
  assert.equal(offline.health.discontinuities, 0);
  assert.ok(offline.error < 0.05);
  assert.ok(offline.baseline > offline.error * 3);
  assert.equal(offline.accepted, true);
  // Permission pending/cancel and late media release use a controlled mock, no real microphone.
  const permission = await context.newPage();
  await permission.addInitScript(() => {
    window.pending = [];
    window.trackStops = 0;
    window.toneStarts = 0;
    window.toneStops = 0;
    class MockAudioContext {
      constructor() {
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.state = "running";
        this.destination = {};
      }
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 0 },
          connect() { return this; },
          start() { window.toneStarts++; },
          stop() { window.toneStops++; },
          disconnect() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
          connect() { return this; },
        };
      }
      createAnalyser() {
        return { fftSize: 0, getFloatTimeDomainData(buffer) { buffer.fill(0); } };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () =>
          new Promise((resolve, reject) =>
            window.pending.push({ resolve, reject }),
          ),
      },
    });
    window.grantLate = () =>
      window.pending.shift().resolve({
        getTracks: () => [
          {
            stop() {
              window.trackStops++;
            },
            getSettings() { return {}; },
            addEventListener() {},
          },
        ],
      });
    window.denyMicrophone = () =>
      window.pending.shift().reject(
        new DOMException("Denied by test fixture", "NotAllowedError"),
      );
  });
  await permission.goto(base);
  await permission.locator("[data-verdict][data-verdict=pass]").waitFor();
  await permission.locator("[data-capture-open]").click();
  await permission.locator("[data-begin]").click();
  await permission.locator("[data-cancel]").click();
  await permission.evaluate(() => window.grantLate());
  await permission.waitForFunction(() => window.trackStops === 1);
  assert.match(
    await permission.locator(".acoustic-lab [data-message]").innerText(),
    /canceled/,
  );
  // Microphone permission keeps simulated output unavailable and recovers cleanly.
  await permission.locator("[data-mode=audio]").click();
  await permission.locator("[data-tone]").press("Enter");
  await permission.waitForFunction(() => window.toneStarts === 1);
  await permission.locator("[data-mic]").press("Enter");
  await permission.waitForFunction(
    () => window.toneStops === 1 && window.pending.length === 1,
  );
  assert.equal(await permission.locator("[data-tone]").isDisabled(), true);
  await permission.evaluate(() => window.denyMicrophone());
  await permission.waitForFunction(
    () =>
      document.querySelector(".audio-lab [data-error]").textContent.includes("permission was denied"),
  );
  assert.equal(
    await permission.locator(".audio-lab [data-source]").innerText(),
    "Simulated signal",
  );
  assert.equal(await permission.locator("[data-tone]").isDisabled(), false);
  assert.equal(await permission.evaluate(() => window.toneStarts), 1);
  assert.equal(await permission.evaluate(() => window.toneStops), 1);
  await permission.locator("[data-mic]").click();
  await permission.waitForFunction(() => window.pending.length === 1);
  assert.equal(await permission.locator("[data-tone]").isDisabled(), true);
  await permission.evaluate(() => window.grantLate());
  await permission.waitForFunction(
    () =>
      document.querySelector(".audio-lab [data-source]").textContent ===
      "Live microphone",
  );
  assert.equal(await permission.evaluate(() => window.toneStarts), 1);
  assert.equal(await permission.evaluate(() => window.toneStops), 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(httpFailures, []);
  console.log(
    "PASS: canonical acoustic identification, nonlinear/silent rejection, fixed-score detail view, export/recompute, persistent run reload, independent repeated A/B records, generated pixels→NCC→2D inference, occlusion stop, correction/exclusion undo, source MP4/presented timestamps, retained mechanics, 320–1536 layouts, reduced motion, real offline AudioWorklet capture and canceled late permission stream.",
  );
  console.log("Offline AudioWorklet evidence:", JSON.stringify(offline));
  await writeFile(
    `${out}/browser-evidence.json`,
    JSON.stringify(
      { browser: browser.version(), offline, errors, httpFailures },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
