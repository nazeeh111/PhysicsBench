const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const out = process.env.BROWSER_ARTIFACT_DIR || ".browser-artifacts";
await mkdir(out, { recursive: true });
const base = process.env.BENCH_URL || "http://127.0.0.1:4173/";
for (let attempt = 0; attempt < 30; attempt++) {
  try { if ((await fetch(base)).ok) break; } catch {}
  if (attempt === 29) throw new Error(`Preview unavailable at ${base}. Run npm run build and npm start first.`);
  await new Promise(resolve => setTimeout(resolve, 100));
}
const browser = await chromium.launch({ headless: true });
console.log(`Browser: Chromium ${browser.version()}`);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push([r.status(), r.url()]);
  });
  await page.goto(base);
  await page.locator("#parameter-speed").waitFor();
  console.log("loaded", await page.title(), "errors", errors);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({
    path: out + "/mechanics-desktop.png",
    fullPage: false,
  });
  assert.match(
    await page.locator("#readings").innerText(),
    /Horizontal position/,
  );
  await page.getByRole("button", { name: "Moon", exact: true }).click();
  assert.equal(await page.locator("#parameter-gravity").inputValue(), "1.62");
  await page.locator("#parameter-speed").fill("-1");
  await page.locator("button.apply").click();
  assert.match(await page.locator("#error").innerText(), /Launch speed/);
  await page.getByRole("button", { name: "Earth", exact: true }).click();
  await page.locator("#time").fill("1");
  assert.match(await page.locator("#time-output").textContent(), /1 s/);
  const save = page.waitForEvent("download");
  await page.locator("#session-export").click();
  const session = await save;
  const bytes = await readFile(await session.path());
  await page.locator("[data-lab=oscillator]").click();
  await page
    .locator("#session-file")
    .setInputFiles({
      name: "session.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await page.waitForFunction(
    () =>
      document.querySelector("#lab-name").textContent.trim() === "Projectile",
  );
  await page.locator("#plot-quantity").selectOption("vy");
  assert.match(await page.locator("#plot-title").innerText(), /velocity/i);
  await page.locator("#sweep-toggle").click();
  await page.locator("#sweep-run").click();
  assert.match(
    await page.locator("#sweep-summary").innerText(),
    /41 model predictions/,
  );
  await page.locator("#sweep-min").fill("999");
  await page.locator("#sweep-run").click();
  assert.equal(await page.locator("#sweep-error").isVisible(), true);
  await page.locator("#sweep-min").fill("0");
  await page.locator("#sweep-max").fill("90");
  await page.locator("#sweep-run").click();
  await page.locator("#send-analysis").click();
  await page
    .getByRole("heading", { name: "Measure. Fit. Question.", exact: true })
    .waitFor();
  assert.match(
    await page.locator("#extra-workspace").innerText(),
    /Analytical simulation; not measured data/,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({
    path: out + "/analysis-desktop.png",
    fullPage: false,
  });
  await page.locator("[data-mode=audio]").click();
  await page
    .getByRole("heading", { name: "See sound take shape.", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await page.waitForTimeout(450);
  await page
    .getByRole("button", { name: "Pause analysis", exact: true })
    .click();
  assert.match(
    await page.locator("[data-history-note]").innerText(),
    /analysis frames/,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({ path: out + "/sound-desktop.png", fullPage: false });
  await page.locator("[data-mode=measure]").click();
  await page
    .getByRole("heading", { name: "Measure. Fit. Question.", exact: true })
    .waitFor();
  await page
    .getByLabel("Import two-column measurement CSV")
    .setInputFiles({
      name: "measured.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("time_s,value\n0,0\n1,1\n2,4\n3,9\n4,16\n"),
    });
  await page.waitForFunction(() =>
    document
      .querySelector("#extra-workspace")
      .textContent.includes("Imported 5 observations"),
  );
  assert.match(
    await page.locator("#extra-workspace").innerText(),
    /Unspecified units|units/,
  );
  await page
    .getByLabel("Import two-column measurement CSV")
    .setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("0,1\n1,=alert(1)"),
    });
  await page.waitForFunction(() =>
    document
      .querySelector("#extra-workspace")
      .textContent.includes("Previous valid observations retained"),
  );
  const kept = await page
    .locator(".measurement-layout .notice")
    .first()
    .textContent();
  await page.locator("[data-mode=audio]").click();
  await page.locator("[data-mode=measure]").click();
  assert.equal(
    await page.locator(".measurement-layout .notice").first().textContent(),
    kept,
  );
  await page.locator("[data-lab=projectile]").click();
  await page.locator("#send-analysis").click();
  await page
    .getByLabel("Session dataset")
    .selectOption({ label: "measured.csv · 5 points · unknown" });
  assert.match(
    await page.locator(".measurement-layout .notice").first().textContent(),
    /measured.csv/,
  );
  await page
    .getByRole("button", { name: "Load projectile demo", exact: true })
    .click();
  await page
    .getByText("Track an object in a local video", { exact: true })
    .click();
  await page
    .getByLabel("Local video", { exact: true })
    .setInputFiles("test-fixtures/tracking.mp4");
  await page.getByText(/640 × 360 source pixels/).waitFor();
  for (const [t, y] of [
    [0, 260],
    [0.4, 210],
    [0.8, 180],
    [1.2, 170],
  ]) {
    await page.getByLabel("Seek time (s)", { exact: true }).fill(String(t));
    await page.getByRole("button", { name: "Seek", exact: true }).click();
    await page.waitForFunction((target) => {
      const v = document.querySelector("video");
      return !v.seeking && Math.abs(v.currentTime - target) < 0.02;
    }, t);
    await page.getByLabel("X (source px)", { exact: true }).fill("110");
    await page
      .getByLabel("Y (source px, down)", { exact: true })
      .fill(String(y));
    await page
      .getByRole("button", { name: "Record coordinate", exact: true })
      .click();
  }
  assert.match(
    await page.locator(".measurement-layout .metric-grid").innerText(),
    /px\/s²/,
  );
  assert.doesNotMatch(
    await page.locator(".measurement-layout .metric-grid").innerText(),
    /Candidate g/,
  );
  await page.getByLabel("Reference length (m)", { exact: true }).fill("1");
  await page
    .getByLabel("Reference length (source px)", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "Apply calibration", exact: true })
    .click();
  const jsonDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export analysis JSON", exact: true })
    .click();
  const analysis = JSON.parse(
    await readFile(await (await jsonDownload).path(), "utf8"),
  );
  assert.equal(analysis.dataset.unit, "m");
  assert.equal(analysis.dataset.points.length, 4);
  assert.equal(analysis.dataset.calibration.metersPerPixel, 0.01);
  assert.equal(analysis.dataset.rawTracking[0].pixelY, 260);
  await page.locator("[data-mode=audio]").click();
  await page.locator("[data-mode=measure]").click();
  assert.match(
    await page.locator(".measurement-layout .metric-grid").innerText(),
    /Candidate g/,
  );
  await page.locator("#search-open").click();
  await page.locator("#instrument-search").fill("gravity");
  await page
    .getByRole("button", {
      name: "Projectile motion Launch angle, gravity, trajectory, parameter sweeps",
    })
    .click();
  assert.equal(await page.locator("#mechanics-workspace").isVisible(), true);
  await page.locator("#guide-open").click();
  assert.equal(await page.locator("#guide-dialog").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#guide-dialog").isVisible(), false);
  for (const width of [1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator("[data-lab=projectile]").click();
    await page.waitForTimeout(80);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `mechanics overflow ${width}`,
    );
    if (width === 390) await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(80);
    await page.screenshot({
      path: out + "/mechanics-mobile.png",
      fullPage: false,
    });
    for (const mode of ["audio", "measure"]) {
      await page.locator(`[data-mode=${mode}]`).click();
      await page.waitForTimeout(50);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${mode} overflow ${width}`,
      );
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("[data-lab=projectile]").click();
  assert.equal(await page.locator("#play").innerText(), "Step");
  await page.locator("#play").click();
  assert.notEqual(await page.locator("#time").inputValue(), "0");
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    "PASS real MP4 decode, manual video coordinates/calibration/metadata, preserved navigation and adapter history; integrated mechanics/presets/invalid-state/session roundtrip/quantity/sweep/analysis bridge/audio/CSV preservation/search/guide/320–1440 widths/reduced-motion; zero page errors or HTTP failures.",
  );

  const mic = await browser.newPage();
  const micErrors = [];
  mic.on("pageerror", (e) => micErrors.push(e.message));
  await mic.addInitScript(() => {
    window.captureMetrics = {
      contexts: 0,
      closed: 0,
      stops: 0,
      requests: 0,
      tones: 0,
    };
    window.pendingMic = [];
    class FakeAudio {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
        this.state = "running";
        window.captureMetrics.contexts++;
        this.destination = {};
      }
      async resume() {}
      async close() {
        if (this.state !== "closed") {
          this.state = "closed";
          window.captureMetrics.closed++;
        }
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData(a) {
            for (let i = 0; i < a.length; i++)
              a[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48000);
          },
        };
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect(g) {
            return g;
          },
          start() {
            window.captureMetrics.tones++;
          },
          stop() {},
          disconnect() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
          connect() {},
        };
      }
    }
    window.AudioContext = FakeAudio;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia() {
          window.captureMetrics.requests++;
          return new Promise((resolve, reject) =>
            window.pendingMic.push({ resolve, reject }),
          );
        },
      },
    });
    window.resolveMic = () => {
      const t = new EventTarget();
      t.stop = () => window.captureMetrics.stops++;
      t.getSettings = () => ({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        sampleRate: 48000,
        deviceId: "MUST-NOT-EXPORT",
      });
      window.pendingMic
        .shift()
        .resolve({ getTracks: () => [t], getAudioTracks: () => [t] });
    };
  });
  await mic.goto(base + "#audio");
  await mic
    .getByRole("heading", { name: "See sound take shape.", exact: true })
    .waitFor();
  assert.equal(await mic.evaluate(() => window.captureMetrics.requests), 0);
  await mic
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await mic
    .getByRole("button", { name: "Cancel microphone request", exact: true })
    .click();
  await mic.evaluate(() => window.resolveMic());
  await mic.waitForTimeout(30);
  assert.equal(await mic.evaluate(() => window.captureMetrics.stops), 1);
  await mic
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await mic.evaluate(() => window.resolveMic());
  await mic
    .getByRole("heading", { name: "Live microphone", exact: true })
    .waitFor();
  await mic.waitForTimeout(150);
  const micSave = mic.waitForEvent("download");
  await mic
    .getByRole("button", { name: "Save audio session", exact: true })
    .click();
  const capture = JSON.parse(
    await readFile(await (await micSave).path(), "utf8"),
  );
  assert.equal(capture.metadata.originalSource, "microphone");
  assert.equal(capture.metadata.microphone.autoGainControl, true);
  assert.equal(JSON.stringify(capture).includes("MUST-NOT-EXPORT"), false);
  await mic.locator("[data-lab=projectile]").click();
  assert.equal(await mic.evaluate(() => window.captureMetrics.stops), 2);
  assert.equal(await mic.evaluate(() => window.captureMetrics.closed), 1);
  await mic.locator("[data-mode=audio]").click();
  assert.match(
    await mic.locator("[data-source]").innerText(),
    /Captured window replay/,
  );
  await mic
    .getByRole("button", { name: "Use simulation", exact: true })
    .click();
  await mic
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await mic.evaluate(() =>
    window.pendingMic
      .shift()
      .reject(Object.assign(new Error("Denied"), { name: "NotAllowedError" })),
  );
  await mic.locator("[data-error]").waitFor({ state: "visible" });
  assert.match(
    await mic.locator("[data-error]").innerText(),
    /permission was denied/,
  );
  assert.deepEqual(micErrors, []);
  console.log(
    "PASS integrated mocked microphone opt-in, canceled late stream, acquisition metadata, no device identifiers, navigation release and denied permission. Actual hardware not exercised.",
  );
} finally {
  await browser.close();
}
