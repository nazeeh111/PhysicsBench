import test from "node:test";
import assert from "node:assert/strict";
import {
  fitPolynomial,
  parseMeasurementCSV,
  measurementsCSV,
  projectileDemo,
  predictFit,
  validatePoints,
} from "./analysis.js";
const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

test("linear fit agrees with hand-computed slope, intercept and residual variance", () => {
  const fit = fitPolynomial(
    [1, 2, 2, 4].map((y, t) => ({ t, y })),
    1,
  );
  close(fit.coefficients[0], 0.9);
  close(fit.coefficients[1], 0.9);
  close(fit.rmse, Math.sqrt(0.7 / 4));
  close(fit.residualStd, Math.sqrt(0.7 / 2));
  close(fit.standardErrors[1], Math.sqrt(0.35 / 5));
  close(fit.standardErrors[0], Math.sqrt(0.35 * 0.7));
  close(fit.ci95[1][1], 0.9 + 4.30265 * Math.sqrt(0.35 / 5));
  close(fit.r2, 1 - 0.7 / 4.75);
});

test("quadratic fit and coefficient uncertainty agree with an independent orthogonal residual fixture", () => {
  const fit = fitPolynomial(
    [8, 4, 1, 4, 18].map((y, i) => ({ t: i - 2, y })),
    2,
  );
  fit.coefficients.forEach((value, i) => close(value, [1, 2, 3][i]));
  close(fit.rmse, Math.sqrt(2));
  close(fit.residualStd, Math.sqrt(5));
  close(fit.standardErrors[0], Math.sqrt(17 / 7));
  close(fit.standardErrors[1], Math.sqrt(0.5));
  close(fit.standardErrors[2], Math.sqrt(5 / 14));
  close(fit.ci95[2][0], 3 - 4.30265 * Math.sqrt(5 / 14));
  fit.observations.forEach((point, i) =>
    close(point.residual, [-1, 2, 0, -2, 1][i]),
  );
});

test("exact free flight recovers physical acceleration and preserves precision for shifted clocks", () => {
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = i * 0.04;
    return { t, y: 2 + 8 * t - 4.905 * t * t };
  });
  const fit = fitPolynomial(points, 2);
  close(-2 * fit.coefficients[2], 9.81);
  close(fit.r2, 1);
  assert.ok(fit.rmse < 1e-12);
  const shifted = points.map(({ t, y }) => ({ t: t + 1e9, y }));
  const later = fitPolynomial(shifted, 2);
  shifted.forEach((point) => close(predictFit(later, point.t), point.y, 1e-6));
});

test("deterministic noisy demo identifies gravity and penalizes a linear explanation", () => {
  const demo = projectileDemo();
  assert.deepEqual(demo, projectileDemo());
  const quadratic = fitPolynomial(demo, 2),
    linear = fitPolynomial(demo, 1);
  close(-2 * quadratic.coefficients[2], 9.81, 0.1);
  assert.ok(quadratic.rmse < 0.02);
  assert.ok(linear.rmse > quadratic.rmse * 10);
  assert.ok(quadratic.ci95[2][0] < -4.905 && quadratic.ci95[2][1] > -4.905);
});

test("constant observations remain finite; no coefficient intervals without residual freedom", () => {
  const fit = fitPolynomial(
    Array.from({ length: 8 }, (_, t) => ({ t, y: 4 })),
    2,
  );
  close(fit.r2, 1);
  close(fit.coefficients[0], 4);
  assert.ok(fit.standardErrors.every(Number.isFinite));
  assert.throws(
    () =>
      fitPolynomial(
        [
          { t: 0, y: 0 },
          { t: 1, y: 1 },
          { t: 2, y: 4 },
        ],
        2,
      ),
    /at least 4/,
  );
  assert.throws(
    () =>
      fitPolynomial(
        [
          { t: 0, y: 0 },
          { t: 1, y: 1 },
        ],
        1,
      ),
    /at least 3/,
  );
});

test("strict CSV round trips observations including scientific notation and BOM", () => {
  const points = parseMeasurementCSV(
    "\uFEFFtime_s,value\r\n0,1e-3\r\n.5,-2\r\n1.,+3.5\r\n",
  );
  assert.deepEqual(points, [
    { t: 0, y: 0.001 },
    { t: 0.5, y: -2 },
    { t: 1, y: 3.5 },
  ]);
  assert.deepEqual(parseMeasurementCSV(measurementsCSV(points)), points);
});

test("CSV rejects malformed, formula-like, extra, nonfinite and unordered data", () => {
  for (const csv of [
    "",
    "0,1",
    "0,1\n0,2",
    "1,1\n0,2",
    "0,1,2\n1,2,3",
    "0,NaN\n1,2",
    "0,Infinity\n1,2",
    "0,1e999\n1,2",
    "0,0x10\n1,2",
    "0,=1+2\n1,2",
    "0,1\n\n1,2",
    'time,value\n0,"1"\n1,2',
    "time,x\n0,1\n1,2",
    "0,1\n1,2e13",
  ])
    assert.throws(() => parseMeasurementCSV(csv), undefined, csv);
  assert.throws(
    () => parseMeasurementCSV(" ".repeat(1024 * 1024 + 1)),
    /1 MiB/,
  );
  assert.throws(
    () =>
      parseMeasurementCSV(
        Array.from({ length: 10001 }, (_, i) => `${i},1`).join("\n"),
      ),
    /10?000|10000/,
  );
});

test("validation does not mutate data and rejects repeated or unresolvable time geometry", () => {
  const original = [
    { t: 0, y: 1 },
    { t: 1, y: 2 },
    { t: 2, y: 3 },
    { t: 3, y: 4 },
  ];
  const snapshot = structuredClone(original);
  fitPolynomial(original, 1);
  assert.deepEqual(original, snapshot);
  assert.throws(
    () =>
      validatePoints([
        { t: 0, y: 1 },
        { t: 0, y: 2 },
      ]),
    /increasing/,
  );
  assert.throws(() => fitPolynomial(original, 3), /linear or quadratic/);
  assert.throws(
    () =>
      fitPolynomial(
        [
          { t: 0, y: 0 },
          { t: 1e-14, y: 1 },
          { t: 2e-14, y: 2 },
          { t: 1, y: 3 },
        ],
        2,
      ),
    /cannot resolve/,
  );
});
