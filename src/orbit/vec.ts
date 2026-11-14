export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

/** Radial / transverse / normal unit vectors of an orbit state. */
export function rtnBasis(r: Vec3, v: Vec3): [Vec3, Vec3, Vec3] {
  const R = unit(r);
  const N = unit(cross(r, v));
  const T = cross(N, R);
  return [R, T, N];
}

/** Express vector x in the RTN frame of (r, v). */
export function toRtn(x: Vec3, r: Vec3, v: Vec3): Vec3 {
  const [R, T, N] = rtnBasis(r, v);
  return [dot(x, R), dot(x, T), dot(x, N)];
}

/** Rotate a vector given in RTN components back to inertial. */
export function fromRtn(x: Vec3, r: Vec3, v: Vec3): Vec3 {
  const [R, T, N] = rtnBasis(r, v);
  return add(add(scale(R, x[0]), scale(T, x[1])), scale(N, x[2]));
}
