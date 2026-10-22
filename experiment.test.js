import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeSamples,
  decodeSamples,
  makeRun,
  parseRun,
  stringifyRun,
  compareTrials,
  recordingFingerprint,
} from "./experiment.js";
test("raw sample packets preserve exact float32 bytes including signed zero", () => {
  const x = new Float32Array([0, -0, 0.1234567, -1.2]);
  assert.deepEqual(decodeSamples(encodeSamples(x)), x);
  assert.throws(() =>
    decodeSamples({ encoding: "float32-le-base64", length: 10, data: "AA==" }),
  );
  assert.throws(() =>
    decodeSamples({ encoding: "float32-le-base64", length: 0, data: "" }),
  );
});
test("portable run format roundtrip rejects malformed/oversize and unknown versions", () => {
  const r = makeRun("motion", { points: [{ t: 0, x: 2, y: 4 }] }, "Test");
  assert.deepEqual(parseRun(stringifyRun(r)), r);
  assert.throws(() => parseRun("{"));
  assert.throws(() => parseRun(JSON.stringify({ ...r, version: 2 })));
  assert.throws(() => parseRun(" ".repeat(13 * 1024 * 1024)));
});
test("repeatability analysis requires independent repetitions and matched acquisition setup", () => {
  const trial = (condition, tailEnergyRatio) =>
    makeRun(
      "acoustic",
      {
        acquisitionId: crypto.randomUUID(),
        captureFingerprint: crypto
          .randomUUID()
          .replaceAll("-", "")
          .padEnd(64, "0"),
        condition,
        source: "simulation",
        setupId: "fixed",
        sampleRate: 16000,
        protocolVersion: 1,
        summary: { nrmse: 0.02, accepted: true, tailEnergyRatio },
      },
      condition,
    );
  const runs = [
    trial("A", 0.4),
    trial("A", 0.42),
    trial("B", 0.2),
    trial("B", 0.22),
  ];
  const result = compareTrials(runs);
  assert.ok(Math.abs(result.difference + 0.2) < 1e-12);
  assert.match(result.interpretation, /exceeds/);
  assert.throws(() => compareTrials(runs.slice(0, 3)));
  runs[3].data.setupId = "moved";
  assert.throws(() => compareTrials(runs));
});

test("recording identity derives from canonical raw bytes, not a user-supplied acquisition label", async () => {
  const x = new Float32Array([0, 0.5, -0.5]),
    y = new Float32Array([0, 0.2, -0.2]);
  const a = await recordingFingerprint(x, y, 16000);
  assert.equal(a, await recordingFingerprint(x.slice(), y.slice(), 16000));
  assert.notEqual(
    a,
    await recordingFingerprint(x, new Float32Array([0, 0.3, -0.2]), 16000),
  );
});
