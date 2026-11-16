// Offline validation demo: runs NeoLEO's own Pc code (src/orbit) on real public data, in the browser.
import { parseKvn, pcFromCdm } from '../src/orbit/cdm';
import { severityOf } from '../src/orbit/pc';
import caraCsv from '../tests/fixtures/cara/cara_pc.csv?raw';
import kelvins from './data/kelvins-t2.json';

const cdms = import.meta.glob('../tests/fixtures/cara/*.cdm', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const byId = Object.fromEntries(Object.entries(cdms).map(([k, v]) => [k.split('/').pop()!.replace('.cdm', ''), v]));
const cases = caraCsv.trim().split('\n').slice(1).map((l) => {
  const [id, hbr, ref] = l.split(',');
  return { id, hbr: Number(hbr), ref: Number(ref) };
});

const $ = (id: string) => document.getElementById(id)!;
const fmt = (x: number) => (x > 0 ? x.toExponential(3) : '0');
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function runCara() {
  const t0 = performance.now();
  const rows = cases.map((c) => {
    const text = byId[c.id];
    const o = parseKvn(text).objects;
    const pc = pcFromCdm(text, c.hbr) ?? NaN;
    return { ...c, pc, rel: Math.abs(pc - c.ref) / c.ref, names: `${o[0]?.OBJECT_NAME ?? '?'} × ${o[1]?.OBJECT_NAME ?? '?'}`, date: c.id.split('_')[3] };
  });
  const ms = performance.now() - t0;
  const act = rows.filter((r) => r.ref >= 1e-7);
  const worst = Math.max(...act.map((r) => r.rel));
  const med = [...rows].sort((a, b) => a.rel - b.rel)[Math.floor(rows.length / 2)].rel;
  $('cara-sum').innerHTML = `<b>${rows.length}</b> real CDMs recomputed in <b>${ms.toFixed(0)} ms</b>. Median gap to NASA <b>${(med * 100).toFixed(3)}%</b>. Worst gap where Pc ≥ 1e-7 (${act.length} cases): <b>${(worst * 100).toFixed(2)}%</b>.`;
  $('cara-body').innerHTML = rows.sort((a, b) => b.ref - a.ref).map((r) => `<tr><td>${esc(r.names)}</td><td>${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}</td><td class="n">${fmt(r.ref)}</td><td class="n">${fmt(r.pc)}</td><td class="n ${r.rel < 0.01 ? 'ok' : 'bad'}">${r.rel < 0.01 ? '✓' : '✗'} ${(r.rel * 100).toFixed(2)}%</td></tr>`).join('');
  $('cara-out').hidden = false;
}

function runOwn(text: string) {
  const out = $('own-out');
  const o = parseKvn(text);
  const pc = pcFromCdm(text);
  const cdmPc = Number(o.header.COLLISION_PROBABILITY);
  if (pc === null) { out.innerHTML = '<span class="bad">Could not compute: need two objects with states, RTN covariance and a <code>COMMENT HBR = … [m]</code> line.</span>'; return; }
  const rel = Number.isFinite(cdmPc) && cdmPc > 0 ? Math.abs(pc - cdmPc) / cdmPc : NaN;
  out.innerHTML = `${esc(o.objects[0]?.OBJECT_NAME ?? '?')} × ${esc(o.objects[1]?.OBJECT_NAME ?? '?')}: Pc in the CDM <b>${Number.isFinite(cdmPc) ? fmt(cdmPc) : '—'}</b> · recomputed by NeoLEO <b>${fmt(pc)}</b>${Number.isFinite(rel) ? ` <span class="${rel < 0.01 ? 'ok' : 'bad'}">${rel < 0.01 ? '✓' : '≠'} ${(rel * 100).toFixed(2)}% apart</span>` : ''}`;
}

function runEsa() {
  const action = (s: string) => s === 'critical' || s === 'warning';
  let high = 0, flagged = 0, caught = 0, fa = 0;
  for (const [, , eRisk, eMiss, fRisk, fMiss] of kelvins.rows as number[][]) {
    const early = severityOf(10 ** eRisk, eMiss / 1000), fin = severityOf(10 ** fRisk, fMiss / 1000);
    if (action(fin)) high++;
    if (action(early)) { flagged++; if (action(fin)) caught++; else fa++; }
  }
  const n = kelvins.rows.length;
  $('esa-sum').innerHTML = `
    <div class="tile"><b>${n.toLocaleString()}</b><span>real conjunction events</span></div>
    <div class="tile"><b>${caught} / ${high}</b><span>high-risk events caught 2 days ahead (${pct(caught, high)})</span></div>
    <div class="tile warn"><b>${high - caught}</b><span>high-risk events missed</span></div>
    <div class="tile warn"><b>${fa} / ${flagged}</b><span>alerts that were false alarms (${pct(fa, flagged)})</span></div>`;
  $('esa-out').hidden = false;
}

$('cara-run').onclick = runCara;
$('esa-run').onclick = runEsa;
$('own-sample').onclick = () => { const t = byId['000020580_conj_000022015_20210315_212955_20210313_065123']; ($('own-text') as HTMLTextAreaElement).value = t; runOwn(t); };
$('own-text').oninput = (e) => runOwn((e.target as HTMLTextAreaElement).value);
($('own-file') as HTMLInputElement).onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) { const t = await f.text(); ($('own-text') as HTMLTextAreaElement).value = t; runOwn(t); }
};
