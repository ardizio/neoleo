// Per-object multi-source tracking: who saw the object, what blocked the sensors,
// and the fused most-probable path with its validation.
//
// - Sensors (ground radar, ground optical, owner GPS) observe the object over the
//   last 6 h. Visibility uses real geometry: Earth rotation (GMST), elevation mask,
//   terrain sectors, max range, site daylight and object in Earth shadow (Sun
//   position), plus clouds. Every lost window is logged with its reason.
// - Low-elevation points carry an inflated error, and some an unmodelled
//   refraction/multipath bias that the fusion has to catch.
// - Fusion: Kalman filter + RTS smoother on the deviation from the catalog (SGP4)
//   path, Clohessy-Wiltshire dynamics in RTN, catalog-grade prior. The smoothed
//   path is the most probable path under Gaussian errors. Outliers are removed by
//   refit-and-drop-worst (a one-shot gate fails when the first point of a pass is bad).
// - Validation: innovation consistency (are the stated errors honest), leave-one-source-out
//   (a path built without a source must predict it), and the error against the simulated truth.
//
// ponytail: observations are SIMULATED around the catalog orbit (seeded per object) and
// HCW is a few-hour linearisation; swap in real OD tracks / CDM covariances when ingested.
import { gstime } from 'satellite.js';
import { RE } from './kepler';
import { dot, norm, sub, fromRtn, add, type Vec3 } from './vec';

export type SensorKind = 'radar' | 'optical' | 'gps';
type Site = { lat: number; lon: number; kind: 'radar' | 'optical'; src: string; terrain?: [number, number, number] };

/** Sites carry only an opaque source id: provider names are never shown. */
export const SITES: Site[] = [
  { lat: 45, lon: 8, kind: 'radar', src: 'S1', terrain: [120, 200, 25] },
  { lat: 28, lon: -16, kind: 'radar', src: 'S1' },
  { lat: -31, lon: 116, kind: 'radar', src: 'S2' },
  { lat: 69, lon: 19, kind: 'radar', src: 'S2' },
  { lat: 9, lon: 167, kind: 'radar', src: 'S5' },
  { lat: -46, lon: -73, kind: 'radar', src: 'S5' },
  { lat: 37, lon: -4, kind: 'optical', src: 'S3', terrain: [250, 320, 30] },
  { lat: -24, lon: -70, kind: 'optical', src: 'S3' },
  { lat: 19, lon: -156, kind: 'optical', src: 'S4' },
  { lat: -33, lon: 20, kind: 'optical', src: 'S4' },
  { lat: 32, lon: 35, kind: 'optical', src: 'S6' },
  { lat: -35, lon: 149, kind: 'optical', src: 'S6' },
];
const SENSOR = { radar: { sigma: 0.05, mask: 10, maxKm: 3000 }, optical: { sigma: 0.15, mask: 15, maxKm: 8000 } };
const GPS_SIGMA = 0.01;
export const DT = 60; // s
export const STEPS = 360; // 6 h
const GATE = 14.16; // chi2 3 dof, 99.7 %
const Q_ACC = 5e-10; // km/s^2 unmodelled acceleration
const PRIOR_SIG = [0.3, 1.0, 0.3, 3e-4, 1e-5, 3e-4]; // radial, along, cross (km), vx, along drift, vz (km/s)
const CLOUD_P = 0.3;

// ---------- small dense linear algebra ----------
type M = number[][];
const zeros = (r: number, c: number): M => Array.from({ length: r }, () => new Array(c).fill(0));
const eye = (n: number): M => zeros(n, n).map((row, i) => ((row[i] = 1), row));
const mul = (A: M, B: M): M => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
const T = (A: M): M => A[0].map((_, j) => A.map((row) => row[j]));
const plus = (A: M, B: M, s = 1): M => A.map((row, i) => row.map((a, j) => a + s * B[i][j]));
const mv = (A: M, x: number[]) => A.map((row) => row.reduce((s, a, k) => s + a * x[k], 0));
function inv(A: M): M {
  const n = A.length;
  const a = A.map((row, i) => [...row, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c && a[r][c]) { const f = a[r][c]; for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map((row) => row.slice(n));
}
const quad = (v: number[], S: M) => { const w = mv(inv(S), v); return v.reduce((s, x, i) => s + x * w[i], 0); };

// ---------- dynamics ----------
export function hcw(n: number, t: number): M {
  const s = Math.sin(n * t), c = Math.cos(n * t);
  return [
    [4 - 3 * c, 0, 0, s / n, (2 * (1 - c)) / n, 0],
    [6 * (s - n * t), 1, 0, (-2 * (1 - c)) / n, (4 * s - 3 * n * t) / n, 0],
    [0, 0, c, 0, 0, s / n],
    [3 * n * s, 0, 0, c, 2 * s, 0],
    [-6 * n * (1 - c), 0, 0, -2 * s, 4 * c - 3, 0],
    [0, 0, -n * s, 0, 0, c],
  ];
}
function qmat(dt: number): M {
  const Q = zeros(6, 6), q = Q_ACC ** 2;
  for (let k = 0; k < 3; k++) {
    Q[k][k] = (q * dt ** 3) / 3;
    Q[k][k + 3] = Q[k + 3][k] = (q * dt ** 2) / 2;
    Q[k + 3][k + 3] = q * dt;
  }
  return Q;
}
/** Catalog prior with bounded relative motion: vy = -2 n x + drift. */
function priorJ(n: number): M { const J = eye(6); J[4][0] = -2 * n; return J; }
function prior(n: number): M {
  const J = priorJ(n), D = zeros(6, 6);
  PRIOR_SIG.forEach((s, i) => (D[i][i] = s * s));
  return mul(mul(J, D), T(J));
}

// ---------- seeded randomness ----------
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, g };
}
const hash01 = (x: number) => rng(x * 2654435761).u();

// ---------- geometry ----------
/** Low-precision Sun direction (ECI unit vector), good to ~0.01 deg. */
export function sunDir(t: number): Vec3 {
  const d = t / 86400000 + 2440587.5 - 2451545.0;
  const g = ((357.529 + 0.98560028 * d) * Math.PI) / 180;
  const L = ((280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;
  const e = ((23.439 - 0.00000036 * d) * Math.PI) / 180;
  return [Math.cos(L), Math.cos(e) * Math.sin(L), Math.sin(e) * Math.sin(L)];
}
function siteFrame(s: Site, gmst: number) {
  const phi = (s.lat * Math.PI) / 180, lam = (s.lon * Math.PI) / 180 + gmst;
  const up: Vec3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const east: Vec3 = [-Math.sin(lam), Math.cos(lam), 0];
  const north: Vec3 = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
  return { pos: [RE * up[0], RE * up[1], RE * up[2]] as Vec3, up, east, north };
}
function inShadow(p: Vec3, sun: Vec3) {
  const a = dot(p, sun);
  return a < 0 && norm(sub(p, [a * sun[0], a * sun[1], a * sun[2]])) < RE;
}

// ---------- types ----------
export interface Obs { k: number; site: number; src: string; kind: SensorKind; sig: number; z: number[]; el: number; dist: number; lowel: boolean; used: boolean }
export interface Pass { kind: SensorKind; where: string; t0: number; t1: number; n: number; rejected: number; el: [number, number] | null; km: number | null; sigM: [number, number]; notes: string[] }
export interface Obstruction { kind: SensorKind; where: string; t0: number; t1: number; reason: string }
export interface TrackReport {
  t0: number; // ms, start of window; step k is at t0 + k*DT*1000
  nSources: number;
  sensorTypes: SensorKind[];
  sigmaM: number[]; // fused 1-sigma 3D position, m, per step
  errM: number[]; // simulated true error, m, per step
  passes: Pass[];
  obstructions: Obstruction[];
  validation: { nisMean: number | null; nisOk: boolean; nUsed: number; nRejected: number; loso: number | null; truthRmsM: number; truthCover: number; bestSingleRmsM: number | null; priorRmsM: number; injectedBad: number; caughtBad: number };
}
export type StateFn = (t: number) => { r: Vec3; v: Vec3 } | null;

// ---------- fusion ----------
function fuse(n: number, obs: Obs[]) {
  const Phi = hcw(n, DT), PhiT = T(Phi), Q = qmat(DT);
  const byK = new Map<number, Obs[]>();
  obs.forEach((o) => byK.set(o.k, [...(byK.get(o.k) ?? []), o]));
  let x = new Array(6).fill(0), P = prior(n);
  const xf: number[][] = [], Pf: M[] = [], xp: number[][] = [], Pp: M[] = [], nis: number[] = [];
  for (let k = 0; k < STEPS; k++) {
    if (k) { x = mv(Phi, x); P = plus(mul(mul(Phi, P), PhiT), Q); }
    xp.push(x); Pp.push(P);
    for (const o of byK.get(k) ?? []) {
      const S = P.slice(0, 3).map((row, i) => row.slice(0, 3).map((v, j) => v + (i === j ? o.sig ** 2 : 0)));
      const v = o.z.map((z, i) => z - x[i]);
      const Si = inv(S);
      const w = mv(Si, v);
      nis.push(v.reduce((s, a, i) => s + a * w[i], 0));
      const K = mul(P.map((row) => row.slice(0, 3)), Si); // 6x3
      x = x.map((xi, i) => xi + K[i].reduce((s, kk, j) => s + kk * v[j], 0));
      const IKH = eye(6).map((row, i) => row.map((a, j) => (j < 3 ? a - K[i][j] : a)));
      P = plus(mul(mul(IKH, P), T(IKH)), mul(K, T(K)), o.sig ** 2);
    }
    xf.push(x); Pf.push(P);
  }
  const xs = [...xf], Ps = [...Pf];
  for (let k = STEPS - 2; k >= 0; k--) {
    const C = mul(mul(Pf[k], PhiT), inv(Pp[k + 1]));
    xs[k] = plus([xf[k]], [mv(C, xs[k + 1].map((a, i) => a - xp[k + 1][i]))])[0];
    Ps[k] = plus(Pf[k], mul(mul(C, plus(Ps[k + 1], Pp[k + 1], -1)), T(C)));
  }
  return { xs, Ps, nis };
}

function robustFuse(n: number, obs: Obs[]) {
  const keep = [...obs];
  for (;;) {
    const f = fuse(n, keep);
    let worst = -1, wd = GATE;
    keep.forEach((o, i) => { const d = o.z.reduce((s, z, j) => s + (z - f.xs[o.k][j]) ** 2, 0) / o.sig ** 2; if (d >= wd) { wd = d; worst = i; } });
    if (worst < 0) return { ...f, keep };
    keep.splice(worst, 1);
  }
}

const rms = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const where = (s: Site) => `ground site ${s.lat}°, ${s.lon}°`;

/** Simulate, fuse and validate the last 6 h of tracking for one object. */
export function trackObject(opts: { seed: number; meanMotion: number; state: StateFn; now: number; gps: boolean }): TrackReport {
  const { seed, meanMotion: n, state, gps } = opts;
  const t0 = opts.now - (STEPS - 1) * DT * 1000;
  const R = rng(seed);
  // truth: deviation from the catalog path, catalog-grade initial error + process noise
  const Phi = hcw(n, DT), Q = qmat(DT);
  const truth: number[][] = [mv(priorJ(n), PRIOR_SIG.map((s) => s * R.g()))];
  const a = Q[0][0], b = Q[0][3], c = Q[3][3];
  for (let k = 1; k < STEPS; k++) {
    const w = new Array(6).fill(0);
    for (let i = 0; i < 3; i++) { const g1 = R.g(), g2 = R.g(); w[i] = Math.sqrt(a) * g1; w[i + 3] = (b / Math.sqrt(a)) * g1 + Math.sqrt(Math.max(c - (b * b) / a, 0)) * g2; }
    truth.push(mv(Phi, truth[k - 1]).map((x, i) => x + w[i]));
  }

  const obs: Obs[] = [];
  const blocked: { site: number; k: number; reason: string }[] = [];
  for (let k = 0; k < STEPS; k++) {
    const t = t0 + k * DT * 1000;
    const st = state(t);
    if (!st) continue;
    const p = add(st.r, fromRtn(truth[k].slice(0, 3) as Vec3, st.r, st.v));
    const gm = gstime(new Date(t)), sun = sunDir(t);
    SITES.forEach((s, si) => {
      const f = siteFrame(s, gm), rho = sub(p, f.pos), dist = norm(rho);
      const el = (Math.asin(dot(rho, f.up) / dist) * 180) / Math.PI;
      if (el <= 0) return;
      const az = (((Math.atan2(dot(rho, f.east), dot(rho, f.north)) * 180) / Math.PI) + 360) % 360;
      const cfg = SENSOR[s.kind];
      let reason = '';
      if (el < cfg.mask) reason = `below ${cfg.mask}° elevation mask`;
      else if (s.terrain && az >= s.terrain[0] && az <= s.terrain[1] && el < s.terrain[2]) reason = `terrain blocks azimuth ${s.terrain[0]}–${s.terrain[1]}° below ${s.terrain[2]}°`;
      else if (dist > cfg.maxKm) reason = 'beyond sensor range';
      else if (s.kind === 'optical') {
        if ((Math.asin(dot(f.up, sun)) * 180) / Math.PI > -12) reason = 'daylight/twilight at site';
        else if (inShadow(p, sun)) reason = 'object in Earth shadow (not lit)';
        else if (hash01(si * 1e6 + Math.floor(t / 1800000)) < CLOUD_P) reason = 'clouds over site';
      }
      if (reason) { blocked.push({ site: si, k, reason }); return; }
      const sig = cfg.sigma / Math.sin((el * Math.PI) / 180); // longer path through the atmosphere
      const err = [R.g() * sig, R.g() * sig, R.g() * sig];
      const lowel = el < 20 && R.u() < 0.3; // unmodelled refraction / multipath
      if (lowel) { const d = [R.g(), R.g(), R.g()], dn = Math.hypot(...d); d.forEach((x, i) => (err[i] += (8 * sig * x) / dn)); }
      obs.push({ k, site: si, src: s.src, kind: s.kind, sig, z: truth[k].slice(0, 3).map((x, i) => x + err[i]), el, dist, lowel, used: false });
    });
    if (gps && k % 10 === 0) obs.push({ k, site: -1, src: 'S-op', kind: 'gps', sig: GPS_SIGMA, z: truth[k].slice(0, 3).map((x) => x + R.g() * GPS_SIGMA), el: 90, dist: 0, lowel: false, used: false });
  }

  const { xs, Ps, nis, keep } = robustFuse(n, obs);
  const kept = new Set(keep);
  obs.forEach((o) => (o.used = kept.has(o)));
  const srcs = [...new Set(keep.map((o) => o.src))].sort();
  const nisMean = nis.length ? nis.reduce((s, x) => s + x, 0) / nis.length : null;

  let loso: number | null = null;
  if (srcs.length >= 2)
    loso = Math.min(...srcs.map((s) => {
      const f = fuse(n, keep.filter((o) => o.src !== s));
      const d = keep.filter((o) => o.src === s).map((o) => quad(o.z.map((z, i) => z - f.xs[o.k][i]), f.Ps[o.k].slice(0, 3).map((row, i) => row.slice(0, 3).map((v, j) => v + (i === j ? o.sig ** 2 : 0)))));
      return d.filter((x) => x < GATE).length / d.length;
    }));
  const errKm = xs.map((x, k) => Math.hypot(x[0] - truth[k][0], x[1] - truth[k][1], x[2] - truth[k][2]));
  const cover = xs.filter((x, k) => quad([0, 1, 2].map((i) => x[i] - truth[k][i]), Ps[k].slice(0, 3).map((r) => r.slice(0, 3))) < GATE).length / STEPS;
  const singles = srcs.map((s) => { const f = fuse(n, keep.filter((o) => o.src === s)); return rms(f.xs.map((x, k) => Math.hypot(x[0] - truth[k][0], x[1] - truth[k][1], x[2] - truth[k][2]))); });

  // group consecutive points per site into passes, blocked steps per (site, reason) into windows
  const runs = <E extends { k: number }>(items: E[], key: (e: E) => string) => {
    const out: E[][] = [];
    [...items].sort((x, y) => key(x).localeCompare(key(y)) || x.k - y.k).forEach((e) => {
      const last = out[out.length - 1];
      if (last && key(last[last.length - 1]) === key(e) && e.k - last[last.length - 1].k <= 10) last.push(e); else out.push([e]);
    });
    return out;
  };
  const tAt = (k: number) => t0 + k * DT * 1000;
  const passes: Pass[] = runs(obs, (o) => `${o.site}`).map((g): Pass => {
    const o0 = g[0], rej = g.filter((o) => !o.used), site = o0.site >= 0 ? SITES[o0.site] : null;
    const notes: string[] = [];
    if (site && Math.min(...g.map((o) => o.el)) < 20) notes.push('low elevation: error inflated (longer path through atmosphere)');
    if (rej.length) notes.push(`${rej.length} point(s) rejected as inconsistent with the other sources${rej.some((o) => o.lowel) ? ' (likely refraction/multipath at low elevation)' : ''}`);
    return {
      kind: o0.kind, where: site ? where(site) : 'on board (operator ephemeris)', t0: tAt(o0.k), t1: tAt(g[g.length - 1].k), n: g.length, rejected: rej.length,
      el: site ? [Math.round(Math.min(...g.map((o) => o.el))), Math.round(Math.max(...g.map((o) => o.el)))] : null,
      km: site ? Math.round(Math.min(...g.map((o) => o.dist))) : null,
      sigM: [Math.round(Math.min(...g.map((o) => o.sig)) * 1000), Math.round(Math.max(...g.map((o) => o.sig)) * 1000)], notes,
    };
  }).sort((x, y) => x.t0 - y.t0);
  const obstructions: Obstruction[] = runs(blocked, (b) => `${b.site}|${b.reason}`)
    .map((g) => ({ kind: SITES[g[0].site].kind, where: where(SITES[g[0].site]), t0: tAt(g[0].k), t1: tAt(g[g.length - 1].k), reason: g[0].reason }))
    .sort((x, y) => x.t0 - y.t0);

  return {
    t0, nSources: srcs.length, sensorTypes: [...new Set(keep.map((o) => o.kind))].sort(),
    sigmaM: Ps.map((P) => Math.sqrt(P[0][0] + P[1][1] + P[2][2]) * 1000),
    errM: errKm.map((e) => e * 1000), passes, obstructions,
    validation: {
      nisMean, nisOk: nisMean != null && Math.abs(nisMean - 3) < 3 * Math.sqrt(6 / nis.length) + 0.5,
      nUsed: keep.length, nRejected: obs.length - keep.length, loso,
      truthRmsM: rms(errKm) * 1000, truthCover: cover, bestSingleRmsM: singles.length ? Math.min(...singles) * 1000 : null,
      priorRmsM: rms(truth.map((x) => Math.hypot(x[0], x[1], x[2]))) * 1000,
      injectedBad: obs.filter((o) => o.lowel).length, caughtBad: obs.filter((o) => o.lowel && !o.used).length,
    },
  };
}
