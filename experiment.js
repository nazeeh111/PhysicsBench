// Portable experiment records. Raw observations are authoritative; cached analysis
// is recalculated by each instrument when a record is reopened.
export const MAX_RUN_BYTES = 12 * 1024 * 1024;
export const MAX_SAVED_RUNS = 40;
export function encodeSamples(values) {
  const floats = Float32Array.from(values);
  const bytes = new Uint8Array(floats.length * 4),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < floats.length; i++) {
    if (!Number.isFinite(floats[i]))
      throw new Error("A recording contains non-finite samples.");
    view.setFloat32(i * 4, floats[i], true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    encoding: "float32-le-base64",
    length: floats.length,
    data: btoa(binary),
  };
}
export function decodeSamples(packet) {
  if (
    !packet ||
    packet.encoding !== "float32-le-base64" ||
    !Number.isInteger(packet.length) ||
    packet.length < 1 ||
    packet.length > 1200000 ||
    typeof packet.data !== "string" ||
    packet.data.length > 6400000
  )
    throw new Error("Invalid bounded sample packet.");
  let binary;
  try {
    binary = atob(packet.data);
  } catch {
    throw new Error("Sample encoding is invalid.");
  }
  if (binary.length !== packet.length * 4)
    throw new Error("Sample length differs from its encoded bytes.");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    view = new DataView(bytes.buffer),
    values = new Float32Array(packet.length);
  for (let i = 0; i < values.length; i++) {
    values[i] = view.getFloat32(i * 4, true);
    if (!Number.isFinite(values[i]) || Math.abs(values[i]) > 8)
      throw new Error("Samples exceed the supported normalized range.");
  }
  return values;
}
export async function recordingFingerprint(excitation, response, sampleRate) {
  const canonical = JSON.stringify([
    sampleRate,
    encodeSamples(excitation),
    encodeSamples(response),
  ]);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function makeRun(kind, data, title) {
  if (!["acoustic", "motion"].includes(kind))
    throw new Error("Unsupported investigation type.");
  return {
    format: "physicsbench-investigation",
    version: 1,
    id: globalThis.crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: String(title || "Untitled investigation").slice(0, 120),
    kind,
    data,
  };
}
export function parseRun(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_RUN_BYTES
  )
    throw new Error("Investigation files must be at most 12 MiB.");
  let run;
  try {
    run = JSON.parse(text);
  } catch {
    throw new Error("The investigation file is not valid JSON.");
  }
  if (
    run?.format !== "physicsbench-investigation" ||
    run.version !== 1 ||
    !["acoustic", "motion"].includes(run.kind) ||
    typeof run.title !== "string" ||
    run.title.length > 120 ||
    typeof run.id !== "string" ||
    run.id.length > 100 ||
    !Number.isFinite(Date.parse(run.createdAt)) ||
    !run.data ||
    typeof run.data !== "object" ||
    Array.isArray(run.data)
  )
    throw new Error(
      "Unsupported investigation record. The current work was retained.",
    );
  return run;
}
export function stringifyRun(run) {
  const text = JSON.stringify(run);
  parseRun(text);
  return text;
}
export function compareTrials(runs) {
  if (runs.length < 4)
    throw new Error(
      "Select at least two repetitions in each of two conditions.",
    );
  const groups = new Map(),
    acquisitions = new Set(),
    fingerprints = new Set();
  let signature = null;
  for (const run of runs) {
    const d = run.data,
      s = d?.summary;
    if (
      typeof d?.acquisitionId !== "string" ||
      acquisitions.has(d.acquisitionId)
    )
      throw new Error(
        "Each repetition must come from a separate acquisition; duplicate captures cannot establish repeatability.",
      );
    acquisitions.add(d.acquisitionId);
    if (
      typeof d.captureFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(d.captureFingerprint) ||
      fingerprints.has(d.captureFingerprint)
    )
      throw new Error(
        "Identical recordings cannot count as separate repetitions. Acquire a new response.",
      );
    fingerprints.add(d.captureFingerprint);
    if (
      run.kind !== "acoustic" ||
      !s ||
      !Number.isFinite(s.nrmse) ||
      typeof d.condition !== "string" ||
      !d.condition.trim()
    )
      throw new Error(
        "Each run needs an acoustic result and a named condition.",
      );
    const next = JSON.stringify([
      d.protocolVersion,
      d.sampleRate,
      d.setupId,
      d.source,
      d.capture?.amplitude,
      d.capture?.lowHz,
      d.capture?.highHz,
      d.capture?.settings,
    ]);
    if (signature !== null && next !== signature)
      throw new Error(
        "Use one protocol, sample rate, source and setup for a repeatability comparison.",
      );
    signature = next;
    if (!s.accepted)
      throw new Error(
        "A run failed the signal-quality/model checks. Inspect it individually before comparing.",
      );
    const key = d.condition.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  if (groups.size !== 2 || [...groups.values()].some((v) => v.length < 2))
    throw new Error(
      "Use exactly two conditions, each with at least two separate acquisitions.",
    );
  const stats = (values) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1),
    );
    return { n: values.length, mean, sd, se: sd / Math.sqrt(values.length) };
  };
  const summaries = [...groups].map(([condition, v]) => ({
    condition,
    error: stats(v.map((x) => x.nrmse)),
    tail: stats(v.map((x) => x.tailEnergyRatio)),
  }));
  const a = summaries[0],
    b = summaries[1],
    difference = b.tail.mean - a.tail.mean,
    standardError = Math.hypot(a.tail.se, b.tail.se);
  return {
    groups: summaries,
    difference,
    standardError,
    signalToRepeatability:
      standardError === 0 ? null : Math.abs(difference) / standardError,
    interpretation:
      standardError === 0
        ? "No repeat-to-repeat variation observed; uncertainty cannot be established from identical trials."
        : Math.abs(difference) > 3 * standardError
          ? "Tail-energy change exceeds three standard errors of these repetitions."
          : "These repetitions do not resolve a clear tail-energy change.",
    caveat:
      "Exploratory repeated-trial comparison, not proof of a causal room-only change. Fixed geometry, gain and capture processing remain assumptions.",
  };
}
export async function openRunStore() {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("physicsbench-investigations", 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("runs", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const map = new Map();
    return {
      persistent: false,
      list: async () => [...map.values()],
      put: async (r) => {
        if (map.size >= MAX_SAVED_RUNS && !map.has(r.id))
          throw new Error("Run limit reached. Export/remove a run first.");
        map.set(r.id, parseRun(stringifyRun(r)));
      },
      remove: async (id) => map.delete(id),
    };
  }
  const operation = (mode, fn) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction("runs", mode),
        req = fn(tx.objectStore("runs"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error || new Error("Local storage write failed."));
    });
  return {
    persistent: true,
    list: async () => operation("readonly", (s) => s.getAll()),
    put: async (run) => {
      const valid = parseRun(stringifyRun(run));
      await new Promise((resolve, reject) => {
        const tx = db.transaction("runs", "readwrite"),
          objectStore = tx.objectStore("runs"),
          keys = objectStore.getAllKeys();
        let reason = null;
        keys.onsuccess = () => {
          if (
            keys.result.length >= MAX_SAVED_RUNS &&
            !keys.result.includes(valid.id)
          ) {
            reason = new Error(
              "40 saved runs reached. Export/remove a run first.",
            );
            tx.abort();
          } else objectStore.put(valid);
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(
            reason ||
              tx.error ||
              new Error(
                "The local save was aborted; previous runs remain intact.",
              ),
          );
        tx.onerror = () => reject(tx.error);
      });
    },
    remove: (id) => operation("readwrite", (s) => s.delete(id)),
  };
}
