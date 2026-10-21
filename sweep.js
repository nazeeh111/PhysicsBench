import { LABS, createModel } from "./models.js";
export function sweepModel(lab, params, key, min, max, count = 41) {
  const p = LABS[lab]?.parameters.find((p) => p.key === key);
  if (!p) throw new Error("Choose a valid model parameter.");
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < p.min ||
    max > p.max ||
    min >= max
  )
    throw new Error(
      `Sweep bounds must increase within ${p.min} to ${p.max} ${p.unit}.`,
    );
  if (!Number.isInteger(count) || count < 2 || count > 201)
    throw new Error("Use 2–201 sweep samples.");
  const metric =
    lab === "projectile"
      ? { label: "Horizontal range", unit: "m" }
      : lab === "oscillator"
        ? { label: "Period", unit: "s" }
        : { label: "Kinetic energy lost at contact", unit: "J" };
  const rows = Array.from({ length: count }, (_, i) => {
    const value = min + (max - min) * (i / (count - 1));
    const m = createModel(lab, { ...params, [key]: value });
    const result =
      lab === "projectile"
        ? m.summary.horizontalDisplacement
        : lab === "oscillator"
          ? m.summary.period
          : m.eventTime === null
            ? 0
            : m.stateAt(Math.min(m.eventTime, m.duration)).lostEnergy;
    // Collision energy loss is defined at contact even if contact lies beyond the display window.
    const y =
      lab === "collision" && m.eventTime !== null
        ? 0.5 *
          ((m.params.mass1 * m.params.mass2) /
            (m.params.mass1 + m.params.mass2)) *
          (1 - m.params.restitution ** 2) *
          (m.params.velocity1 - m.params.velocity2) ** 2
        : result;
    if (!Number.isFinite(y))
      throw new Error("These conditions produce a non-finite sweep result.");
    return { x: value, y };
  });
  return {
    lab,
    parameter: key,
    parameterLabel: p.label,
    parameterUnit: p.unit,
    metric,
    params: { ...params },
    rows,
  };
}
export function exportSweep(sweep) {
  return (
    [
      "# PhysicsBench parameter sweep v1",
      `# lab=${sweep.lab}`,
      `# fixed_parameters=${JSON.stringify(sweep.params)}`,
      `# varied_parameter=${sweep.parameter}`,
      `# output=${sweep.metric.label} (${sweep.metric.unit})`,
      `parameter_value,result`,
      ...sweep.rows.map((r) => `${r.x},${r.y}`),
    ].join("\n") + "\n"
  );
}
