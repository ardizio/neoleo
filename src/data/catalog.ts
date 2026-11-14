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
}

export const CATALOG_URL = `${import.meta.env.BASE_URL}data/catalog.json`;

export async function loadCatalog(): Promise<{ snapshot: CatalogSnapshot; objects: CatalogObject[] }> {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  const snapshot = (await res.json()) as CatalogSnapshot;
  return { snapshot, objects: parseCatalog(snapshot) };
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
