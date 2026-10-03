import test from "node:test";
import assert from "node:assert/strict";
import { createModel, defaults, validateParams, sampleModel } from "./models.js";
const near = (actual, expected, scale = 1) =>
  assert.ok(
    Math.abs(actual - expected) <= 1e-9 * Math.max(scale, Math.abs(expected)),
    `${actual} ≠ ${expected}`,
  );
const model = (lab, p) => createModel(lab, { ...defaults(lab), ...p });

test("projectile hand fixtures, contact root and immediate ground contact", () => {
  const m = model("projectile", {
    speed: 5,
    angle: (Math.atan2(4, 3) * 180) / Math.PI,
    height: 0,
    gravity: 10,
  });
  near(m.duration, 0.8);
  near(m.summary.horizontalDisplacement, 2.4);
  near(m.summary.apex, 0.8);
  near(m.summary.apexTime, 0.4);
  const horizontal = model("projectile", { speed: 2, angle: 0, height: 5, gravity: 10 });
  near(horizontal.duration, 1);
  near(horizontal.stateAt(1).x, 2);
  near(horizontal.stateAt(1).vy, -10);
  const down = model("projectile", { speed: 100, angle: -90, height: 0.001, gravity: 0.1 });
  assert.ok(down.duration > 0);
  near(0.001 - 100 * down.duration - 0.05 * down.duration ** 2, 0);
  for (const angle of [-90, 0]) {
    const resting = model("projectile", { speed: 0, angle, height: 0 });
    assert.equal(resting.duration, 0);
    assert.equal(sampleModel(resting).length, 1);
    assert.equal(resting.stateAt(0).y, 0);
  }
});

test("projectile agrees with acceleration-only velocity Verlet and energy invariance", () => {
  for (const p of [
    { speed: 17, angle: 37, height: 3, gravity: 9.81 },
    { speed: 8, angle: -25, height: 10, gravity: 3.7 },
    { speed: 10, angle: 90, height: 0, gravity: 10 },
  ]) {
    const m = model("projectile", p),
      end = m.duration * 0.83,
      dt = end / 1000;
    let x = 0,
      y = p.height,
      vx = p.speed * Math.cos((p.angle * Math.PI) / 180),
      vy = p.speed * Math.sin((p.angle * Math.PI) / 180);
    for (let i = 0; i < 1000; i++) {
      vy -= (p.gravity * dt) / 2;
      x += vx * dt;
      y += vy * dt;
      vy -= (p.gravity * dt) / 2;
    }
    const state = m.stateAt(end);
    near(state.x, x);
    near(state.y, y);
    near(state.vy, vy);
    for (let i = 0; i <= 20; i++)
      near(
        m.stateAt((m.duration * i) / 20).energySpecific,
        p.speed ** 2 / 2 + p.gravity * p.height,
      );
    assert.equal(m.stateAt(m.duration).y, 0);
  }
});

function rk4(p, end, steps) {
  let x = p.displacement,
    v = p.velocity;
  const dt = end / steps,
    a = (q) => (-p.stiffness / p.mass) * q;
  for (let i = 0; i < steps; i++) {
    const k1x = v,
      k1v = a(x),
      k2x = v + (dt * k1v) / 2,
      k2v = a(x + (dt * k1x) / 2);
    const k3x = v + (dt * k2v) / 2,
      k3v = a(x + (dt * k2x) / 2),
      k4x = v + dt * k3v,
      k4v = a(x + dt * k3x);
    x += (dt * (k1x + 2 * k2x + 2 * k3x + k4x)) / 6;
    v += (dt * (k1v + 2 * k2v + 2 * k3v + k4v)) / 6;
  }
  return { x, v };
}
test("spring hand fixture and zero-energy rest have finite states", () => {
  const m = model("oscillator", { mass: 1, stiffness: 4, displacement: 1, velocity: 0 });
  near(m.stateAt(Math.PI / 4).x, 0);
  near(m.stateAt(Math.PI / 4).v, -2);
  near(m.stateAt(Math.PI / 2).x, -1);
  near(m.stateAt(Math.PI / 2).v, 0);
  near(m.stateAt(0).energy, 2);
  const rest = model("oscillator", { displacement: 0, velocity: 0 });
  for (const s of sampleModel(rest, 12)) {
    near(s.x, 0);
    near(s.v, 0);
    near(s.energy, 0);
  }
});
test("spring RK4 oracle converges and energy, period, and force identities hold", () => {
  for (const p of [
    { mass: 2, stiffness: 7, displacement: -0.4, velocity: 1.2 },
    { mass: 0.1, stiffness: 200, displacement: 2, velocity: -3 },
  ]) {
    const m = model("oscillator", p),
      end = m.summary.period * 0.71,
      exact = m.stateAt(end);
    const coarse = rk4(p, end, 20),
      fine = rk4(p, end, 40);
    const e1 = Math.hypot(coarse.x - exact.x, coarse.v - exact.v),
      e2 = Math.hypot(fine.x - exact.x, fine.v - exact.v);
    assert.ok(e2 < e1 / 10 && e2 < 0.001, `RK4 convergence ${e1} → ${e2}`);
    near(m.stateAt(m.summary.period).x, p.displacement);
    near(m.stateAt(m.summary.period).v, p.velocity);
    for (const s of sampleModel(m, 37)) {
      near(s.energy, m.stateAt(0).energy);
      near(s.force, p.mass * s.a);
      near(s.force, -p.stiffness * s.x);
    }
  }
});
function solve2(a, b, c, d, f, g) {
  const factor = c / a;
  const y = (g - factor * f) / (d - factor * b);
  return [(f - b * y) / a, y];
}
test("collision hand fixtures and contact continuity, including contact at zero", () => {
  for (const e of [0, 1]) {
    const m = model("collision", {
      mass1: 2,
      mass2: 1,
      velocity1: 3,
      velocity2: 0,
      restitution: e,
      gap: 3,
    });
    near(m.eventTime, 1);
    const at = m.stateAt(1),
      before = m.stateAt(1 - 1e-10);
    near(at.v1, e ? 1 : 2);
    near(at.v2, e ? 4 : 2);
    near(at.lostEnergy, e ? 0 : 3);
    near(at.x1, before.x1);
    near(at.x2, before.x2);
    near(at.separation, 0);
    assert.equal(before.v1, 3);
  }
  const immediate = model("collision", { gap: 0 });
  assert.equal(immediate.eventTime, 0);
  near(immediate.stateAt(0).v1, 1);
  near(immediate.stateAt(0).v2, 4);
  const late = model("collision", { gap: 20, velocity1: 0.01, velocity2: 0 });
  assert.ok(late.eventTime > late.duration);
  assert.equal(late.stateAt(late.duration).v1, 0.01);
  for (const [u1, u2] of [
    [0, 0],
    [-2, 2],
    [1, 1],
  ]) {
    const away = model("collision", { velocity1: u1, velocity2: u2 });
    assert.equal(away.eventTime, null);
    assert.equal(away.stateAt(away.duration).v1, u1);
  }
});
test("collision linear-system oracle, momentum, restitution and reduced-mass loss", () => {
  for (const [m1, m2, u1, u2] of [
    [1, 1, 4, -1],
    [0.1, 20, 10, -10],
    [7, 3, -1, -4],
  ]) {
    for (const e of [0, 0.3, 1]) {
      const m = model("collision", {
        mass1: m1,
        mass2: m2,
        velocity1: u1,
        velocity2: u2,
        restitution: e,
        gap: 1,
      });
      const s = m.stateAt(m.eventTime),
        expected = solve2(m1, m2, -1, 1, m1 * u1 + m2 * u2, e * (u1 - u2));
      near(s.v1, expected[0]);
      near(s.v2, expected[1]);
      near(s.momentum, m1 * u1 + m2 * u2);
      near(s.v2 - s.v1, e * (u1 - u2));
      near(s.lostEnergy, ((0.5 * m1 * m2) / (m1 + m2)) * (1 - e * e) * (u1 - u2) ** 2);
      assert.ok(s.kinetic <= m.summary.initialK + 1e-9);
      if (m1 === m2 && e === 1) {
        near(s.v1, u2);
        near(s.v2, u1);
      }
    }
  }
});
test("bounds, plain schema, invalid time and sample counts are rejected", () => {
  for (const lab of ["projectile", "oscillator", "collision"]) {
    for (const value of [NaN, Infinity, "", null]) {
      const p = defaults(lab),
        key = Object.keys(p)[0];
      p[key] = value;
      assert.throws(() => validateParams(lab, p));
    }
    const p = defaults(lab);
    p.extra = 1;
    assert.throws(() => validateParams(lab, p));
    const m = createModel(lab, defaults(lab));
    assert.throws(() => m.stateAt(-1));
    assert.throws(() => m.stateAt(m.duration + 1));
    assert.throws(() => m.stateAt(NaN));
    assert.throws(() => sampleModel(m, 0));
    assert.throws(() => sampleModel(m, 2002));
  }
  assert.throws(() => createModel("__proto__", {}));
  assert.throws(() => model("oscillator", { mass: 0 }));
  assert.throws(() => model("collision", { restitution: 1.1 }));
  assert.throws(() => model("projectile", { height: -1 }));
});

// Very small positive numbers can be entered in native number inputs too.
test("tiny positive inputs do not underflow the flight root or force a distant collision", () => {
  const tiny = model("projectile", { speed: 0, height: Number.MIN_VALUE, gravity: 10 });
  const expected = Math.sqrt(2 / 10) * 2 ** -537;
  assert.ok(tiny.duration > 0);
  near(tiny.duration / expected, 1);
  const distant = model("collision", { velocity1: Number.MIN_VALUE, velocity2: 0, gap: 4 });
  assert.ok(distant.eventTime > distant.duration);
  for (const state of sampleModel(distant, 5)) {
    assert.equal(state.v1, Number.MIN_VALUE);
    assert.ok(Object.values(state).every(Number.isFinite));
  }
});
