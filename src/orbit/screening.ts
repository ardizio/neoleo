import type { SatRec } from 'satellite.js';
import { sgp4State } from '../data/catalog';
import { stateAt, type Kep, type State, RE } from './kepler';
import { norm, sub, type Vec3 } from './vec';

export type Body = { type: 'sgp4'; rec: SatRec } | { type: 'kep'; kep: Kep };

export function bodyState(b: Body, t: number): State | null {
  return b.type === 'kep' ? stateAt(b.kep, t) : sgp4State(b.rec, t);
}

export interface ScreenPrimary {
  id: string;
  body: Body;
  perigeeKm: number;
  apogeeKm: number;
}
export interface ScreenSecondary {
  id: string;
  body: Body;
  perigeeKm: number;
  apogeeKm: number;
}

export interface ScreeningHit {
  primaryId: string;
  secondaryId: string;
  tca: number;
  missKm: number;
  primary: State;
  secondary: State;
}

export interface ScreeningOptions {
  t0: number;
  t1: number;
  stepS: number;
  thresholdKm: number;
  /** Altitude pad used by the apogee/perigee pre-filter, km. */
  padKm?: number;
  /** Extra margin on the linear miss estimate before refining, km. */
  gateKm?: number;
  onProgress?: (fraction: number) => void;
}

/** Golden-section search of the range minimum between ta and tb (ms). */
export function refineTca(p: Body, s: Body, ta: number, tb: number): { t: number; d: number } | null {
  const g = (Math.sqrt(5) - 1) / 2;
  const dist = (t: number) => {
    const a = bodyState(p, t), b = bodyState(s, t);
    return a && b ? norm(sub(a.r, b.r)) : Infinity;
  };
  let a = ta, b = tb;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = dist(c), fd = dist(d);
  for (let k = 0; k < 60 && b - a > 0.5; k++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = dist(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = dist(d); }
  }
  const t = (a + b) / 2;
  const v = dist(t);
  return Number.isFinite(v) ? { t, d: v } : null;
}

/**
 * All-vs-all screening of primaries against secondaries. Uses an
 * apogee/perigee filter, then samples the range rate on a fixed grid and
 * refines every closest approach that a linear relative-motion estimate
 * places inside the screening volume.
 */
export function screen(
  primaries: ScreenPrimary[],
  secondaries: ScreenSecondary[],
  opt: ScreeningOptions,
): ScreeningHit[] {
  const pad = opt.padKm ?? 25;
  const pairs: [number, number][] = [];
  const used = new Set<number>();
  primaries.forEach((p, pi) => {
    secondaries.forEach((s, si) => {
      if (p.id === s.id) return;
      if (s.perigeeKm - pad > p.apogeeKm || s.apogeeKm + pad < p.perigeeKm) return;
      pairs.push([pi, si]);
      used.add(si);
    });
  });
  const usedList = [...used];
  const P = primaries.length;
  const S = secondaries.length;
  const pr = new Float64Array(P * 6);
  const sr = new Float64Array(S * 6).fill(NaN);
  const prev = new Float64Array(pairs.length * 6).fill(NaN);
  const hits: ScreeningHit[] = [];
  const stepMs = opt.stepS * 1000;
  const total = Math.ceil((opt.t1 - opt.t0) / stepMs);
  const write = (buf: Float64Array, k: number, st: State | null) => {
    if (!st) { buf[k * 6] = NaN; return; }
    buf[k * 6] = st.r[0]; buf[k * 6 + 1] = st.r[1]; buf[k * 6 + 2] = st.r[2];
    buf[k * 6 + 3] = st.v[0]; buf[k * 6 + 4] = st.v[1]; buf[k * 6 + 5] = st.v[2];
  };

  for (let step = 0; step <= total; step++) {
    const t = opt.t0 + step * stepMs;
    for (let k = 0; k < P; k++) write(pr, k, bodyState(primaries[k].body, t));
    for (const k of usedList) write(sr, k, bodyState(secondaries[k].body, t));
    for (let q = 0; q < pairs.length; q++) {
      const [pi, si] = pairs[q];
      const a = pi * 6, b = si * 6, o = q * 6;
      if (Number.isNaN(pr[a]) || Number.isNaN(sr[b])) { prev[o] = NaN; continue; }
      const dx = sr[b] - pr[a], dy = sr[b + 1] - pr[a + 1], dz = sr[b + 2] - pr[a + 2];
      const ux = sr[b + 3] - pr[a + 3], uy = sr[b + 4] - pr[a + 4], uz = sr[b + 5] - pr[a + 5];
      const rr = dx * ux + dy * uy + dz * uz;
      if (!Number.isNaN(prev[o])) {
        const px = prev[o], py = prev[o + 1], pz = prev[o + 2];
        const qx = prev[o + 3], qy = prev[o + 4], qz = prev[o + 5];
        const rrPrev = px * qx + py * qy + pz * qz;
        if (rrPrev < 0 && rr >= 0) {
          const v2 = qx * qx + qy * qy + qz * qz;
          const ts = Math.min(opt.stepS, -rrPrev / v2);
          const mx = px + qx * ts, my = py + qy * ts, mz = pz + qz * ts;
          const est = Math.sqrt(mx * mx + my * my + mz * mz);
          if (est < opt.thresholdKm + (opt.gateKm ?? 30)) {
            const pb = primaries[pi].body, sb = secondaries[si].body;
            const ref = refineTca(pb, sb, t - stepMs, t);
            if (ref && ref.d < opt.thresholdKm) {
              const ps = bodyState(pb, ref.t)!, ss = bodyState(sb, ref.t)!;
              hits.push({ primaryId: primaries[pi].id, secondaryId: secondaries[si].id, tca: ref.t, missKm: ref.d, primary: ps, secondary: ss });
            }
          }
        }
      }
      prev[o] = dx; prev[o + 1] = dy; prev[o + 2] = dz;
      prev[o + 3] = ux; prev[o + 4] = uy; prev[o + 5] = uz;
    }
    if (opt.onProgress && step % 40 === 0) opt.onProgress(step / total);
  }
  opt.onProgress?.(1);
  return hits.sort((x, y) => x.tca - y.tca);
}

export function altitudeRange(k: Kep): { perigeeKm: number; apogeeKm: number } {
  return { perigeeKm: k.a * (1 - k.e) - RE, apogeeKm: k.a * (1 + k.e) - RE };
}

export const relPos = (a: Vec3, b: Vec3) => norm(sub(a, b));
