import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCatalog, toSatrec, type CatalogSnapshot } from '../src/data/catalog';
import { buildScenario, catalogId, DESIGNS } from '../src/sim/scenario';
import { altitudeRange, screen, type ScreenSecondary } from '../src/orbit/screening';
import { encounter, formatPc } from '../src/orbit/pc';

const snapshot = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8')) as CatalogSnapshot;
const objects = parseCatalog(snapshot);
const recs = objects.map((o) => { try { return toSatrec(o); } catch { return null; } });

describe('scenario + screening', () => {
  const t0 = Date.parse(snapshot.medianEpoch) + 3 * 3600e3;
  const sc = buildScenario({ t0, objects, recs });

  it('resolves every designed encounter', () => {
    expect(sc.designs.map((d) => d.key).sort()).toEqual(DESIGNS.map((d) => d.key).sort());
  });

  it('screening rediscovers the designed encounters', () => {
    const primaries = sc.fleet.map((f) => ({ id: f.spec.id, body: { type: 'kep' as const, kep: f.kep }, ...altitudeRange(f.kep) }));
    const secondaries: ScreenSecondary[] = [
      ...objects.filter((o) => recs[o.idx]).map((o) => ({ id: catalogId(o.norad), body: { type: 'sgp4' as const, rec: recs[o.idx]! }, perigeeKm: o.perigeeKm, apogeeKm: o.apogeeKm })),
      ...sc.partners.map((p) => ({ id: p.spec.id, body: { type: 'kep' as const, kep: p.kep }, ...altitudeRange(p.kep) })),
    ];
    const t = performance.now();
    const hits = screen(primaries, secondaries, { t0, t1: t0 + 24 * 3600e3, stepS: 60, thresholdKm: 5 });
    console.log(`screened in ${(performance.now() - t).toFixed(0)} ms, ${hits.length} hits`);
    for (const d of sc.designs) {
      const h = hits.filter((x) => x.primaryId === d.primaryId && x.secondaryId === d.secondaryId).sort((a, b) => Math.abs(a.tca - d.plannedTca) - Math.abs(b.tca - d.plannedTca))[0];
      expect(h, `design ${d.key}`).toBeTruthy();
      const g = encounter(h!.primary.r, h!.primary.v, h!.secondary.r, h!.secondary.v, [0.008, 0.03, 0.008], [0.06, 0.3, 0.06], 0.005);
      console.log(d.key, d.primaryId, d.secondaryId, `miss ${(h!.missKm * 1000).toFixed(0)} m`, `vrel ${g.relSpeedKms.toFixed(2)}`, `Pc ${formatPc(g.pc)}`, `dt ${((h!.tca - d.plannedTca) / 1000).toFixed(1)} s`);
      expect(Math.abs(h!.tca - d.plannedTca)).toBeLessThan(120e3);
    }
    for (const d of sc.designs) expect(hits.filter((x) => x.primaryId === d.primaryId && x.secondaryId === d.secondaryId).length, `repeat ${d.key}`).toBe(1);
    const incidental = hits.filter((h) => !sc.designs.some((d) => d.primaryId === h.primaryId && d.secondaryId === h.secondaryId));
    console.log('incidental <5km:', incidental.length, 'under 1km:', incidental.filter((h) => h.missKm < 1).length);
  }, 120_000);
});
