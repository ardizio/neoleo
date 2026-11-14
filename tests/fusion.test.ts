import { describe, expect, it } from 'vitest';
import { fuseCI, GATE_D2, mahalanobis2, type Estimate } from '../src/orbit/fusion';
import { toRtn, sub, type Vec3 } from '../src/orbit/vec';

const r: Vec3 = [6900, 0, 0];
const v: Vec3 = [0, 7.6, 0];
const est = (dRtn: Vec3, sigma: Vec3, source: string): Estimate => ({ r: [r[0] + dRtn[0], r[1] + dRtn[1], r[2] + dRtn[2]], v, sigma, source });

describe('multi-source fusion', () => {
  const catalog = est([0, 0, 0], [0.06, 0.32, 0.06], 'PUB-GP');
  const radar = est([0.02, 0.1, 0], [0.02, 0.08, 0.02], 'CTR-X');

  it('weights the more precise source and never claims more than either alone', () => {
    const f = fuseCI([catalog, radar]);
    expect(f.weights[1]).toBeGreaterThan(f.weights[0]);
    const d = toRtn(sub(f.r, r), r, v);
    expect(d[1]).toBeGreaterThan(0.05); // pulled toward the radar along-track
    for (let k = 0; k < 3; k++) expect(f.sigma[k]).toBeLessThanOrEqual(Math.max(catalog.sigma[k], radar.sigma[k]) + 1e-12);
  });

  it('identical sources (fully correlated) do not shrink the uncertainty', () => {
    const f = fuseCI([radar, { ...radar, source: 'CTR-X copy' }]);
    f.sigma.forEach((s, k) => expect(s).toBeCloseTo(radar.sigma[k], 12));
  });

  it('gate passes consistent estimates and rejects a 5 km outlier', () => {
    expect(mahalanobis2(catalog, radar)).toBeLessThan(GATE_D2);
    expect(mahalanobis2(catalog, est([0, 5, 0], [0.02, 0.08, 0.02], 'BAD'))).toBeGreaterThan(GATE_D2);
  });
});
