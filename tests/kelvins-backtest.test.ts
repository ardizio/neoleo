// Back-test of our alert rule on real ESA CDM series (Kelvins Collision Avoidance Challenge, CC BY 4.0,
// https://zenodo.org/records/4463683). Data not in the repo: set KELVINS_DIR to the folder holding
// test_data.csv + test_data_private.csv, else this test is skipped.
// Rule under test: severity from the latest CDM issued >= 2 days before TCA (what an operator has when
// deciding), scored against the final CDM's risk.
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { severityOf, type Severity } from '../src/orbit/pc';

const dir = process.env.KELVINS_DIR;

const rows = (f: string) => {
  const [head, ...lines] = fs.readFileSync(f, 'utf8').trim().split('\n');
  const h = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [h[i], v])));
};

test.skipIf(!dir)('alert rule at T-2 days vs final ESA risk', () => {
  const latest = new Map<string, Record<string, string>>();
  for (const r of rows(`${dir}/test_data.csv`)) {
    const cur = latest.get(r.event_id);
    if (!cur || Number(r.time_to_tca) < Number(cur.time_to_tca)) latest.set(r.event_id, r);
  }
  const action = (s: Severity) => s === 'critical' || s === 'warning';
  let n = 0, finalHigh = 0, caught = 0, flagged = 0, falseAlarm = 0, critEarly = 0, critFinal = 0, critBoth = 0;
  for (const p of rows(`${dir}/test_data_private.csv`)) {
    const e = latest.get(p.event_id);
    if (!e) continue;
    n++;
    const early = severityOf(10 ** Number(e.risk), Number(e.miss_distance) / 1000);
    const fin = severityOf(10 ** Number(p.true_risk), Number(p.miss_distance) / 1000);
    if (action(fin)) finalHigh++;
    if (action(early)) { flagged++; if (action(fin)) caught++; else falseAlarm++; }
    if (early === 'critical') critEarly++;
    if (fin === 'critical') { critFinal++; if (early === 'critical') critBoth++; }
  }
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
  console.log(`events ${n} · final Pc >= 1e-5: ${finalHigh} · flagged at T-2d: ${flagged}`);
  console.log(`caught ${caught}/${finalHigh} (${pct(caught, finalHigh)}) · false alarms ${falseAlarm}/${flagged} (${pct(falseAlarm, flagged)}) · critical early ${critEarly}, final ${critFinal}, both ${critBoth}`);
  expect(n).toBe(2167);
});
