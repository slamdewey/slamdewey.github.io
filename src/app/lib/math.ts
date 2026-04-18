const TWO_PI = Math.PI * 2;

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

export function unclampedLerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function inverseLerp(from: number, to: number, value: number): number {
  if (from < to) {
    if (value < from) return 0;
    if (value > to) return 1;
  } else {
    if (value < to) return 1;
    if (value > from) return 0;
  }
  return (value - from) / (to - from);
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function map(value: number, leftMin: number, leftMax: number, rightMin: number, rightMax: number): number {
  return rightMin + ((value - leftMin) * (rightMax - rightMin)) / (leftMax - leftMin);
}

export function mapToSignedRange(value: number): number {
  return map(value, 0, 1, -1, 1);
}

export function mapToUnsignedRange(value: number): number {
  return map(value, -1, 1, 0, 1);
}

/** Positive modulo (always returns >= 0) */
export function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

export function sign(a: number): number {
  return a < 0 ? -1 : 1;
}

/**
 * Cylindrical wrapping: normalized sin component. Returns [-1, 1].
 * Together with cylindricalCx, maps x onto a unit circle so the
 * noise tiles seamlessly at x=0 and x=width.
 */
export function cylindricalSx(x: number, width: number): number {
  return Math.sin((x * TWO_PI) / width);
}

/** Cylindrical wrapping: normalized cos component. Returns [-1, 1]. */
export function cylindricalCx(x: number, width: number): number {
  return Math.cos((x * TWO_PI) / width);
}

export function vec2Normalize(x: number, y: number): [number, number] {
  const len = Math.sqrt(x * x + y * y);
  if (len === 0) return [0, 0];
  return [x / len, y / len];
}

export function vec2Lerp(ax: number, ay: number, bx: number, by: number, t: number): [number, number] {
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}
