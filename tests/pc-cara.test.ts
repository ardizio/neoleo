// Validates our 2D Pc against NASA CARA reference values on real CDMs (tests/fixtures/cara/README.md).
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { pcFromCdm } from '../src/orbit/cdm';

const dir = 'tests/fixtures/cara';
const rows = fs.readFileSync(`${dir}/cara_pc.csv`, 'utf8').trim().split('\n').slice(1).map((l) => {
  const [id, hbr, noAdj] = l.split(',');
  return { id, hbr: Number(hbr), ref: Number(noAdj) };
});

test('2D Pc matches NASA CARA Pc2D (no TCA adjustment) on real CDMs', () => {
  const out = rows.map((r) => {
    const pc = pcFromCdm(fs.readFileSync(`${dir}/${r.id}.cdm`, 'utf8'), r.hbr)!;
    return { id: r.id.slice(0, 26), ref: r.ref, pc, rel: Math.abs(pc - r.ref) / r.ref };
  });
  const worst = [...out].sort((a, b) => b.rel - a.rel);
  console.log(`CARA cases ${out.length} · median rel err ${worst[Math.floor(out.length / 2)].rel.toExponential(1)} · worst ${worst[0].rel.toExponential(1)} (${worst[0].id}: ${worst[0].pc.toExponential(3)} vs ${worst[0].ref.toExponential(3)})`);
  const act = worst.filter((o) => o.ref >= 1e-7);
  console.log(`actionable (Pc >= 1e-7): ${act.length} cases · worst rel err ${act[0].rel.toExponential(1)}`);
  expect(out.length).toBeGreaterThan(50);
  for (const o of out) expect(o.rel, o.id).toBeLessThan(0.01);
});
