import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepModel, exportSweep } from "./sweep.js";
import { defaults } from "./models.js";
test("ground-level launch sweep peaks at 45 degrees for ideal projectile", () => {
  const s = sweepModel(
    "projectile",
    { ...defaults("projectile"), height: 0, speed: 10, gravity: 10 },
    "angle",
    0,
    90,
    91,
  );
  assert.ok(Math.abs(s.rows[45].y - 10) < 1e-12);
  assert.equal(s.rows.reduce((a, b) => (a.y > b.y ? a : b)).x, 45);
  assert.match(exportSweep(s), /parameter_value,result/);
});
test("oscillator period follows square root of mass", () => {
  const s = sweepModel(
    "oscillator",
    { ...defaults("oscillator"), stiffness: 4 },
    "mass",
    1,
    4,
    2,
  );
  assert.ok(Math.abs(s.rows[1].y / s.rows[0].y - 2) < 1e-12);
});
test("collision sweep computes contact energy even beyond viewing window", () => {
  const s = sweepModel(
    "collision",
    {
      mass1: 2,
      mass2: 2,
      velocity1: 0.1,
      velocity2: 0,
      gap: 20,
      restitution: 1,
    },
    "restitution",
    0,
    1,
    2,
  );
  assert.ok(Math.abs(s.rows[0].y - 0.005) < 1e-12);
  assert.equal(s.rows[1].y, 0);
});
test("sweeps reject non-finite, reversed, unknown and unbounded requests", () => {
  for (const args of [
    ["projectile", defaults("projectile"), "angle", 10, 0],
    ["projectile", defaults("projectile"), "angle", 0, 100],
    ["projectile", defaults("projectile"), "angle", NaN, 50],
    ["projectile", defaults("projectile"), "x", 0, 1],
  ])
    assert.throws(() => sweepModel(...args));
  assert.throws(() =>
    sweepModel("projectile", defaults("projectile"), "angle", 0, 90, 10000),
  );
});
