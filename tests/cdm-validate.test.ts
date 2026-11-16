import { describe, expect, it } from 'vitest';
import { validateCdm } from '../src/orbit/cdm';

const obj = (n: number, extra = '') => `OBJECT = OBJECT${n}
OBJECT_DESIGNATOR = 4${n}000
OBJECT_NAME = SAT ${n}
REF_FRAME = EME2000
X = 6900.1 [km]
Y = 0 [km]
Z = 10 [km]
X_DOT = 0 [km/s]
Y_DOT = 7.6 [km/s]
Z_DOT = 0.1 [km/s]
CR_R = 400 [m**2]
CT_T = 10000 [m**2]
CN_N = 400 [m**2]
${extra}`;
const good = `CCSDS_CDM_VERS = 1.0
CREATION_DATE = 2099-01-01T00:00:00
ORIGINATOR = TEST
MESSAGE_ID = T-1
TCA = 2099-01-02T00:00:00.000
MISS_DISTANCE = 120 [m]
RELATIVE_SPEED = 10000 [m/s]
COLLISION_PROBABILITY = 1.2e-4
${obj(1)}
${obj(2)}`;

describe('CDM validation', () => {
  it('accepts a complete message', () => {
    const v = validateCdm(good);
    expect(v.ok).toBe(true);
    expect(v.checks.filter((c) => c.level !== 'ok')).toEqual([]);
  });
  it('blocks a message without TCA or second object, warns on junk lines and missing covariance', () => {
    const v = validateCdm(good.replace(/TCA = .*\n/, '').split('OBJECT = OBJECT2')[0].replace('CR_R = 400 [m**2]', '') + 'garbage line\n');
    expect(v.ok).toBe(false);
    const by = Object.fromEntries(v.checks.map((c) => [c.label, c.level]));
    expect(by['Time of closest approach']).toBe('error');
    expect(by.Objects).toBe('error');
    expect(by['Object 1 covariance']).toBe('warn');
    expect(by['Unrecognised lines']).toBe('warn');
  });
  it('rejects Pc outside 0–1', () => {
    expect(validateCdm(good.replace('1.2e-4', '3')).ok).toBe(false);
  });
});
