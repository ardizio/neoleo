// Fusing several estimates of the same object (catalog, commercial sensors,
// ingested CDMs) at a common epoch. Two steps:
// 1. Consistency gate (Mahalanobis distance, chi-square 3 dof): estimates that
//    disagree beyond their stated uncertainty are not fused.
// 2. Covariance intersection: safe when the cross-correlation between sources is
//    unknown (providers often share observations), unlike a plain Kalman update
//    which would be over-confident. Weights use the fast trace-based rule.
// Covariances are diagonal in the object's RTN frame, which is what the
// platform's CDMs carry.
import { add, fromRtn, sub, toRtn, type Vec3 } from './vec';

export interface Estimate {
  r: Vec3; // inertial position, km
  v: Vec3; // inertial velocity, km/s (defines the RTN frame)
  sigma: Vec3; // 1-sigma RTN position, km
  source: string;
}

/** Chi-square 3 dof, p = 0.01. */
export const GATE_D2 = 11.34;

/** Squared Mahalanobis distance between two estimates (independent-error assumption). */
export function mahalanobis2(a: Estimate, b: Estimate): number {
  const d = toRtn(sub(b.r, a.r), a.r, a.v);
  return d.reduce((s, x, k) => s + (x * x) / (a.sigma[k] ** 2 + b.sigma[k] ** 2), 0);
}

export function fuseCI(ests: Estimate[]): { r: Vec3; sigma: Vec3; weights: number[] } {
  const ref = ests[0];
  const inv = ests.map((e) => 1 / e.sigma.reduce((s, x) => s + x * x, 0));
  const total = inv.reduce((s, x) => s + x, 0);
  const w = inv.map((x) => x / total);
  const info: Vec3 = [0, 0, 0];
  const acc: Vec3 = [0, 0, 0];
  ests.forEach((e, i) => {
    const d = toRtn(sub(e.r, ref.r), ref.r, ref.v);
    for (let k = 0; k < 3; k++) {
      const p = w[i] / e.sigma[k] ** 2;
      info[k] += p;
      acc[k] += p * d[k];
    }
  });
  const mean = acc.map((x, k) => x / info[k]) as Vec3;
  return { r: add(ref.r, fromRtn(mean, ref.r, ref.v)), sigma: info.map((x) => Math.sqrt(1 / x)) as Vec3, weights: w };
}
