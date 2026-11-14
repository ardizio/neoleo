// Demo scenario: SVST26's simulated orbits are seeded so that they cross
// real catalog objects (CelesTrak elements propagated with SGP4) at chosen
// times after the session starts. The screening engine then has to find
// these encounters on its own, together with any incidental close
// approaches against the rest of the real catalog.
import type { SatRec } from 'satellite.js';
import { FLEET, PARTNER_FLEET, type FleetSpec } from '../data/company';
import type { CatalogObject, ObjectKind } from '../data/catalog';
import { sgp4State } from '../data/catalog';
import { argLatitude, circular, meanMotion, planeNormal, RE, stateAt, type Kep } from '../orbit/kepler';
import { cross, dot, norm, unit, type Vec3 } from '../orbit/vec';

const DEG = Math.PI / 180;

export interface CdmPlanStep {
  /** Seconds after the alert is first released. */
  atSec: number;
  sources: string[];
  sigmaScale: number;
  /** Error of the fused secondary estimate vs truth, primary RTN, km. */
  biasRtnKm?: Vec3;
  note: string;
}

export interface EncounterDesign {
  key: string;
  primary: string;
  target:
    | { type: 'catalog'; kinds: ObjectKind[]; name?: RegExp; norad?: number }
    | { type: 'partner'; id: string };
  tcaHours: number;
  radialKm: number;
  alongKm: number;
  /** Wall-clock seconds after login when the first CDM arrives. */
  releaseSec: number;
  plan: CdmPlanStep[];
}

const STD_PLAN = (extra: Partial<CdmPlanStep> = {}): CdmPlanStep[] => [
  { atSec: 0, sources: ['PUB-GP', 'PUB-CDM'], sigmaScale: 1.6, note: 'Initial screening on public catalog', ...extra },
  { atSec: 75, sources: ['PUB-GP', 'PUB-CDM', 'LEOLABS'], sigmaScale: 1.0, note: 'LeoLabs radar track fused' },
  { atSec: 190, sources: ['PUB-GP', 'PUB-CDM', 'LEOLABS', 'SLINGSHOT', 'VYOMA'], sigmaScale: 0.72, note: 'Slingshot optical + Vyoma space-based tracks fused' },
];

const PARTNER_PLAN: CdmPlanStep[] = [
  { atSec: 0, sources: ['PUB-CDM', 'PTN-EPH'], sigmaScale: 1.2, note: 'Owner/operator ephemerides exchanged' },
  { atSec: 120, sources: ['PUB-CDM', 'PTN-EPH', 'LEOLABS'], sigmaScale: 0.85, note: 'Independent radar confirmation' },
];

export const DESIGNS: EncounterDesign[] = [
  {
    key: 'A', primary: 'SVST003', target: { type: 'catalog', kinds: ['DEBRIS'] },
    tcaHours: 2.3, radialKm: 0.085, alongKm: 0.03, releaseSec: 0, plan: STD_PLAN(),
  },
  {
    key: 'B', primary: 'SVST007', target: { type: 'partner', id: 'SVST-SG04' },
    tcaHours: 5.6, radialKm: 0.028, alongKm: 0.008, releaseSec: 0, plan: PARTNER_PLAN,
  },
  {
    key: 'C', primary: 'SVST018', target: { type: 'catalog', kinds: ['DEBRIS'], name: /COSMOS 2251/ },
    tcaHours: 8.8, radialKm: 0.12, alongKm: 0.03, releaseSec: 0, plan: STD_PLAN(),
  },
  {
    key: 'D', primary: 'SVST013', target: { type: 'catalog', kinds: ['DEFUNCT'], norad: 27386 },
    tcaHours: 13.5, radialKm: 0.095, alongKm: 0.02, releaseSec: 35,
    plan: [
      { atSec: 0, sources: ['PUB-GP', 'PUB-CDM'], sigmaScale: 1.5, biasRtnKm: [0.82, 0.3, 0.25], note: 'Initial screening on public catalog' },
      { atSec: 60, sources: ['PUB-GP', 'PUB-CDM', 'LEOLABS'], sigmaScale: 1.0, biasRtnKm: [0.05, 0.04, 0.02], note: 'LeoLabs radar track: secondary 0.8 km lower than catalog' },
      { atSec: 170, sources: ['PUB-GP', 'PUB-CDM', 'LEOLABS', 'SLINGSHOT'], sigmaScale: 0.75, note: 'Slingshot optical track confirms close approach' },
    ],
  },
  {
    key: 'E', primary: 'SVST005', target: { type: 'catalog', kinds: ['DEBRIS'], name: /IRIDIUM 33|FENGYUN|COSMOS/ },
    tcaHours: 18.7, radialKm: 0.175, alongKm: 0.03, releaseSec: 70, plan: STD_PLAN(),
  },
  {
    key: 'F', primary: 'SVST010', target: { type: 'partner', id: 'SVST-SG08' },
    tcaHours: 22.4, radialKm: 0.072, alongKm: 0.01, releaseSec: 140, plan: PARTNER_PLAN,
  },
];

export interface FleetOrbit {
  spec: FleetSpec;
  kep: Kep;
}

export interface ResolvedDesign {
  key: string;
  primaryId: string;
  secondaryId: string; // catalog: "C<norad>", partner: fleet id
  plannedTca: number;
}

export const catalogId = (norad: number) => `C${norad}`;

function nominalKep(s: FleetSpec, t0: number): Kep {
  return circular(RE + s.altitudeKm, s.inclinationDeg * DEG, s.raanDeg * DEG, s.phaseDeg * DEG, t0);
}

/** Circular orbit in plane (i, raan) that passes through point p at time t. */
function throughPoint(radius: number, i: number, raan: number, p: Vec3, alongKm: number, t: number, t0: number): Kep {
  const u = argLatitude(p, i, raan) + alongKm / radius;
  const n = meanMotion(radius);
  return circular(radius, i, raan, u - n * ((t - t0) / 1000), t0);
}

/** Eccentric orbit (a = radius + aOffsetKm) whose radius at time t equals `radius` at point p. */
function throughPointEccentric(
  radius: number, aOffsetKm: number, e: number, i: number, raan: number, p: Vec3, alongKm: number, t: number, t0: number,
): Kep {
  const a = radius + aOffsetKm;
  const cosNu = Math.max(-1, Math.min(1, ((a * (1 - e * e)) / radius - 1) / e));
  const nu = Math.acos(cosNu);
  const u = argLatitude(p, i, raan) + alongKm / radius;
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const M = E - e * Math.sin(E);
  const n = meanMotion(a);
  return { a, e, i, raan, argp: u - nu, M0: M - n * ((t - t0) / 1000), epoch: t0 };
}

/** Find a time near tWanted when the object crosses the plane at a usable altitude. */
function findPlaneCrossing(
  rec: SatRec, i: number, raan: number, tWanted: number, altKm: number, bandKm: number,
): { t: number; r: Vec3 } | null {
  const n = planeNormal(i, raan);
  const side = (t: number) => {
    const s = sgp4State(rec, t);
    return s ? dot(s.r, n) : NaN;
  };
  const span = 100 * 60e3;
  const step = 20e3;
  let best: { t: number; r: Vec3; score: number } | null = null;
  let prevT = tWanted - span, prevV = side(prevT);
  for (let t = prevT + step; t <= tWanted + span; t += step) {
    const v = side(t);
    if (Number.isFinite(v) && Number.isFinite(prevV) && Math.sign(v) !== Math.sign(prevV)) {
      let a = prevT, b = t, fa = prevV;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2, fm = side(m);
        if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
      }
      const tc = (a + b) / 2;
      const s = sgp4State(rec, tc);
      if (s) {
        const alt = norm(s.r) - RE;
        if (Math.abs(alt - altKm) <= bandKm) {
          const score = Math.abs(tc - tWanted);
          if (!best || score < best.score) best = { t: tc, r: s.r, score };
        }
      }
    }
    prevT = t; prevV = v;
  }
  return best;
}

export interface BuildInput {
  t0: number;
  objects: CatalogObject[];
  recs: (SatRec | null)[];
}

export function buildScenario({ t0, objects, recs }: BuildInput): {
  fleet: FleetOrbit[];
  partners: FleetOrbit[];
  designs: ResolvedDesign[];
} {
  const fleet = new Map<string, FleetOrbit>();
  FLEET.forEach((s) => fleet.set(s.id, { spec: s, kep: nominalKep(s, t0) }));
  const partners = new Map<string, FleetOrbit>();
  PARTNER_FLEET.forEach((s) => partners.set(s.id, { spec: s, kep: nominalKep(s, t0) }));
  const designs: ResolvedDesign[] = [];
  const usedTargets = new Set<number>();

  for (const d of DESIGNS) {
    const prim = fleet.get(d.primary)!;
    const s = prim.spec;
    const i = s.inclinationDeg * DEG, raan = s.raanDeg * DEG;
    const tWanted = t0 + d.tcaHours * 3600e3;

    if (d.target.type === 'partner') {
      const partner = partners.get(d.target.id)!;
      const pi = partner.spec.inclinationDeg * DEG, praan = partner.spec.raanDeg * DEG;
      const line = unit(cross(planeNormal(i, raan), planeNormal(pi, praan)));
      const r1 = RE + s.altitudeKm;
      const p1: Vec3 = [line[0] * r1, line[1] * r1, line[2] * r1];
      prim.kep = throughPoint(r1, i, raan, p1, 0, tWanted, t0);
      // Slightly eccentric partner orbit with a different period, so the two
      // satellites do not meet again on every revolution.
      partner.kep = throughPointEccentric(r1 + d.radialKm, 9, 0.002, pi, praan, p1, d.alongKm, tWanted, t0);
      partner.spec = { ...partner.spec, altitudeKm: partner.kep.a - RE };
      designs.push({ key: d.key, primaryId: s.id, secondaryId: partner.spec.id, plannedTca: tWanted });
      continue;
    }

    const tgt = d.target;
    const candidates = objects
      .filter((o) => tgt.kinds.includes(o.kind) && recs[o.idx] && !usedTargets.has(o.norad))
      .filter((o) => (tgt.norad ? o.norad === tgt.norad : true))
      .filter((o) => (tgt.name ? tgt.name.test(o.name) : true))
      .filter((o) => o.perigeeKm < s.altitudeKm + 40 && o.apogeeKm > s.altitudeKm - 40)
      .sort((a, b) => a.norad - b.norad);
    let done = false;
    for (const o of candidates) {
      const hit = findPlaneCrossing(recs[o.idx]!, i, raan, tWanted, s.altitudeKm, tgt.norad ? 60 : 30);
      if (!hit) continue;
      const radius = norm(hit.r) + d.radialKm;
      prim.kep = throughPoint(radius, i, raan, hit.r, d.alongKm, hit.t, t0);
      prim.spec = { ...s, altitudeKm: radius - RE };
      usedTargets.add(o.norad);
      designs.push({ key: d.key, primaryId: s.id, secondaryId: catalogId(o.norad), plannedTca: hit.t });
      done = true;
      break;
    }
    if (!done) console.warn(`scenario: no target found for design ${d.key}`);
  }

  return { fleet: [...fleet.values()], partners: [...partners.values()], designs };
}

export function keplerPosition(k: Kep, t: number): Vec3 {
  return stateAt(k, t).r;
}
