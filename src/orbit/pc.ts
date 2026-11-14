import { cross, dot, norm, rtnBasis, scale, sub, unit, type Vec3 } from './vec';

/** Diagonal RTN position sigmas, km. */
export type SigmaRtn = Vec3;

export interface EncounterGeometry {
  missKm: number;
  relSpeedKms: number;
  relPosRtn: Vec3; // secondary relative to primary, primary RTN frame, km
  relVelRtn: Vec3;
  /** Miss in encounter (B-) plane coordinates, km. */
  bPlane: [number, number];
  /** 2x2 combined covariance in the encounter plane, km^2. */
  cov2: [number, number, number]; // [xx, xy, yy]
  pc: number;
  sigmaMajorKm: number;
  sigmaMinorKm: number;
  ellipseAngle: number; // radians, major axis vs b-plane x
  approachAngleDeg: number;
}

type Mat3 = number[][];

function covInertial(r: Vec3, v: Vec3, s: SigmaRtn): Mat3 {
  const B = rtnBasis(r, v); // rows: R, T, N
  const C: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += B[k][a] * B[k][b] * s[k] * s[k];
      C[a][b] = sum;
    }
  return C;
}

const quad = (C: Mat3, x: Vec3, y: Vec3) => {
  let s = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s += x[a] * C[a][b] * y[b];
  return s;
};

/**
 * Probability of collision for a short-term encounter (Foster-style 2D
 * integral of the combined Gaussian over the hard-body circle), computed
 * numerically on a polar grid.
 */
export function encounter(
  rp: Vec3, vp: Vec3, rs: Vec3, vs: Vec3,
  sigP: SigmaRtn, sigS: SigmaRtn, hbrKm: number,
): EncounterGeometry {
  const dr = sub(rs, rp);
  const dv = sub(vs, vp);
  const relSpeed = norm(dv);
  // Encounter plane: perpendicular to relative velocity.
  const vhat = unit(dv);
  let x = sub(dr, scale(vhat, dot(dr, vhat)));
  if (norm(x) < 1e-9) x = cross(vhat, [0, 0, 1]);
  const ex = unit(x);
  const ey = cross(vhat, ex);
  const bx = dot(dr, ex);
  const by = dot(dr, ey);

  const Cp = covInertial(rp, vp, sigP);
  const Cs = covInertial(rs, vs, sigS);
  const C: Mat3 = Cp.map((row, a) => row.map((val, b) => val + Cs[a][b]));
  const sxx = quad(C, ex, ex), sxy = quad(C, ex, ey), syy = quad(C, ey, ey);

  const pc = integrateCircle(bx, by, sxx, sxy, syy, hbrKm);

  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  const [R, T, N] = rtnBasis(rp, vp);
  const cosA = dot(unit(vp), unit(vs));
  return {
    missKm: norm(dr),
    relSpeedKms: relSpeed,
    relPosRtn: [dot(dr, R), dot(dr, T), dot(dr, N)],
    relVelRtn: [dot(dv, R), dot(dv, T), dot(dv, N)],
    bPlane: [bx, by],
    cov2: [sxx, sxy, syy],
    pc,
    sigmaMajorKm: Math.sqrt(Math.max(l1, 0)),
    sigmaMinorKm: Math.sqrt(Math.max(l2, 0)),
    ellipseAngle: ang,
    approachAngleDeg: (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI,
  };
}

export function integrateCircle(
  mx: number, my: number, sxx: number, sxy: number, syy: number, R: number,
): number {
  const det = sxx * syy - sxy * sxy;
  if (det <= 0) return 0;
  const ixx = syy / det, ixy = -sxy / det, iyy = sxx / det;
  const norm0 = 1 / (2 * Math.PI * Math.sqrt(det));
  const NR = 24, NT = 48;
  let sum = 0;
  for (let a = 0; a < NR; a++) {
    const rr = ((a + 0.5) / NR) * R;
    const dA = (R / NR) * rr * ((2 * Math.PI) / NT);
    for (let b = 0; b < NT; b++) {
      const th = ((b + 0.5) / NT) * 2 * Math.PI;
      // point relative to the miss vector origin (Gaussian is centred at the
      // primary; the hard-body circle is centred at the secondary's miss).
      const px = mx + rr * Math.cos(th);
      const py = my + rr * Math.sin(th);
      const q = ixx * px * px + 2 * ixy * px * py + iyy * py * py;
      sum += Math.exp(-0.5 * q) * dA;
    }
  }
  return Math.min(1, sum * norm0);
}

export type Severity = 'critical' | 'warning' | 'watch' | 'monitor';

export function severityOf(pc: number, missKm: number): Severity {
  if (pc >= 1e-4) return 'critical';
  if (pc >= 1e-5) return 'warning';
  if (pc >= 1e-7 || missKm < 1) return 'watch';
  return 'monitor';
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  watch: 'Watch',
  monitor: 'Monitor',
};

export function formatPc(pc: number): string {
  if (pc <= 0) return '< 1e-12';
  if (pc < 1e-12) return '< 1e-12';
  const exp = Math.floor(Math.log10(pc));
  const mant = pc / 10 ** exp;
  return `${mant.toFixed(1)}e${exp}`;
}
