import { LABS, validateParams, createModel } from "./models.js";

export const SESSION_MAX_BYTES = 64 * 1024;
export const CSV_MAX_BYTES = 512 * 1024;
export const CSV_MAX_ROWS = 2001;

const FORMAT = "physicsbench";
const VERSION = 1;
const ABSOLUTE_TOLERANCE = 1e-9;
const RELATIVE_TOLERANCE = 1e-8;
const NUMBER_CELL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function fail(message) {
  throw new Error(message);
}

function boundedText(text, maxBytes, kind) {
  if (typeof text !== "string") fail(`${kind} must be text.`);
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) {
    fail(`${kind} exceeds the ${maxBytes / 1024} KiB limit.`);
  }
  return text;
}

// JSON.parse silently keeps the last repeated property. Detect duplicates too,
// including escaped spellings, so an imported session has one interpretation.
function parseJSON(text, label) {
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === '"') {
      const start = i;
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next += 1;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1));
        const keys = stack.at(-1);
        if (keys.has(key)) fail(`${label} contains a duplicate property: ${key}.`);
        keys.add(key);
      }
    }
  }
  return result;
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    fail(`${label} must be a plain object.`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    fail(`${label} has missing or unrecognized properties.`);
  }
}

function experiment(lab, params) {
  if (typeof lab !== "string" || !Object.hasOwn(LABS, lab)) fail("Unknown experiment.");
  exactObject(
    params,
    LABS[lab].parameters.map((parameter) => parameter.key),
    "Parameters",
  );
  const checked = validateParams(lab, params);
  const model = createModel(lab, checked);
  return { params: checked, model };
}

function validTime(time, duration) {
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time > duration) {
    fail("Time must be finite and within this experiment’s viewing interval.");
  }
  return time;
}

/** Save validated parameters and a paused position, without rounding values. */
export function exportSession(lab, params, time) {
  const checked = experiment(lab, params);
  validTime(time, checked.model.duration);
  return (
    JSON.stringify(
      { format: FORMAT, version: VERSION, lab, params: checked.params, time },
      null,
      2,
    ) + "\n"
  );
}

/** Return a new valid session. Callers replace active state only after success. */
export function importSession(text) {
  boundedText(text, SESSION_MAX_BYTES, "Session");
  const session = parseJSON(text, "Session");
  exactObject(session, ["format", "version", "lab", "params", "time"], "Session");
  if (session.format !== FORMAT || session.version !== VERSION)
    fail("Unsupported session format or version.");
  const checked = experiment(session.lab, session.params);
  const time = validTime(session.time, checked.model.duration);
  return { lab: session.lab, params: checked.params, time };
}

function metadata(lab, params, model) {
  return {
    format: FORMAT,
    version: VERSION,
    lab,
    params,
    units: model.columns.map((column) => column.unit),
    assumptions: model.assumptions,
  };
}

function numericState(model, time) {
  const state = model.stateAt(time);
  return model.columns.map((column) => {
    const value = state[column.key];
    if (typeof value !== "number" || !Number.isFinite(value))
      fail("The model produced a non-finite sample.");
    return value;
  });
}

/**
 * Export SI samples on an inclusive uniform time grid, omitting subdivisions
 * that round to a repeated floating-point time. A zero-duration model
 * produces one row at t=0. Comments use JSON values, followed by an unquoted
 * key header and finite numeric cells; this is a deliberately bounded dialect.
 */
export function exportCSV(lab, params, count = 201) {
  const checked = experiment(lab, params);
  const { model } = checked;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > CSV_MAX_ROWS ||
    (model.duration > 0 && count < 2)
  ) {
    fail(`Sample count must be an integer from ${model.duration > 0 ? 2 : 1} to ${CSV_MAX_ROWS}.`);
  }
  const rowCount = model.duration === 0 ? 1 : count;
  const lines = Object.entries(metadata(lab, checked.params, model)).map(
    ([key, value]) => `# ${key}: ${JSON.stringify(value)}`,
  );
  lines.push(model.columns.map((column) => column.key).join(","));
  let previousTime = -Infinity;
  for (let index = 0; index < rowCount; index += 1) {
    const time =
      index === rowCount - 1 ? model.duration : model.duration * (index / (rowCount - 1));
    // Extremely short intervals may have fewer representable times than rows.
    if (time === previousTime) continue;
    lines.push(numericState(model, time).join(","));
    previousTime = time;
  }
  return boundedText(lines.join("\n") + "\n", CSV_MAX_BYTES, "CSV");
}

/**
 * Import a PhysicsBench model replay for comparison, not arbitrary measured
 * data. Column order, units and assumptions must match this format version.
 * Each sample must agree with the declared analytic model within 1e-9 absolute
 * plus 1e-8 relative tolerance. Times may cover any subset of the model interval.
 * This function never changes an active experiment or adopts a playback time.
 */
export function importCSV(text) {
  boundedText(text, CSV_MAX_BYTES, "CSV");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const keys = ["format", "version", "lab", "params", "units", "assumptions"];
  const imported = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const prefix = `# ${key}: `;
    if (!lines[index]?.startsWith(prefix))
      fail(`CSV is missing the ${key} metadata line or has an unsupported layout.`);
    imported[key] = parseJSON(lines[index].slice(prefix.length), `CSV ${key}`);
  }
  if (imported.format !== FORMAT || imported.version !== VERSION)
    fail("Unsupported CSV format or version.");
  const { params, model } = experiment(imported.lab, imported.params);
  const expected = metadata(imported.lab, params, model);
  for (const key of ["units", "assumptions"]) {
    if (JSON.stringify(imported[key]) !== JSON.stringify(expected[key]))
      fail(`CSV ${key} do not match this model version.`);
  }
  const columns = model.columns.map((column) => ({ ...column }));
  if (lines[keys.length] !== columns.map((column) => column.key).join(",")) {
    fail("CSV columns must exactly match the declared experiment, in their original order.");
  }
  const rowLines = lines.slice(keys.length + 1);
  const minimum = model.duration === 0 ? 1 : 2;
  if (rowLines.length < minimum || rowLines.length > CSV_MAX_ROWS)
    fail(`CSV must contain ${minimum} to ${CSV_MAX_ROWS} sample rows.`);
  const timeIndex = columns.findIndex((column) => column.key === "t");
  let previousTime = -Infinity;
  const rows = rowLines.map((line, rowIndex) => {
    const cells = line.split(",");
    if (cells.length !== columns.length)
      fail(`CSV sample ${rowIndex + 1} has the wrong number of columns.`);
    const row = cells.map((cell) => {
      if (!NUMBER_CELL.test(cell))
        fail(`CSV sample ${rowIndex + 1} must contain only finite numeric cells.`);
      const value = Number(cell);
      if (!Number.isFinite(value)) fail(`CSV sample ${rowIndex + 1} contains a non-finite number.`);
      return value;
    });
    const time = validTime(row[timeIndex], model.duration);
    if (time <= previousTime) fail("CSV sample times must be unique and strictly increasing.");
    previousTime = time;
    const expectedRow = numericState(model, time);
    row.forEach((value, columnIndex) => {
      const expectedValue = expectedRow[columnIndex];
      const tolerance = ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(expectedValue);
      if (Math.abs(value - expectedValue) > tolerance) {
        fail(
          `CSV sample ${rowIndex + 1}, ${columns[columnIndex].key}, does not match the declared model. Import model replay samples, not measured data.`,
        );
      }
    });
    return row;
  });
  return { lab: imported.lab, params, columns, rows };
}
