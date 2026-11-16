import { describe, expect, it } from 'vitest';
import { trackObject } from '../src/orbit/tracking';
import { circular, meanMotion, RE, stateAt } from '../src/orbit/kepler';

const NOW = Date.UTC(2026, 10, 15, 12);
const deg = Math.PI / 180;
const cases = [
  { alt: 550, inc: 53, raan: 10, u: 0, gps: true },
  { alt: 780, inc: 86, raan: 120, u: 40, gps: true },
  { alt: 600, inc: 98, raan: 200, u: 90, gps: false },
  { alt: 850, inc: 74, raan: 300, u: 180, gps: false },
  { alt: 500, inc: 45, raan: 60, u: 270, gps: false },
  { alt: 700, inc: 65, raan: 160, u: 320, gps: false },
];

describe('multi-source tracking fusion', () => {
  const reports = cases.map((c, i) => {
    const kep = circular(RE + c.alt, c.inc * deg, c.raan * deg, c.u * deg, NOW);
    return trackObject({ seed: 100 + i, meanMotion: meanMotion(kep.a), state: (t) => stateAt(kep, t), now: NOW, gps: c.gps });
  });

  it('beats the catalog, keeps honest uncertainty, and is confirmed by held-out sources', () => {
    for (const r of reports) {
      const v = r.validation;
      if (!v.nUsed) continue;
      expect(v.truthRmsM).toBeLessThan(v.priorRmsM);
      expect(v.truthCover).toBeGreaterThanOrEqual(0.9);
      if (v.loso != null) expect(v.loso).toBeGreaterThanOrEqual(0.85);
      if (r.nSources >= 2 && v.bestSingleRmsM) expect(v.truthRmsM).toBeLessThanOrEqual(1.15 * v.bestSingleRmsM);
    }
  });

  it('catches injected low-elevation outliers and logs obstructions', () => {
    const bad = reports.reduce((s, r) => s + r.validation.injectedBad, 0);
    const caught = reports.reduce((s, r) => s + r.validation.caughtBad, 0);
    expect(bad).toBeGreaterThan(0);
    expect(caught).toBeGreaterThanOrEqual(0.6 * bad);
    expect(reports.some((r) => r.nSources >= 2)).toBe(true);
    expect(reports.every((r) => r.obstructions.every((o) => o.reason.length > 0))).toBe(true);
  });
});
