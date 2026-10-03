/* PhysicsBench: original analytical models. SI units throughout. */
const parameter = (key, label, unit, min, max, step, initial) => ({
  key,
  label,
  unit,
  min,
  max,
  step,
  default: initial,
});
const column = (key, label, unit) => ({ key, label, unit });
export const LABS = {
  projectile: {
    name: "Projectile",
    subtitle: "Position under uniform gravity",
    parameters: [
      parameter("speed", "Launch speed", "m/s", 0, 100, 0.1, 15),
      parameter("angle", "Launch angle", "°", -90, 90, 1, 45),
      parameter("height", "Initial height", "m", 0, 100, 0.1, 1.5),
      parameter("gravity", "Gravity", "m/s²", 0.1, 30, 0.01, 9.81),
    ],
    equations: ["x = v₀ cos(θ) t", "y = h + v₀ sin(θ) t − ½gt²", "vᵧ = v₀ sin(θ) − gt"],
    assumptions: [
      "Point projectile; uniform gravity and flat ground.",
      "No drag, wind or bounce. The motion stops at first ground contact.",
      "Terminal velocity and energy describe the instant before impact.",
    ],
    source: [
      "Projectile motion",
      "https://openstax.org/books/university-physics-volume-1/pages/4-3-projectile-motion",
    ],
    plot: { key: "y", label: "Height", unit: "m" },
  },
  oscillator: {
    name: "Mass–spring",
    subtitle: "Undamped horizontal motion",
    parameters: [
      parameter("mass", "Mass", "kg", 0.1, 20, 0.1, 1),
      parameter("stiffness", "Spring constant", "N/m", 0.1, 200, 0.1, 4),
      parameter("displacement", "Initial displacement", "m", -5, 5, 0.05, 1),
      parameter("velocity", "Initial velocity", "m/s", -10, 10, 0.1, 0),
    ],
    equations: [
      "ω = √(k/m),  T = 2π/ω",
      "x = x₀ cos(ωt) + (v₀/ω) sin(ωt)",
      "F = −kx,  E = ½mv² + ½kx²",
    ],
    assumptions: [
      "Linear, massless spring; frictionless horizontal motion.",
      "No damping or drive. Four periods are shown.",
      "Block size and spring shape are illustrative, not to physical scale.",
    ],
    source: [
      "Simple harmonic motion",
      "https://openstax.org/books/university-physics-volume-1/pages/15-1-simple-harmonic-motion",
    ],
    plot: { key: "x", label: "Displacement", unit: "m" },
  },
  collision: {
    name: "Collision",
    subtitle: "One-dimensional restitution",
    parameters: [
      parameter("mass1", "Mass 1", "kg", 0.1, 20, 0.1, 2),
      parameter("mass2", "Mass 2", "kg", 0.1, 20, 0.1, 1),
      parameter("velocity1", "Incoming velocity 1", "m/s", -10, 10, 0.1, 3),
      parameter("velocity2", "Incoming velocity 2", "m/s", -10, 10, 0.1, 0),
      parameter("restitution", "Restitution", "0–1", 0, 1, 0.05, 1),
      parameter("gap", "Initial surface gap", "m", 0, 20, 0.1, 4),
    ],
    equations: [
      "m₁u₁ + m₂u₂ = m₁v₁ + m₂v₂",
      "v₂ − v₁ = e(u₁ − u₂)",
      "ΔK = ½ [m₁m₂/(m₁+m₂)] (1−e²)(u₁−u₂)²",
    ],
    assumptions: [
      "Isolated frictionless 1D motion; one instantaneous contact.",
      "Each body is 1 m wide for the contact convention; mass does not set width.",
      "No walls, rotation or deformation model. Restitution is prescribed, not measured.",
      "At contact time, outgoing velocities apply. The viewing window is at most 20 s.",
    ],
    source: [
      "Elastic and inelastic collisions",
      "https://openstax.org/books/college-physics-2e/pages/8-5-inelastic-collisions-in-one-dimension",
    ],
    plot: { key: "v1", label: "Body 1 velocity", unit: "m/s" },
  },
};
export function defaults(lab) {
  if (!Object.hasOwn(LABS, lab)) throw new Error("Unknown experiment.");
  return Object.fromEntries(LABS[lab].parameters.map((p) => [p.key, p.default]));
}
export function validateParams(lab, values) {
  if (!Object.hasOwn(LABS, lab)) throw new Error("Unknown experiment.");
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.getPrototypeOf(values) !== Object.prototype
  )
    throw new Error("Parameters must be a plain object.");
  const definitions = LABS[lab].parameters;
  if (
    Object.keys(values).length !== definitions.length ||
    Object.keys(values).some((key) => !definitions.some((p) => p.key === key))
  )
    throw new Error("Parameter names do not match the experiment.");
  return Object.fromEntries(
    definitions.map((p) => {
      const value = values[p.key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < p.min || value > p.max)
        throw new Error(`${p.label} must be a finite number from ${p.min} to ${p.max} ${p.unit}.`);
      return [p.key, value];
    }),
  );
}
function checkedTime(t, duration) {
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > duration)
    throw new Error("Time must be inside the viewing interval.");
  return t;
}
function projectile(p) {
  const theta = (p.angle * Math.PI) / 180;
  const vx = p.speed * Math.cos(theta),
    vy0 = p.speed * Math.sin(theta),
    g = p.gravity;
  const root = Math.hypot(vy0, Math.sqrt(2 * g) * Math.sqrt(p.height));
  const duration = vy0 >= 0 ? (vy0 + root) / g : (2 * p.height) / (root - vy0);
  const stateAt = (time) => {
    const t = checkedTime(time, duration),
      vy = vy0 - g * t;
    const y = t === duration ? 0 : Math.max(0, p.height + vy0 * t - (g * t * t) / 2);
    return {
      t,
      x: vx * t,
      y,
      vx,
      vy,
      speed: Math.hypot(vx, vy),
      energySpecific: (vx * vx + vy * vy) / 2 + g * y,
    };
  };
  const apexTime = Math.max(0, Math.min(duration, vy0 / g));
  return {
    duration,
    stateAt,
    eventTime: duration,
    summary: {
      flightTime: duration,
      horizontalDisplacement: vx * duration,
      apex: stateAt(apexTime).y,
      apexTime,
    },
    columns: [
      column("t", "Time", "s"),
      column("x", "Horizontal position", "m"),
      column("y", "Height", "m"),
      column("vx", "Horizontal velocity", "m/s"),
      column("vy", "Vertical velocity", "m/s"),
      column("speed", "Speed", "m/s"),
      column("energySpecific", "Specific mechanical energy", "J/kg"),
    ],
  };
}
function oscillator(p) {
  const omega = Math.sqrt(p.stiffness / p.mass),
    period = (2 * Math.PI) / omega;
  const amplitude = Math.hypot(p.displacement, p.velocity / omega),
    duration = 4 * period;
  const stateAt = (time) => {
    const t = checkedTime(time, duration),
      c = Math.cos(omega * t),
      s = Math.sin(omega * t);
    const x = p.displacement * c + (p.velocity / omega) * s;
    const v = -p.displacement * omega * s + p.velocity * c;
    const force = -p.stiffness * x,
      kinetic = (p.mass * v * v) / 2,
      potential = (p.stiffness * x * x) / 2;
    return { t, x, v, a: force / p.mass, force, kinetic, potential, energy: kinetic + potential };
  };
  return {
    duration,
    stateAt,
    eventTime: null,
    summary: { period, amplitude, omega },
    columns: [
      column("t", "Time", "s"),
      column("x", "Displacement", "m"),
      column("v", "Velocity", "m/s"),
      column("a", "Acceleration", "m/s²"),
      column("force", "Restoring force", "N"),
      column("kinetic", "Kinetic energy", "J"),
      column("potential", "Spring energy", "J"),
      column("energy", "Total energy", "J"),
    ],
  };
}
function collision(p) {
  const m = p.mass1 + p.mass2,
    approach = p.velocity1 - p.velocity2;
  const eventTime = approach > 0 ? p.gap / approach : null;
  const momentum = p.mass1 * p.velocity1 + p.mass2 * p.velocity2;
  const after1 = (momentum - p.mass2 * p.restitution * approach) / m;
  const after2 = (momentum + p.mass1 * p.restitution * approach) / m;
  const initialK = (p.mass1 * p.velocity1 ** 2 + p.mass2 * p.velocity2 ** 2) / 2;
  const duration = eventTime === null ? 8 : Math.min(20, Math.max(4, eventTime * 2));
  const initialX2 = p.gap + 1;
  const stateAt = (time) => {
    const t = checkedTime(time, duration),
      contacted = eventTime !== null && t >= eventTime;
    const v1 = contacted ? after1 : p.velocity1,
      v2 = contacted ? after2 : p.velocity2;
    const x1 = contacted ? p.velocity1 * eventTime + v1 * (t - eventTime) : p.velocity1 * t;
    const x2 = contacted
      ? initialX2 + p.velocity2 * eventTime + v2 * (t - eventTime)
      : initialX2 + p.velocity2 * t;
    const kinetic = (p.mass1 * v1 * v1 + p.mass2 * v2 * v2) / 2;
    return {
      t,
      x1,
      x2,
      v1,
      v2,
      momentum: p.mass1 * v1 + p.mass2 * v2,
      kinetic,
      lostEnergy: initialK - kinetic,
      separation: Math.max(0, x2 - x1 - 1),
    };
  };
  return {
    duration,
    stateAt,
    eventTime,
    summary: {
      eventTime,
      after1: eventTime === null ? null : after1,
      after2: eventTime === null ? null : after2,
      initialK,
      initialMomentum: momentum,
    },
    columns: [
      column("t", "Time", "s"),
      column("x1", "Body 1 centre", "m"),
      column("x2", "Body 2 centre", "m"),
      column("v1", "Body 1 velocity", "m/s"),
      column("v2", "Body 2 velocity", "m/s"),
      column("momentum", "Momentum", "kg m/s"),
      column("kinetic", "Kinetic energy", "J"),
      column("lostEnergy", "Kinetic energy lost", "J"),
      column("separation", "Surface gap", "m"),
    ],
  };
}
export function createModel(lab, values) {
  const params = validateParams(lab, values);
  const model = { projectile, oscillator, collision }[lab](params);
  return { ...model, lab, params, assumptions: [...LABS[lab].assumptions] };
}
export function sampleModel(model, count = 201) {
  if (!Number.isInteger(count) || count < 2 || count > 2001)
    throw new Error("Sample count must be 2–2001.");
  if (model.duration === 0) return [model.stateAt(0)];
  const times = Array.from({ length: count }, (_, i) => model.duration * (i / (count - 1)));
  // Include both sides of the discontinuous collision event without approximating its time.
  if (
    model.lab === "collision" &&
    model.eventTime !== null &&
    model.eventTime > 0 &&
    model.eventTime < model.duration
  ) {
    const before = Math.max(0, model.eventTime - Math.max(1e-9, model.duration * 1e-9));
    times.push(before, model.eventTime);
  }
  return [...new Set(times)].sort((a, b) => a - b).map(model.stateAt);
}
