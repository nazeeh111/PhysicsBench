import { analyzeProtocol, createSyntheticRecord } from "./acoustics.js";
self.onmessage = (event) => {
  const { id, type, record, options } = event.data;
  try {
    const input =
      type === "synthetic" ? createSyntheticRecord(options) : record;
    const analysis = analyzeProtocol(input);
    self.postMessage({ id, record: input, analysis });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
