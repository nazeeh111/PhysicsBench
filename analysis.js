// Ordinary least squares with centered/scaled time and QR decomposition.
// Confidence intervals assume independent, identically distributed normal errors
// in value; time and calibration are treated as exact.
export const MAX_ROWS = 10000;
export const MAX_CSV_BYTES = 1024 * 1024;

export function validatePoints(points) {
  if (!Array.isArray(points) || points.length > MAX_ROWS || points.length < 2)
    throw new Error(`Use 2–${MAX_ROWS} observations.`);
  let previous = -Infinity;
  return points.map(({ t, y }, index) => {
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(y) ||
      Math.abs(t) > 1e12 ||
      Math.abs(y) > 1e12
    )
      throw new Error(
        `Observation ${index + 1} must contain finite numbers with magnitude at most 10¹².`,
      );
    if (t <= previous)
      throw new Error("Observation times must be strictly increasing.");
    previous = t;
    return { t, y };
  });
}

export function parseMeasurementCSV(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_CSV_BYTES
  )
    throw new Error("CSV must be at most 1 MiB.");
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  if (
    /^\s*(?:time|time_s|t)\s*,\s*(?:value|y|position|position_m|position_px)\s*$/i.test(
      lines[0],
    )
  )
    lines.shift();
  if (lines.length > MAX_ROWS)
    throw new Error(`CSV must contain at most ${MAX_ROWS} observations.`);
  const points = lines.map((line, index) => {
    const columns = line.split(",").map((value) => value.trim());
    if (columns.length !== 2 || !columns.every((value) => numeric.test(value)))
      throw new Error(
        `CSV data row ${index + 1}: expected exactly two numeric columns, time in seconds and value.`,
      );
    return { t: Number(columns[0]), y: Number(columns[1]) };
  });
  return validatePoints(points);
}

const T95 = [
  0, 12.7062, 4.30265, 3.18245, 2.77645, 2.57058, 2.44691, 2.36462, 2.306,
  2.26216, 2.22814, 2.20099, 2.17881, 2.16037, 2.14479, 2.13145, 2.11991,
  2.10982, 2.10092, 2.09302, 2.08596, 2.07961, 2.07387, 2.06866, 2.0639,
  2.05954, 2.05553, 2.05183, 2.04841, 2.04523, 2.04227,
];
function critical95(df) {
  if (df <= 30) return T95[df];
  const z = 1.959963984540054;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
  );
}

export function fitPolynomial(input, degree = 2) {
  const points = validatePoints(input);
  if (![1, 2].includes(degree))
    throw new Error("Choose a linear or quadratic model.");
  const p = degree + 1,
    n = points.length;
  if (n <= p)
    throw new Error(
      `A ${degree === 1 ? "linear" : "quadratic"} fit needs at least ${p + 1} observations to estimate uncertainty.`,
    );
  const origin = points[0].t + (points[n - 1].t - points[0].t) / 2;
  const scale = (points[n - 1].t - points[0].t) / 2;
  const x = points.map((point) => (point.t - origin) / scale);
  const q = [],
    r = Array.from({ length: p }, () => Array(p).fill(0));
  for (let j = 0; j < p; j++) {
    const column = x.map((value) => value ** j);
    // A second orthogonalization pass reduces numerical loss for clustered data.
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < j; k++) {
        const projection = column.reduce(
          (sum, value, i) => sum + value * q[k][i],
          0,
        );
        r[k][j] += projection;
        for (let i = 0; i < n; i++) column[i] -= projection * q[k][i];
      }
    }
    r[j][j] = Math.hypot(...column);
    if (r[j][j] < 1e-10 * Math.sqrt(n))
      throw new Error(
        "These time samples cannot resolve the selected model. Spread observations across the time range.",
      );
    q[j] = column.map((value) => value / r[j][j]);
  }
  const solve = (rhs) => {
    const answer = Array(p).fill(0);
    for (let i = p - 1; i >= 0; i--) {
      let remaining = rhs[i];
      for (let j = i + 1; j < p; j++) remaining -= r[i][j] * answer[j];
      answer[i] = remaining / r[i][i];
    }
    return answer;
  };
  const beta = solve(
    q.map((column) =>
      column.reduce((sum, value, i) => sum + value * points[i].y, 0),
    ),
  );
  const inverse = Array.from({ length: p }, (_, i) =>
    solve(Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))),
  );
  const transform =
    degree === 1
      ? [
          [1, -origin / scale],
          [0, 1 / scale],
        ]
      : [
          [1, -origin / scale, origin ** 2 / scale ** 2],
          [0, 1 / scale, (-2 * origin) / scale ** 2],
          [0, 0, 1 / scale ** 2],
        ];
  const coefficients = transform.map((row) =>
    row.reduce((sum, value, i) => sum + value * beta[i], 0),
  );
  const observations = points.map((point, i) => {
    const fitted = beta.reduce((sum, value, j) => sum + value * x[i] ** j, 0);
    return { ...point, fitted, residual: point.y - fitted };
  });
  const sse = observations.reduce((sum, point) => sum + point.residual ** 2, 0);
  const mean = points.reduce((sum, point) => sum + point.y / n, 0);
  const total = points.reduce((sum, point) => sum + (point.y - mean) ** 2, 0);
  const df = n - p,
    variance = sse / df;
  const standardErrors = transform.map((row) =>
    Math.sqrt(
      variance *
        inverse.reduce(
          (sum, column) =>
            sum +
            row.reduce((dot, value, i) => dot + value * column[i], 0) ** 2,
          0,
        ),
    ),
  );
  const ci95 = coefficients.map((value, i) => [
    value - critical95(df) * standardErrors[i],
    value + critical95(df) * standardErrors[i],
  ]);
  const result = {
    degree,
    n,
    df,
    coefficients,
    standardErrors,
    ci95,
    rmse: Math.sqrt(sse / n),
    residualStd: Math.sqrt(variance),
    r2: total === 0 ? (sse < 1e-20 ? 1 : 0) : 1 - sse / total,
    observations,
    normalized: { origin, scale, coefficients: beta },
  };
  if (
    ![...coefficients, ...standardErrors, result.rmse, result.r2].every(
      Number.isFinite,
    )
  )
    throw new Error(
      "Fit exceeds the supported numeric range. Rescale the observations.",
    );
  return result;
}

export function predictFit(fit, t) {
  const x = (t - fit.normalized.origin) / fit.normalized.scale;
  return fit.normalized.coefficients.reduce(
    (sum, value, i) => sum + value * x ** i,
    0,
  );
}

export function projectileDemo() {
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 20;
    return {
      t,
      y:
        0.4 +
        6.7 * t -
        4.905 * t * t +
        0.012 * Math.sin(i * 2.3) +
        0.007 * Math.cos(i * 0.9),
    };
  });
}

export function measurementsCSV(points) {
  validatePoints(points);
  return (
    "time_s,value\n" + points.map(({ t, y }) => `${t},${y}`).join("\n") + "\n"
  );
}
