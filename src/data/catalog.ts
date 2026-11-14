import { json2satrec, propagate, type SatRec } from 'satellite.js';
import { MU, RE } from '../orbit/kepler';
import type { Vec3 } from '../orbit/vec';

export type ObjectKind = 'PAYLOAD' | 'DEBRIS' | 'DEFUNCT';

export interface CatalogSnapshot {
  source: string;
  fetchedAt: string;
  medianEpoch: string;
  fields: string[];
  rows: (string | number)[][];
}

export interface CatalogObject {
  idx: number;
  name: string;
  intlId: string;
  norad: number;
  epoch: string;
  kind: ObjectKind;
  inclination: number; // deg
  perigeeKm: number;
  apogeeKm: number;
  periodMin: number;
  omm: Record<string, string | number>;
  /** Generated demo fragment (no catalog entry). */
  generated?: boolean;
}

export const CATALOG_URL = `${import.meta.env.BASE_URL}data/catalog.json?v=${import.meta.env.VITE_CATALOG_VERSION}`;

export async function loadCatalog(): Promise<{ snapshot: CatalogSnapshot; objects: CatalogObject[] }> {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  const snapshot = (await res.json()) as CatalogSnapshot;
  return { snapshot, objects: withGenerated(parseCatalog(snapshot)) };
}

export const SYNTHETIC_DEBRIS = 10_000;

/** Real objects followed by the generated fragments, re-indexed. Used by the page and the propagator worker. */
export function withGenerated(objects: CatalogObject[]): CatalogObject[] {
  return [...objects, ...syntheticDebris(objects).map((o, k) => ({ ...o, idx: objects.length + k }))];
}

/**
 * Demo debris: copies of real LEO debris orbits with jittered plane, phase and altitude.
 * Deterministic (fixed seed) so page and worker agree on indices. Appended after the real
 * objects; the screening engine only sees the real catalog.
 */
export function syntheticDebris(objects: CatalogObject[], count = SYNTHETIC_DEBRIS): CatalogObject[] {
  const parents = objects.filter((o) => o.kind === 'DEBRIS' && o.apogeeKm < 2000);
  if (!parents.length) return [];
  let seed = 0x5eed;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const wrap = (x: number) => ((x % 360) + 360) % 360;
  return Array.from({ length: count }, (_, k) => {
    const p = parents[Math.floor(rnd() * parents.length)];
    const omm = {
      ...p.omm,
      MEAN_ANOMALY: wrap(Number(p.omm.MEAN_ANOMALY) + rnd() * 360),
      RA_OF_ASC_NODE: wrap(Number(p.omm.RA_OF_ASC_NODE) + (rnd() - 0.5) * 6),
      INCLINATION: Number(p.omm.INCLINATION) + (rnd() - 0.5) * 0.6,
      MEAN_MOTION: Number(p.omm.MEAN_MOTION) * (1 + (rnd() - 0.5) * 0.004),
    };
    const n = (omm.MEAN_MOTION * 2 * Math.PI) / 86400;
    const a = Math.cbrt(MU / (n * n));
    const ecc = Number(p.omm.ECCENTRICITY);
    return { ...p, idx: -1, norad: 900_000 + k, inclination: omm.INCLINATION, perigeeKm: a * (1 - ecc) - RE, apogeeKm: a * (1 + ecc) - RE, periodMin: 1440 / omm.MEAN_MOTION, omm, generated: true };
  });
}

export function parseCatalog(snapshot: CatalogSnapshot): CatalogObject[] {
  const f = snapshot.fields;
  const kindIdx = f.indexOf('KIND');
  return snapshot.rows.map((row, idx) => {
    const omm: Record<string, string | number> = {};
    f.forEach((name, k) => {
      if (k !== kindIdx) omm[name] = row[k];
    });
    const mm = Number(omm.MEAN_MOTION); // rev/day
    const ecc = Number(omm.ECCENTRICITY);
    const n = (mm * 2 * Math.PI) / 86400;
    const a = Math.cbrt(MU / (n * n));
    return {
      idx,
      name: String(omm.OBJECT_NAME),
      intlId: String(omm.OBJECT_ID),
      norad: Number(omm.NORAD_CAT_ID),
      epoch: String(omm.EPOCH),
      kind: row[kindIdx] as ObjectKind,
      inclination: Number(omm.INCLINATION),
      perigeeKm: a * (1 - ecc) - RE,
      apogeeKm: a * (1 + ecc) - RE,
      periodMin: 1440 / mm,
      omm,
    };
  });
}

export function toSatrec(o: CatalogObject): SatRec {
  // CelesTrak omits these; satellite.js validates them when present only.
  return json2satrec(o.omm as never);
}

export function sgp4State(rec: SatRec, t: number): { r: Vec3; v: Vec3 } | null {
  const pv = propagate(rec, new Date(t));
  if (!pv || !pv.position || !pv.velocity) return null;
  const p = pv.position as { x: number; y: number; z: number };
  const v = pv.velocity as { x: number; y: number; z: number };
  if (!Number.isFinite(p.x)) return null;
  return { r: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
}

export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO';
export function regimeOf(o: { perigeeKm: number; apogeeKm: number }): OrbitRegime {
  if (o.apogeeKm < 2000) return 'LEO';
  if (o.perigeeKm > 34000 && o.apogeeKm < 37500) return 'GEO';
  if (o.apogeeKm - o.perigeeKm > 10000) return 'HEO';
  return 'MEO';
}

/** Shape shown when zoomed in: payload, debris, rocket body or dead payload. */
export type Shape = 'payload' | 'debris' | 'rocket' | 'defunct';
export function shapeOf(o: Pick<CatalogObject, 'kind' | 'name'>): Shape {
  if (o.kind === 'PAYLOAD') return 'payload';
  if (/\bR\/B\b|\bAKM\b|\bPKM\b|STAGE|\bPLAT\b/.test(o.name)) return 'rocket';
  return o.kind === 'DEBRIS' ? 'debris' : 'defunct';
}
export function objectType(o: Pick<CatalogObject, 'kind' | 'name'>): string {
  return { payload: 'Active payload', debris: 'Debris fragment', rocket: 'Rocket body', defunct: 'Defunct object' }[shapeOf(o)];
}
