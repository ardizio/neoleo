import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCatalog, type CatalogSnapshot } from '../src/data/catalog';
import { FLEET, PARTNER_FLEET } from '../src/data/company';
import { Engine } from '../src/sim/engine';
import { DESIGNS } from '../src/sim/scenario';
import { issueCdm, type Alert } from '../src/sim/alerts';
import { catalogRef, fleetRef } from '../src/sim/refs';
import { formatPc } from '../src/orbit/pc';
import { parseKvn, summarize } from '../src/orbit/cdm';

const snapshot = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8')) as CatalogSnapshot;
const objects = parseCatalog(snapshot);

describe('designed alerts', () => {
  const t0 = Date.parse(snapshot.medianEpoch) + 3 * 3600e3;
  const eng = new Engine(objects, t0);
  eng.build();
  const hits = eng.screenDesigned();

  it('produces the intended severity story', () => {
    const final: Record<string, string> = {};
    for (const d of eng.designs) {
      const h = hits.find((x) => x.primaryId === d.primaryId && x.secondaryId === d.secondaryId)!;
      expect(h, d.key).toBeTruthy();
      const design = DESIGNS.find((x) => x.key === d.key)!;
      const primSpec = FLEET.find((f) => f.id === d.primaryId)!;
      const sec = d.secondaryId.startsWith('C')
        ? catalogRef(objects.find((o) => `C${o.norad}` === d.secondaryId)!)
        : fleetRef(PARTNER_FLEET.find((p) => p.id === d.secondaryId)!);
      const alert: Alert = {
        id: d.key, primary: fleetRef(primSpec), secondary: sec, type: sec.cls === 'PARTNER' ? 'ACTIVE_ACTIVE' : 'ACTIVE_PASSIVE',
        tca: h.tca, truth: { primary: h.primary, secondary: h.secondary }, cdms: [], pendingPlan: [], releasedAt: 0, status: 'new', unread: true,
      };
      const line: string[] = [];
      for (const step of design.plan) {
        const now = t0 + (design.releaseSec + step.atSec) * 1000;
        const c = issueCdm(alert, step, now);
        alert.cdms.push(c);
        line.push(`${c.severity}:${formatPc(c.geometry.pc)}@${(c.geometry.missKm * 1000).toFixed(0)}m`);
        const s = summarize(parseKvn(c.kvn));
        expect(Math.abs(s.missKm - c.geometry.missKm)).toBeLessThan(1e-3);
        expect(s.obj2.name).toBe(sec.name);
      }
      final[d.key] = alert.cdms[alert.cdms.length - 1].severity;
      console.log(d.key, d.primaryId, sec.name, line.join('  →  '));
    }
    expect(final).toEqual({ A: 'critical', B: 'critical', C: 'warning', D: 'critical', E: 'warning', F: 'warning' });
  });
});
