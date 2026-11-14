import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCatalog, type CatalogSnapshot } from '../src/data/catalog';
import { Engine } from '../src/sim/engine';
import { planAvoidance, PC_TARGET, type SatBudget } from '../src/orbit/maneuver';
import { sigmaFor } from '../src/sim/alerts';
import { formatPc } from '../src/orbit/pc';
import type { FleetSpec } from '../src/data/company';

const snapshot = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8')) as CatalogSnapshot;
const objects = parseCatalog(snapshot);
const budget = (s: FleetSpec): SatBudget => ({ id: s.id, name: s.name, operator: s.owner, massKg: s.massKg, propellantKg: s.propellantKg, ispS: s.ispS, thrustN: s.thrustN, priority: s.priority });

describe('maneuver planner', () => {
  const t0 = Date.parse(snapshot.medianEpoch) + 3 * 3600e3;
  const eng = new Engine(objects, t0);
  eng.build();
  const hits = eng.screenDesigned();

  for (const key of ['A', 'B', 'D']) {
    it(`finds a plan below Pc target for design ${key}`, () => {
      const d = eng.designs.find((x) => x.key === key)!;
      const h = hits.find((x) => x.primaryId === d.primaryId && x.secondaryId === d.secondaryId)!;
      const prim = eng.fleet.find((f) => f.spec.id === d.primaryId)!;
      const sec = eng.secondaries.find((s) => s.id === d.secondaryId)!;
      const partner = eng.partners.find((p) => p.spec.id === d.secondaryId);
      const hours = (h.tca - t0) / 3600e3;
      const t = performance.now();
      const opts = planAvoidance({
        now: t0, tca: h.tca,
        primary: { kep: prim.kep, budget: budget(prim.spec) },
        secondary: { body: sec.body, budget: partner ? budget(partner.spec) : undefined },
        sigP: sigmaFor('OWN', hours, 1), sigS: sigmaFor(partner ? 'PARTNER' : 'DEBRIS', hours, 0.8), hbrKm: 0.008,
      });
      console.log(key, `${(performance.now() - t).toFixed(0)} ms`);
      for (const o of opts) console.log('  ', o.recommended ? '*' : ' ', o.label, o.burns.map((b) => `${b.satName} ${b.dvMs.toFixed(3)} m/s @T-${((h.tca - b.time) / 60e3).toFixed(0)}min ${b.propellantG.toFixed(1)} g`).join(' + '), `miss ${(o.result.missKm * 1000).toFixed(0)} m Pc ${formatPc(o.result.pc)}`);
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.every((o) => o.result.pc < PC_TARGET)).toBe(true);
      if (partner) expect(opts.find((o) => o.recommended)!.strategy).toBe('shared');
    });
  }
});
