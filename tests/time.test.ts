import { describe, expect, it } from 'vitest';
import { speedLabel, stepSpeed } from '../src/ui/format';

describe('time stepper', () => {
  it('steps through rewind and fast-forward, resumes from pause', () => {
    expect(stepSpeed(1, -1)).toBe(-1); // first tap on rewind
    expect(stepSpeed(-1, -1)).toBe(-10);
    expect(stepSpeed(-3600, -1)).toBe(-3600); // clamped
    expect(stepSpeed(-10, 1)).toBe(-1);
    expect(stepSpeed(-1, 1)).toBe(1); // never lands on 0 (pause has its own button)
    expect(stepSpeed(600, 1)).toBe(3600);
    expect(stepSpeed(0, 1)).toBe(1);
    expect(stepSpeed(0, -1)).toBe(-1);
    expect(speedLabel(-60, false)).toBe('Rewind 60×');
    expect(speedLabel(1, true)).toBe('Live');
    expect(speedLabel(0, false)).toBe('Paused');
  });
});

import { objectVisible } from '../src/data/catalog';
describe('type + altitude filter', () => {
  const L = { payload: true, debris: true, rocket: true, defunct: true, altMin: 450, altMax: 650 } as never;
  const o = (name: string, kind: string, perigeeKm: number, apogeeKm: number) => ({ name, kind, perigeeKm, apogeeKm }) as never;
  it('keeps objects whose orbit crosses the band and respects type switches', () => {
    expect(objectVisible(o('X', 'PAYLOAD', 500, 520), L)).toBe(true);
    expect(objectVisible(o('X', 'PAYLOAD', 300, 460), L)).toBe(true); // apogee inside band
    expect(objectVisible(o('X', 'PAYLOAD', 700, 900), L)).toBe(false);
    expect(objectVisible(o('X DEB', 'DEBRIS', 500, 520), { ...(L as object), debris: false } as never)).toBe(false);
    expect(objectVisible(o('SL-8 R/B', 'DEBRIS', 500, 520), { ...(L as object), rocket: false } as never)).toBe(false);
  });
});
