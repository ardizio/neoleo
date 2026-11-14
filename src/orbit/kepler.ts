import { cross, dot, norm, scale, sub, type Vec3 } from './vec';

export const MU = 398600.4418; // km^3/s^2
export const RE = 6378.137; // km

/** Classical elements. Angles in radians, epoch in ms since Unix epoch. */
export interface Kep {
  a: number;
  e: number;
  i: number;
  raan: number;
  argp: number;
  M0: number;
  epoch: number;
}

export interface State {
  r: Vec3;
  v: Vec3;
}

const TWO_PI = Math.PI * 2;
const wrap = (x: number) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

export const meanMotion = (a: number) => Math.sqrt(MU / (a * a * a)); // rad/s
export const period = (a: number) => TWO_PI / meanMotion(a); // s

function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Perifocal-to-inertial rotation columns P (to periapsis) and Q. */
function pq(k: Kep): [Vec3, Vec3] {
  const cO = Math.cos(k.raan), sO = Math.sin(k.raan);
  const cw = Math.cos(k.argp), sw = Math.sin(k.argp);
  const ci = Math.cos(k.i), si = Math.sin(k.i);
  const P: Vec3 = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Q: Vec3 = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
  return [P, Q];
}

/** Two-body state at time t (ms). */
export function stateAt(k: Kep, t: number): State {
  const n = meanMotion(k.a);
  const M = wrap(k.M0 + n * ((t - k.epoch) / 1000));
  const E = solveKepler(M, k.e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const fac = Math.sqrt(1 - k.e * k.e);
  const x = k.a * (cE - k.e);
  const y = k.a * fac * sE;
  const rmag = k.a * (1 - k.e * cE);
  const vx = (-Math.sqrt(MU * k.a) / rmag) * sE;
  const vy = (Math.sqrt(MU * k.a) / rmag) * fac * cE;
  const [P, Q] = pq(k);
  return {
    r: [P[0] * x + Q[0] * y, P[1] * x + Q[1] * y, P[2] * x + Q[2] * y],
    v: [P[0] * vx + Q[0] * vy, P[1] * vx + Q[1] * vy, P[2] * vx + Q[2] * vy],
  };
}

/** Elements from an inertial state at time t (ms). Works for near-circular orbits. */
export function fromState(r: Vec3, v: Vec3, t: number): Kep {
  const rm = norm(r);
  const h = cross(r, v);
  const hm = norm(h);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hm)));
  const nodeVec: Vec3 = [-h[1], h[0], 0];
  const nm = norm(nodeVec);
  const eVec = sub(scale(cross(v, h), 1 / MU), scale(r, 1 / rm));
  const e = norm(eVec);
  const energy = dot(v, v) / 2 - MU / rm;
  const a = -MU / (2 * energy);
  let raan = nm > 1e-12 ? Math.atan2(nodeVec[1], nodeVec[0]) : 0;
  raan = wrap(raan);
  // Use argument of latitude when nearly circular to keep things stable.
  const nodeU: Vec3 = nm > 1e-12 ? scale(nodeVec, 1 / nm) : [1, 0, 0];
  const qU = scale(cross(h, nodeU), 1 / hm);
  const u = Math.atan2(dot(r, qU), dot(r, nodeU));
  let argp = 0;
  let nu = u;
  if (e > 1e-9) {
    argp = Math.atan2(dot(eVec, qU), dot(eVec, nodeU));
    nu = u - argp;
  }
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);
  return { a, e, i, raan, argp: wrap(argp), M0: wrap(M), epoch: t };
}

/** Circular orbit with given radius whose argument of latitude is u at time t. */
export function circular(radius: number, i: number, raan: number, u: number, t: number): Kep {
  return { a: radius, e: 0, i, raan: wrap(raan), argp: 0, M0: wrap(u), epoch: t };
}

/** Orbit-plane unit normal for (i, raan). */
export function planeNormal(i: number, raan: number): Vec3 {
  return [Math.sin(raan) * Math.sin(i), -Math.cos(raan) * Math.sin(i), Math.cos(i)];
}

/** Argument of latitude of position r in the plane (i, raan). */
export function argLatitude(r: Vec3, i: number, raan: number): number {
  const nodeU: Vec3 = [Math.cos(raan), Math.sin(raan), 0];
  const qU = cross(planeNormal(i, raan), nodeU);
  return Math.atan2(dot(r, qU), dot(r, nodeU));
}

/** Apply an impulsive RTN delta-v (km/s) at time t and return the new elements. */
export function applyBurn(k: Kep, t: number, dvRtn: Vec3): Kep {
  const s = stateAt(k, t);
  const R = scale(s.r, 1 / norm(s.r));
  const N = scale(cross(s.r, s.v), 1 / norm(cross(s.r, s.v)));
  const T = cross(N, R);
  const v: Vec3 = [
    s.v[0] + R[0] * dvRtn[0] + T[0] * dvRtn[1] + N[0] * dvRtn[2],
    s.v[1] + R[1] * dvRtn[0] + T[1] * dvRtn[1] + N[1] * dvRtn[2],
    s.v[2] + R[2] * dvRtn[0] + T[2] * dvRtn[1] + N[2] * dvRtn[2],
  ];
  return fromState(s.r, v, t);
}
