import test from "node:test";
import assert from "node:assert/strict";
import { LABS, defaults, createModel } from "./models.js";
import {
  exportSession,
  importSession,
  exportCSV,
  importCSV,
  SESSION_MAX_BYTES,
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
} from "./data.js";

function changedCell(csv, row, key, value) {
  const lines = csv.trimEnd().split("\n");
  const column = lines[6].split(",").indexOf(key);
  assert.notEqual(column, -1);
  const cells = lines[7 + row].split(",");
  cells[column] = String(value);
  lines[7 + row] = cells.join(",");
  return lines.join("\n") + "\n";
}

function changedMetadata(csv, key, value) {
  return csv
    .split("\n")
    .map((line) => (line.startsWith(`# ${key}: `) ? `# ${key}: ${JSON.stringify(value)}` : line))
    .join("\n");
}

for (const lab of Object.keys(LABS)) {
  test(`${lab}: session round trip preserves finite parameters and playback time`, () => {
    const params = defaults(lab);
    const time = createModel(lab, params).duration * 0.375;
    const imported = importSession(exportSession(lab, params, time));
    assert.deepEqual(imported, { lab, params, time });
    assert.notEqual(imported.params, params);
    imported.params[LABS[lab].parameters[0].key] = -123;
    assert.deepEqual(params, defaults(lab));
  });

  test(`${lab}: CSV round trip preserves model samples, SI units and assumptions`, () => {
    const params = defaults(lab);
    const model = createModel(lab, params);
    const csv = exportCSV(lab, params, 17);
    const imported = importCSV(csv);
    assert.equal(imported.lab, lab);
    assert.deepEqual(imported.params, params);
    assert.deepEqual(imported.columns, model.columns);
    assert.equal(imported.rows.length, 17);
    assert.equal(imported.rows[0][0], 0);
    assert.equal(imported.rows.at(-1)[0], model.duration);
    for (const row of imported.rows) {
      assert.deepEqual(
        row,
        model.columns.map((column) => model.stateAt(row[0])[column.key]),
      );
    }
    assert.match(csv, /# units: /);
    assert.match(csv, /# assumptions: /);
    assert.equal(importCSV(csv.replaceAll("\n", "\r\n")).rows.length, 17);
    assert.equal(importCSV(csv.trimEnd()).rows.length, 17);
  });

  test(`${lab}: supported parameter extremes round trip without non-finite values`, () => {
    for (const boundary of ["min", "max"]) {
      const params = Object.fromEntries(
        LABS[lab].parameters.map((parameter) => [parameter.key, parameter[boundary]]),
      );
      const model = createModel(lab, params);
      assert.deepEqual(importSession(exportSession(lab, params, model.duration)).params, params);
      assert.equal(importCSV(exportCSV(lab, params, 7)).rows.length, model.duration === 0 ? 1 : 7);
    }
  });

  test(`${lab}: maximum sample count stays within the byte and row limits`, () => {
    const csv = exportCSV(lab, defaults(lab), CSV_MAX_ROWS);
    assert.ok(new TextEncoder().encode(csv).length <= CSV_MAX_BYTES);
    assert.equal(importCSV(csv).rows.length, CSV_MAX_ROWS);
  });
}

test("CSV deduplicates unrepresentable time subdivisions and retains both endpoints", () => {
  for (const height of [Number.MIN_VALUE, 2 * Number.MIN_VALUE, 7 * Number.MIN_VALUE]) {
    const params = { speed: 1, angle: -90, height, gravity: 9.81 };
    const model = createModel("projectile", params);
    assert.ok(model.duration > 0);
    const imported = importCSV(exportCSV("projectile", params));
    const times = imported.rows.map((row) => row[0]);
    assert.equal(times[0], 0);
    assert.equal(times.at(-1), model.duration);
    assert.equal(times.length, new Set(times).size);
    assert.ok(times.length >= 2 && times.length < 201);
    for (let i = 1; i < times.length; i += 1) assert.ok(times[i] > times[i - 1]);
  }
  for (const lab of Object.keys(LABS)) {
    const params = defaults(lab);
    const imported = importCSV(exportCSV(lab, params));
    assert.equal(imported.rows.length, 201);
    assert.equal(imported.rows[0][0], 0);
    assert.equal(imported.rows.at(-1)[0], createModel(lab, params).duration);
  }
});

test("zero-duration projectile has a single finite sample and accepts only t=0", () => {
  const params = { ...defaults("projectile"), speed: 0, height: 0 };
  assert.equal(createModel("projectile", params).duration, 0);
  assert.equal(importCSV(exportCSV("projectile", params)).rows.length, 1);
  assert.equal(importCSV(exportCSV("projectile", params, 1)).rows[0][0], 0);
  assert.equal(importSession(exportSession("projectile", params, 0)).time, 0);
  assert.throws(() => exportSession("projectile", params, 0.01), /Time/);
});

test("session schema rejects unknown, missing, prototype and duplicate properties", () => {
  const text = exportSession("projectile", defaults("projectile"), 0);
  const session = JSON.parse(text);
  for (const field of Object.keys(session)) {
    const missing = { ...session };
    delete missing[field];
    assert.throws(() => importSession(JSON.stringify(missing)), /properties/);
  }
  for (const extra of ["unexpected", "__proto__", "constructor", "prototype"]) {
    assert.throws(
      () => importSession(text.replace("{", `{${JSON.stringify(extra)}: {},`)),
      /properties/,
    );
    const params = JSON.parse(JSON.stringify(session.params));
    Object.defineProperty(params, extra, { value: {}, enumerable: true });
    assert.throws(() => importSession(JSON.stringify({ ...session, params })), /properties/);
  }
  assert.throws(
    () => importSession(text.replace("{", '{"lab":"collision",')),
    /duplicate property/,
  );
  assert.throws(
    () => importSession(text.replace("{", '{"l\\u0061b":"collision",')),
    /duplicate property/,
  );
  assert.throws(
    () => importSession(text.replace('"speed":', '"speed": 2, "speed":')),
    /duplicate property/,
  );
  for (const value of ["null", "[]", "0", '"session"', "{", ""])
    assert.throws(() => importSession(value));
});

test("session format, parameter and time validation reject coercion and out-of-domain values", () => {
  const session = JSON.parse(exportSession("oscillator", defaults("oscillator"), 0));
  for (const patch of [
    { format: "other" },
    { version: 2 },
    { version: "1" },
    { lab: "__proto__" },
    { lab: "constructor" },
    { lab: "unknown" },
    { time: -1 },
    { time: "0" },
    { time: null },
    { time: true },
    { time: createModel(session.lab, session.params).duration + 1 },
    { params: [] },
    { params: null },
    { params: { ...session.params, mass: 0 } },
    { params: { ...session.params, mass: "1" } },
  ])
    assert.throws(() => importSession(JSON.stringify({ ...session, ...patch })));
  assert.throws(
    () => importSession(JSON.stringify(session).replace('"time":0', '"time":1e999')),
    /Time/,
  );
  for (const time of [NaN, Infinity, -Infinity, undefined, "0"]) {
    assert.throws(() => exportSession(session.lab, session.params, time), /Time/);
  }
  assert.throws(() => exportSession("oscillator", { ...session.params, mass: Infinity }, 0));
  const symbolParams = { ...session.params, [Symbol("extra")]: 1 };
  assert.throws(() => exportSession("oscillator", symbolParams, 0), /properties/);
});

test("size limits count UTF-8 bytes and reject non-text before parsing", () => {
  for (const value of [null, 123, {}, new Uint8Array(3)]) {
    assert.throws(() => importSession(value), /must be text/);
    assert.throws(() => importCSV(value), /must be text/);
  }
  assert.throws(() => importSession(" ".repeat(SESSION_MAX_BYTES + 1)), /64 KiB/);
  assert.throws(() => importSession("é".repeat(SESSION_MAX_BYTES / 2 + 1)), /64 KiB/);
  assert.throws(() => importCSV(" ".repeat(CSV_MAX_BYTES + 1)), /512 KiB/);
  assert.throws(() => importCSV("é".repeat(CSV_MAX_BYTES / 2 + 1)), /512 KiB/);
});

test("CSV metadata and column schema are exact and versioned", () => {
  const csv = exportCSV("projectile", defaults("projectile"), 3);
  for (const [key, value] of [
    ["format", "other"],
    ["version", 2],
    ["lab", "__proto__"],
    ["params", { ...defaults("projectile"), extra: 1 }],
    ["units", ["seconds"]],
    ["assumptions", []],
  ])
    assert.throws(() => importCSV(changedMetadata(csv, key, value)));
  const lines = csv.trimEnd().split("\n");
  for (let index = 0; index < 6; index += 1) {
    assert.throws(() => importCSV(lines.filter((_, i) => i !== index).join("\n")));
  }
  for (const header of [
    "t,x,y",
    "t,x,y,vx,vy,speed,unknown",
    "x,t,y,vx,vy,speed,energySpecific",
    "t,x,y,vx,vy,speed,speed",
  ]) {
    const changed = [...lines];
    changed[6] = header;
    assert.throws(() => importCSV(changed.join("\n")), /columns/);
  }
  assert.throws(
    () => importCSV(csv.replace('"speed":15', '"speed":1,"speed":15')),
    /duplicate property/,
  );
});

test("CSV rejects formulas, strings, malformed cells, non-finite values and wrong row lengths", () => {
  const csv = exportCSV("oscillator", defaults("oscillator"), 3);
  for (const value of [
    "=1+1",
    "+1",
    "@SUM(A1)",
    "NaN",
    "Infinity",
    "1e999",
    '"1"',
    "",
    "0x10",
    "1 m",
    " 1",
  ]) {
    assert.throws(() => importCSV(changedCell(csv, 0, "x", value)), /numeric|non-finite/);
  }
  const lines = csv.trimEnd().split("\n");
  lines[7] += ",0";
  assert.throws(() => importCSV(lines.join("\n")), /number of columns/);
  lines[7] = "0";
  assert.throws(() => importCSV(lines.join("\n")), /number of columns/);
});

test("CSV row counts and time ordering are bounded before use", () => {
  const params = defaults("projectile");
  const csv = exportCSV("projectile", params, 3);
  const duration = createModel("projectile", params).duration;
  assert.throws(() => importCSV(changedCell(csv, 1, "t", 0)), /strictly increasing/);
  assert.throws(() => importCSV(changedCell(csv, 2, "t", duration / 4)), /strictly increasing/);
  assert.throws(() => importCSV(changedCell(csv, 0, "t", -1)), /Time/);
  assert.throws(() => importCSV(changedCell(csv, 2, "t", duration + 1)), /Time/);
  const lines = csv.trimEnd().split("\n");
  assert.throws(() => importCSV(lines.slice(0, 8).join("\n")), /sample rows/);
  assert.throws(
    () => importCSV([...lines.slice(0, 7), ...Array(CSV_MAX_ROWS + 1).fill(lines[7])].join("\n")),
    /sample rows/,
  );
  for (const count of [0, 1, 2.5, CSV_MAX_ROWS + 1, NaN, Infinity, "3"]) {
    assert.throws(() => exportCSV("projectile", params, count), /Sample count/);
  }
});

test("CSV accepts partial replay intervals and roundoff, but rejects physical contradictions", () => {
  const csv = exportCSV("projectile", defaults("projectile"), 5);
  const lines = csv.trimEnd().split("\n");
  assert.equal(importCSV([...lines.slice(0, 7), ...lines.slice(8, 10)].join("\n")).rows.length, 2);
  assert.equal(importCSV(changedCell(csv, 0, "x", 1e-10)).rows[0][1], 1e-10);
  assert.throws(() => importCSV(changedCell(csv, 1, "y", -1)), /does not match/);
  assert.throws(() => importCSV(changedCell(csv, 1, "x", 1e100)), /does not match/);
  const collision = exportCSV("collision", defaults("collision"), 3);
  assert.throws(() => importCSV(changedCell(collision, 1, "kinetic", -10)), /does not match/);
  assert.throws(() => importCSV(changedCell(collision, 1, "separation", -1)), /does not match/);
  assert.throws(
    () => importCSV(changedMetadata(csv, "params", { ...defaults("projectile"), gravity: 10 })),
    /Time|does not match/,
  );
});

test("failed imports leave the last valid session and comparison untouched", () => {
  let session = importSession(exportSession("projectile", defaults("projectile"), 0));
  let comparison = importCSV(exportCSV("projectile", defaults("projectile"), 3));
  const savedSession = structuredClone(session);
  const savedComparison = structuredClone(comparison);
  assert.throws(() => {
    session = importSession('{"format":"bad"}');
  });
  assert.throws(() => {
    comparison = importCSV("t,x\n0,=1+1");
  });
  assert.deepEqual(session, savedSession);
  assert.deepEqual(comparison, savedComparison);
});
