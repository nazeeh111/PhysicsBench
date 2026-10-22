// Bounded, deterministic normalized cross-correlation (NCC). No browser APIs.
// The score measures pixel-pattern agreement, not a probability of correctness.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function grayscale(image) {
  if (
    !image ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > 8_400_000 ||
    !image.data ||
    image.data.length !== image.width * image.height * 4
  )
    throw new Error("Use a valid RGBA frame of at most 8.4 million pixels.");
  const pixels = new Float32Array(image.width * image.height);
  for (let i = 0; i < pixels.length; i++) {
    const j = i * 4;
    pixels[i] =
      0.2126 * image.data[j] +
      0.7152 * image.data[j + 1] +
      0.0722 * image.data[j + 2];
  }
  return { width: image.width, height: image.height, pixels };
}

function validFrame(frame) {
  if (
    !frame ||
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.width * frame.height > 8_400_000 ||
    !frame.pixels ||
    frame.pixels.length !== frame.width * frame.height
  )
    throw new Error("A grayscale frame is required.");
}

export function makeTemplate(frame, x, y, size = 31) {
  validFrame(frame);
  if (
    ![x, y].every(Number.isFinite) ||
    !Number.isInteger(size) ||
    size < 7 ||
    size > 61 ||
    size % 2 !== 1
  )
    throw new Error(
      "Choose a finite point and an odd template width of 7–61 pixels.",
    );
  const half = (size - 1) / 2;
  const cx = Math.round(x),
    cy = Math.round(y);
  if (
    cx - half < 0 ||
    cy - half < 0 ||
    cx + half >= frame.width ||
    cy + half >= frame.height
  )
    throw new Error("The target is too near the frame edge for this template.");
  const values = new Float32Array(size * size);
  let mean = 0;
  for (let py = -half, i = 0; py <= half; py++)
    for (let px = -half; px <= half; px++, i++) {
      values[i] = frame.pixels[(cy + py) * frame.width + cx + px];
      mean += values[i] / values.length;
    }
  let energy = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    energy += values[i] ** 2;
  }
  if (energy / values.length < 4)
    throw new Error(
      "This patch has too little texture. Select a detailed target.",
    );
  return { size, values, energy, anchor: { x: cx, y: cy } };
}

export function matchTemplate(frame, template, previous, options = {}) {
  validFrame(frame);
  const radius = options.radius ?? 60;
  const threshold = options.threshold ?? 0.78;
  const ambiguityThreshold = options.ambiguityThreshold ?? 0.08;
  if (
    !template ||
    !Number.isInteger(template.size) ||
    template.size < 7 ||
    template.size > 61 ||
    template.size % 2 !== 1 ||
    template.values?.length !== template.size ** 2 ||
    !Number.isFinite(template.energy) ||
    template.energy <= 0 ||
    ![previous?.x, previous?.y, radius, threshold, ambiguityThreshold].every(
      Number.isFinite,
    ) ||
    radius < 1 ||
    radius > 120 ||
    threshold < 0 ||
    threshold > 1 ||
    ambiguityThreshold < 0 ||
    ambiguityThreshold > 1
  )
    throw new Error(
      "Invalid template, search position or bounded search settings.",
    );
  const size = template.size,
    half = (size - 1) / 2;
  const left = Math.max(half, Math.ceil(previous.x - radius));
  const right = Math.min(
    frame.width - half - 1,
    Math.floor(previous.x + radius),
  );
  const top = Math.max(half, Math.ceil(previous.y - radius));
  const bottom = Math.min(
    frame.height - half - 1,
    Math.floor(previous.y + radius),
  );
  if (left > right || top > bottom)
    return {
      accepted: false,
      reason: "Search area is outside the usable frame.",
      confidence: 0,
      ambiguity: 0,
      candidate: null,
    };
  const scores = [];
  function scoreAt(x, y) {
    let sum = 0,
      sumSq = 0,
      dot = 0;
    for (let py = 0, i = 0; py < size; py++) {
      const start = (y - half + py) * frame.width + x - half;
      for (let px = 0; px < size; px++, i++) {
        const value = frame.pixels[start + px];
        sum += value;
        sumSq += value * value;
        dot += value * template.values[i];
      }
    }
    const energy = sumSq - (sum * sum) / (size * size);
    return energy > 1e-8
      ? clamp(dot / Math.sqrt(energy * template.energy), -1, 1)
      : -1;
  }
  // Exhaustive integer-pixel search avoids skipping a narrow textured match.
  // Work is bounded by radius ≤120 and template width ≤61.
  let best = { x: left, y: top, score: -Infinity };
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const score = scoreAt(x, y);
      scores.push({ x, y, score });
      if (score > best.score) best = { x, y, score };
    }
  // Compare distinct targets rather than neighboring pixels of the same target.
  const exclusion = Math.max(5, size * 0.7);
  let second = -1;
  for (const item of scores)
    if (Math.hypot(item.x - best.x, item.y - best.y) >= exclusion)
      second = Math.max(second, item.score);
  const confidence = clamp(best.score, -1, 1);
  const ambiguity = clamp(confidence - second, 0, 2);
  const accepted = confidence >= threshold && ambiguity >= ambiguityThreshold;
  return {
    accepted,
    confidence,
    ambiguity,
    candidate: { x: best.x, y: best.y },
    reason:
      confidence < threshold
        ? "Pattern agreement is below the threshold."
        : ambiguity < ambiguityThreshold
          ? "Two separated targets have similar scores."
          : "Target matched.",
  };
}

// Worst-case acceleration change for independent bounded ±pixel position edits.
// This is a sensitivity bound with exact time, not a confidence interval.
export function accelerationSensitivity(times, metersPerPixel, pixelBound = 1) {
  if (
    !Array.isArray(times) ||
    times.length < 4 ||
    times.length > 2000 ||
    !times.every(Number.isFinite) ||
    !Number.isFinite(metersPerPixel) ||
    metersPerPixel <= 0 ||
    !Number.isFinite(pixelBound) ||
    pixelBound < 0
  )
    throw new Error(
      "Sensitivity requires 4–2,000 finite times and a positive scale.",
    );
  const origin = times.reduce((sum, t) => sum + t / times.length, 0);
  const span = Math.max(...times) - Math.min(...times);
  if (span <= 0) throw new Error("Observation times must span an interval.");
  const u = times.map((t) => (t - origin) / span);
  const matrix = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 6 }, (_, col) =>
      col < 3
        ? u.reduce((sum, t) => sum + t ** (row + col), 0)
        : Number(col - 3 === row),
    ),
  );
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++)
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col]))
        pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    if (Math.abs(divisor) < 1e-12)
      throw new Error("Times cannot resolve acceleration.");
    matrix[col] = matrix[col].map((value) => value / divisor);
    for (let row = 0; row < 3; row++)
      if (row !== col) {
        const factor = matrix[row][col];
        matrix[row] = matrix[row].map(
          (value, i) => value - factor * matrix[col][i],
        );
      }
  }
  const weights = u.map(
    (t) =>
      (2 * (matrix[2][3] + matrix[2][4] * t + matrix[2][5] * t * t)) /
      span ** 2,
  );
  return {
    bound:
      weights.reduce((sum, w) => sum + Math.abs(w), 0) *
      metersPerPixel *
      pixelBound,
    weights,
  };
}
