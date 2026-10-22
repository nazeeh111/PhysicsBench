import { performance } from "node:perf_hooks";
import { createSyntheticRecord, analyzeProtocol } from "../acoustics.js";
for (const sampleRate of [16000, 48000, 96000]) {
  const record = createSyntheticRecord({ sampleRate }),
    times = [];
  for (let i = 0; i < 7; i++) {
    const before = performance.now();
    const analysis = analyzeProtocol(record);
    times.push(performance.now() - before);
    if (!analysis.quality.usable)
      throw new Error("Benchmark specimen failed its own quality checks.");
  }
  const sorted = times.slice(1).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      sampleRate,
      samples: record.excitation.length,
      coldMs: Number(times[0].toFixed(2)),
      warmMedianMs: Number(((sorted[2] + sorted[3]) / 2).toFixed(2)),
      scope:
        "This machine, Node " +
        process.version +
        "; worker/message/encoding time excluded.",
    }),
  );
}
