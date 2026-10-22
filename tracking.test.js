import test from "node:test";
import assert from "node:assert/strict";
import {
  makeTemplate,
  matchTemplate,
  grayscale,
  accelerationSensitivity,
} from "./tracking.js";
import { fitPolynomial } from "./analysis.js";
import { validateMotionRun } from "./motion-lab.js";

function frame(width = 170, height = 130) {
  return {
    width,
    height,
    pixels: Float32Array.from(
      { length: width * height },
      (_, i) => 28 + 3 * Math.sin(i * 0.731),
    ),
  };
}
function stamp(
  image,
  cx,
  cy,
  { gain = 1, offset = 0, noise = 0, variant = false } = {},
) {
  for (let y = -9; y <= 9; y++)
    for (let x = -9; x <= 9; x++) {
      // Asymmetric textured square, not a featureless perfect circle.
      const value =
        70 +
        (((x + 13) * 17 + (y + 11) * 29) % 130) +
        (x < -2 && y > 1 ? 25 : 0);
      image.pixels[(cy + y) * image.width + cx + x] =
        offset +
        gain * (variant ? 240 - value : value) +
        noise * Math.sin(x * 2.3 + y * 6.7);
    }
  return image;
}
test("NCC follows a translated textured target under brightness, gain and noise changes", () => {
  const original = stamp(frame(), 44, 66);
  const template = makeTemplate(original, 44, 66, 19);
  const next = stamp(frame(), 68, 50, { gain: 0.72, offset: 36, noise: 7 });
  stamp(next, 99, 73, { variant: true });
  const result = matchTemplate(
    next,
    template,
    { x: 44, y: 66 },
    { radius: 60 },
  );
  assert.equal(result.accepted, true);
  assert.deepEqual(result.candidate, { x: 68, y: 50 });
  assert.ok(result.confidence > 0.98);
});
test("occlusion stops tracking instead of manufacturing an observation", () => {
  const template = makeTemplate(stamp(frame(), 44, 66), 44, 66, 19);
  const result = matchTemplate(frame(), template, { x: 44, y: 66 });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /threshold/);
});
test("two indistinguishable separated targets are rejected as ambiguous", () => {
  const template = makeTemplate(stamp(frame(), 44, 66), 44, 66, 19);
  const next = stamp(stamp(frame(), 64, 52), 106, 76);
  const result = matchTemplate(
    next,
    template,
    { x: 70, y: 66 },
    { radius: 60 },
  );
  assert.equal(result.accepted, false);
  assert.match(result.reason, /similar/);
  assert.ok(result.ambiguity < 0.08);
});
test("bounded search does not silently reacquire a target outside its window", () => {
  const template = makeTemplate(stamp(frame(), 44, 66), 44, 66, 19);
  const result = matchTemplate(
    stamp(frame(), 130, 66),
    template,
    { x: 44, y: 66 },
    { radius: 30 },
  );
  assert.equal(result.accepted, false);
  assert.ok(result.candidate.x <= 74);
});
test("template validation rejects edge patches and flat targets", () => {
  assert.throws(() => makeTemplate(frame(), 1, 1), /edge/);
  assert.throws(
    () =>
      makeTemplate(
        { width: 50, height: 50, pixels: new Float32Array(2500).fill(10) },
        25,
        25,
      ),
    /texture/,
  );
  assert.throws(() => makeTemplate(frame(), 20, 20, 100), /template/);
});
test("RGBA conversion retains luminance and rejects malformed frames", () => {
  const result = grayscale({ width: 1, height: 1, data: [255, 0, 0, 255] });
  assert.ok(Math.abs(result.pixels[0] - 54.213) < 0.001);
  assert.throws(() => grayscale({ width: 2, height: 2, data: [] }), /RGBA/);
});
test("reported point sensitivity bounds worst-case quadratic acceleration perturbation", () => {
  const times = Array.from({ length: 17 }, (_, i) => i * 0.07);
  const scale = 0.02,
    delta = 1.5;
  const sensitivity = accelerationSensitivity(times, scale, delta);
  const points = times.map((t) => ({ t, y: 1 + 6 * t - 4.905 * t * t }));
  const before = fitPolynomial(points, 2).coefficients[2] * 2;
  const perturbed = points.map((p, i) => ({
    t: p.t,
    y: p.y + Math.sign(sensitivity.weights[i]) * delta * scale,
  }));
  const after = fitPolynomial(perturbed, 2).coefficients[2] * 2;
  assert.ok(Math.abs(after - before - sensitivity.bound) < 1e-10);
  assert.ok(
    Math.abs(sensitivity.weights.reduce((sum, w) => sum + w, 0)) < 1e-10,
  );
  assert.throws(() => accelerationSensitivity([0, 0, 0, 0], 0.02), /interval/);
});

const sampleRun = () => ({
  type: "motion",
  version: 1,
  id: "test-motion-run",
  name: "Test specimen",
  question: "Does this track curve?",
  notes: "",
  source: {
    kind: "generated",
    scenario: "flight",
    name: "Generated test",
    width: 960,
    height: 540,
    duration: 1.8,
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
  observations: [
    {
      id: "p1",
      t: 0,
      x: 120,
      y: 440,
      included: true,
      method: "seed",
      confidence: null,
      ambiguity: null,
    },
    {
      id: "p2",
      t: 0.1,
      x: 157,
      y: 390,
      included: false,
      method: "manual",
      confidence: null,
      ambiguity: null,
    },
  ],
  gaps: [{ t: 0.2, reason: "Occluded" }],
  model: "ballistic",
  fitStart: 0,
  fitEnd: 1.8,
  cursor: 0.1,
  selectedId: "p2",
  settings: {
    step: 0.075,
    searchRadius: 60,
    minSimilarity: 0.78,
    ambiguityMargin: 0.08,
    templateSize: 35,
    chartAxis: "y",
  },
});
test("motion records preserve excluded observations, ruler, gaps, settings and stable identity", () => {
  const original = sampleRun(),
    restored = validateMotionRun(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original);
  restored.observations[0].x = 1;
  assert.equal(
    original.observations[0].x,
    120,
    "validation returns independent bytes",
  );
  const legacy = sampleRun();
  delete legacy.id;
  delete legacy.settings;
  assert.equal(typeof validateMotionRun(legacy).id, "string");
});
test("motion records reject duplicate times, source mismatches and invalid calibration before use", () => {
  const times = sampleRun();
  times.observations[1].t = 0;
  assert.throws(() => validateMotionRun(times), /observation/);
  const ruler = sampleRun();
  ruler.calibration.b = { ...ruler.calibration.a };
  assert.throws(() => validateMotionRun(ruler), /ruler/);
  const dimensions = sampleRun();
  dimensions.source.width = 2000;
  assert.throws(() => validateMotionRun(dimensions), /specimen/);
  const imported = sampleRun();
  imported.observations[0].x = Infinity;
  assert.throws(() => validateMotionRun(imported), /observation/);
  const settings = sampleRun();
  settings.settings.searchRadius = 99999;
  assert.throws(() => validateMotionRun(settings), /settings/);
});
