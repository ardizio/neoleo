// Screening engine used by the web worker (and by tests in Node).
import type { SatRec } from 'satellite.js';
import type { CatalogObject } from '../data/catalog';
import { toSatrec } from '../data/catalog';
import { altitudeRange, screen, type ScreenPrimary, type ScreenSecondary, type ScreeningHit } from '../orbit/screening';
import { buildScenario, catalogId, type FleetOrbit, type ResolvedDesign } from './scenario';

export const SCREEN_WINDOW_H = 24;
export const SCREEN_THRESHOLD_KM = 5;

export class Engine {
  recs: (SatRec | null)[];
  fleet: FleetOrbit[] = [];
  partners: FleetOrbit[] = [];
  designs: ResolvedDesign[] = [];
  secondaries: ScreenSecondary[] = [];

  constructor(public objects: CatalogObject[], public t0: number) {
    this.recs = objects.map((o) => {
      try {
        return toSatrec(o);
      } catch {
        return null;
      }
    });
  }

  build() {
    const sc = buildScenario({ t0: this.t0, objects: this.objects, recs: this.recs });
    this.fleet = sc.fleet;
    this.partners = sc.partners;
    this.designs = sc.designs;
    this.secondaries = [
      ...this.objects
        .filter((o) => this.recs[o.idx])
        .map((o) => ({ id: catalogId(o.norad), body: { type: 'sgp4' as const, rec: this.recs[o.idx]! }, perigeeKm: o.perigeeKm, apogeeKm: o.apogeeKm })),
      ...this.partners.map((p) => ({ id: p.spec.id, body: { type: 'kep' as const, kep: p.kep }, ...altitudeRange(p.kep) })),
    ];
    return sc;
  }

  primaries(): ScreenPrimary[] {
    return this.fleet.map((f) => ({ id: f.spec.id, body: { type: 'kep' as const, kep: f.kep }, ...altitudeRange(f.kep) }));
  }

  /** Fast pass over the pairs announced by incoming CDMs. */
  screenDesigned(): ScreeningHit[] {
    const out: ScreeningHit[] = [];
    const prim = this.primaries();
    for (const d of this.designs) {
      const p = prim.find((x) => x.id === d.primaryId)!;
      const s = this.secondaries.find((x) => x.id === d.secondaryId)!;
      const hits = screen([p], [s], { t0: d.plannedTca - 3600e3, t1: d.plannedTca + 3600e3, stepS: 60, thresholdKm: SCREEN_THRESHOLD_KM });
      const best = hits.sort((a, b) => Math.abs(a.tca - d.plannedTca) - Math.abs(b.tca - d.plannedTca))[0];
      if (best) out.push(best);
    }
    return out;
  }

  /** Full catalog sweep in chunks so results can stream to the UI. */
  *screenAll(chunkH = 3): Generator<{ hits: ScreeningHit[]; fraction: number }> {
    const prim = this.primaries();
    const seen: ScreeningHit[] = [];
    for (let h = 0; h < SCREEN_WINDOW_H; h += chunkH) {
      // Chunks overlap by two steps so a TCA on a boundary is not lost.
      const hits = screen(prim, this.secondaries, {
        t0: this.t0 + h * 3600e3 - 60e3,
        t1: this.t0 + Math.min(SCREEN_WINDOW_H, h + chunkH) * 3600e3 + 60e3,
        stepS: 60,
        thresholdKm: SCREEN_THRESHOLD_KM,
      }).filter((x) => !seen.some((y) => y.primaryId === x.primaryId && y.secondaryId === x.secondaryId && Math.abs(y.tca - x.tca) < 120e3));
      seen.push(...hits);
      yield { hits, fraction: Math.min(1, (h + chunkH) / SCREEN_WINDOW_H) };
    }
  }

  /** Screen one modified primary orbit (post-maneuver check). */
  screenCustom(primary: ScreenPrimary, t0: number, hours: number): ScreeningHit[] {
    return screen([primary], this.secondaries, { t0, t1: t0 + hours * 3600e3, stepS: 60, thresholdKm: SCREEN_THRESHOLD_KM });
  }

  candidateCount(): number {
    const prim = this.primaries();
    const lo = Math.min(...prim.map((p) => p.perigeeKm)) - 25;
    const hi = Math.max(...prim.map((p) => p.apogeeKm)) + 25;
    return this.secondaries.filter((s) => s.perigeeKm < hi && s.apogeeKm > lo).length;
  }
}
