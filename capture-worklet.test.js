import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(
  new URL("./capture-worklet.js", import.meta.url),
  "utf8",
);
function processor() {
  const messages = [];
  let Processor;
  const context = vm.createContext({
    Float32Array,
    Number,
    currentFrame: 1000,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => messages.push(m) };
      }
    },
    registerProcessor: (name, p) => {
      Processor = p;
    },
  });
  vm.runInContext(source, context);
  const node = new Processor();
  return { node, context, messages };
}
test("worklet retains exact rendered samples and explicit continuity metadata", () => {
  const { node, context, messages } = processor(),
    x = Float32Array.from({ length: 300 }, (_, i) => i / 1000);
  node.port.onmessage({ data: { type: "start", excitation: x } });
  for (let block = 0; block < 3; block++) {
    context.currentFrame = 1000 + 128 * block;
    const input = Float32Array.from(
        { length: 128 },
        (_, i) => (block * 128 + i) / 500,
      ),
      out = new Float32Array(128);
    node.process([[input]], [[out]]);
    for (let i = 0; i < Math.min(128, 300 - block * 128); i++)
      assert.equal(out[i], x[block * 128 + i]);
  }
  const done = messages.find((m) => m.type === "complete");
  assert.equal(done.response.length, 300);
  assert.equal(done.integrity.missingInputFrames, 0);
  assert.equal(done.integrity.discontinuities, 0);
  assert.equal(done.integrity.startFrame, 1000);
  assert.equal(done.integrity.endFrame, 1300);
  assert.equal(done.response[299], new Float32Array([299 / 500])[0]);
});
test("absent input and skipped render frames are never hidden as legitimate silence", () => {
  const { node, context, messages } = processor();
  node.port.onmessage({
    data: { type: "start", excitation: new Float32Array(256) },
  });
  node.process([[]], [[new Float32Array(128)]]);
  context.currentFrame = 1000 + 128 + 2048;
  node.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
  const health = messages.find((m) => m.type === "complete").integrity;
  assert.equal(health.missingInputFrames, 128);
  assert.equal(health.discontinuities, 1);
  assert.equal(health.gapFrames, 2048);
});
