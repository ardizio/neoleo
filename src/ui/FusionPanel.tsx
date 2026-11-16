import { useState } from 'react';
import { trackObject, DT, STEPS, type SensorKind, type StateFn, type TrackReport } from '../orbit/tracking';

const COL: Record<SensorKind, string> = { radar: '#2a78d6', optical: '#eb6834', gps: '#1baf7a' };
const LABEL: Record<SensorKind, string> = { radar: 'Ground radar', optical: 'Ground optical', gps: 'Onboard GPS (operator)' };

const cache = new Map<string, TrackReport>();
/** One report per object per 30 min of (sim) time: the fusion takes ~0.1-0.3 s. */
export function trackFor(key: string, seed: number, meanMotion: number, state: StateFn, now: number, gps: boolean): TrackReport {
  const bucket = Math.floor(now / 1_800_000) * 1_800_000;
  const k = `${key}:${bucket}`;
  let r = cache.get(k);
  if (!r) {
    if (cache.size > 50) cache.clear();
    r = trackObject({ seed, meanMotion, state, now: bucket, gps });
    cache.set(k, r);
  }
  return r;
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

function Mark({ kind, size = 10 }: { kind: SensorKind; size?: number }) {
  const h = size / 2, c = COL[kind];
  return (
    <svg width={size} height={size} aria-hidden="true" style={{ flex: 'none' }}>
      {kind === 'radar' ? <polygon points={`${h},0 ${size},${size} 0,${size}`} fill={c} />
        : kind === 'optical' ? <circle cx={h} cy={h} r={h} fill={c} />
        : <polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} fill={c} />}
    </svg>
  );
}

function Check({ ok, title, detail }: { ok: boolean | null; title: string; detail: string }) {
  return (
    <div className="fz-check">
      <b className={ok == null ? 'na' : ok ? 'ok' : 'bad'}>{ok == null ? '–' : ok ? '✓' : '✗'}</b>
      <div><div>{title}</div><div className="fz-muted">{detail}</div></div>
    </div>
  );
}

function Chart({ r }: { r: TrackReport }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 310, h = 150, L = 42, R = 8, Tp = 6, B = 40;
  const hi = Math.max(...r.sigmaM, ...r.errM, 10) * 1.5;
  const X = (k: number) => L + (k / (STEPS - 1)) * (w - L - R);
  const Y = (m: number) => Tp + (1 - Math.log10(Math.max(m, 1)) / Math.log10(hi)) * (h - Tp - B);
  const K = (t: number) => (t - r.t0) / (DT * 1000);
  const line = (a: number[]) => a.map((m, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(m).toFixed(1)}`).join('');
  const sy = h - B + 18;
  const ticks = [];
  for (let e = 0; 10 ** e <= hi; e++) ticks.push(10 ** e);
  const at = hover ?? STEPS - 1, tAt = r.t0 + at * DT * 1000;
  const seeing = [...new Set(r.passes.filter((p) => p.t0 <= tAt && tAt <= p.t1).map((p) => LABEL[p.kind]))];
  const blocked = [...new Set(r.obstructions.filter((b) => b.t0 <= tAt && tAt <= b.t1).map((b) => b.reason))];
  return (
    <div className="fz-chart">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Fused position uncertainty and true error over the last 6 hours"
        onMouseMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); const k = Math.round((((e.clientX - b.left) / b.width) * w - L) / (w - L - R) * (STEPS - 1)); setHover(Math.max(0, Math.min(STEPS - 1, k))); }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((m) => (
          <g key={m}><line x1={L} x2={w - R} y1={Y(m)} y2={Y(m)} stroke="var(--line)" /><text x={L - 5} y={Y(m) + 4} textAnchor="end" className="fz-ax">{fmtM(m)}</text></g>
        ))}
        {[0, 120, 240, 359].map((k) => <text key={k} x={X(k)} y={h - B + 12} textAnchor={k === 359 ? 'end' : 'middle'} className="fz-ax">{hhmm(r.t0 + k * DT * 1000)}</text>)}
        {r.obstructions.map((b, i) => <rect key={'b' + i} x={X(K(b.t0))} y={sy + 10} width={Math.max(2, X(K(b.t1)) - X(K(b.t0)))} height={5} rx={2} fill="var(--line-2)" />)}
        {r.passes.map((p, i) => <rect key={'p' + i} x={X(K(p.t0))} y={sy} width={Math.max(2, X(K(p.t1)) - X(K(p.t0)))} height={7} rx={2} fill={COL[p.kind]} />)}
        <text x={2} y={sy + 7} className="fz-ax">seen</text>
        <text x={2} y={sy + 16} className="fz-ax">blocked</text>
        <path d={line(r.errM)} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" />
        <path d={line(r.sigmaM)} fill="none" stroke="var(--ink)" strokeWidth={2} />
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={Tp} y2={h - B} stroke="var(--muted)" />}
      </svg>
      <div className="fz-legend">
        <span><i style={{ borderTop: '2px solid var(--ink)' }} /> fused 1σ</span>
        <span><i style={{ borderTop: '2px dashed var(--muted)' }} /> true error (sim.)</span>
      </div>
      <div className="fz-readout mono">
        {hhmm(tAt)} UTC · 1σ {fmtM(r.sigmaM[at])} · error {fmtM(r.errM[at])}
        {seeing.length > 0 && <div>seen by: {seeing.join(', ')}</div>}
        {blocked.length > 0 && <div className="fz-muted">blocked: {blocked.join('; ')}</div>}
      </div>
    </div>
  );
}

/** "Tracking & fusion" block of the object card: count of sources (no names), fused path, validation, where/how, obstructions. */
export function FusionPanel({ r }: { r: TrackReport }) {
  const v = r.validation, n = r.nSources;
  const badge = n === 0 ? 'Not seen by any sensor in the last 6 h: catalog prediction only'
    : n === 1 ? 'Seen by 1 source, refined by NeoLEO fusion'
    : `Seen by ${n} independent sources, fused by NeoLEO`;
  return (
    <div className="fz">
      <div className="fz-badge">{badge}</div>
      <div className="fz-chips">
        {r.sensorTypes.map((k) => <span key={k}><Mark kind={k} /> {LABEL[k]}</span>)}
      </div>
      <div className="fz-muted">
        {v.nUsed} measurements in one most-probable path{v.nRejected ? `, ${v.nRejected} rejected as inconsistent` : ''}. Uncertainty now <b className="mono">±{fmtM(r.sigmaM[STEPS - 1])}</b> (1σ). Simulated sensor feed.
      </div>
      <Chart r={r} />

      <div className="fz-h">Validation</div>
      <Check ok={v.nUsed ? v.nisOk : null} title="Stated errors are honest" detail={v.nisMean == null ? 'No measurements to test.' : `Mean normalised innovation ${v.nisMean.toFixed(2)} (expected ≈ 3).`} />
      <Check ok={v.loso == null ? null : v.loso >= 0.9} title="Independent sources confirm the path" detail={v.loso == null ? 'Needs at least 2 sources.' : `Path rebuilt without each source predicts it within 3σ: worst ${Math.round(v.loso * 100)} %.`} />
      <Check ok={v.nRejected ? true : null} title="Bad measurements removed" detail={`${v.nRejected} point(s) dropped as inconsistent with the fused path.`} />
      <Check ok={v.nUsed ? v.truthCover >= 0.95 : null} title="Truth check (simulation only)"
        detail={`Error ${fmtM(v.truthRmsM)} RMS vs ${v.bestSingleRmsM ? `${fmtM(v.bestSingleRmsM)} best single source, ` : ''}${fmtM(v.priorRmsM)} catalog only; inside 3σ ${Math.round(v.truthCover * 100)} % of the time.`} />

      <details className="fz-det">
        <summary>Where and how it was seen ({r.passes.length})</summary>
        {r.passes.length ? (
          <table className="fz-table">
            <thead><tr><th>UTC</th><th>Sensor · where</th><th>Elev.</th><th>σ</th><th>Pts</th></tr></thead>
            <tbody>
              {r.passes.map((p, i) => (
                <tr key={i}>
                  <td className="mono">{hhmm(p.t0)}–{hhmm(p.t1)}</td>
                  <td>
                    <span className="fz-sensor"><Mark kind={p.kind} /> {LABEL[p.kind]}</span>
                    <div className="fz-muted">{p.where}{p.km != null && ` · closest ${p.km} km`}</div>
                    {p.notes.map((t) => <div key={t} className="fz-note">{t}</div>)}
                  </td>
                  <td className="mono">{p.el ? `${p.el[0]}–${p.el[1]}°` : '–'}</td>
                  <td className="mono">{p.sigM[0] === p.sigM[1] ? p.sigM[0] : `${p.sigM[0]}–${p.sigM[1]}`} m</td>
                  <td className="mono">{p.n - p.rejected}{p.rejected > 0 && <span className="fz-warn"> ⚠−{p.rejected}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="fz-muted">No sensor contact.</div>}
      </details>
      <details className="fz-det">
        <summary>Obstructions ({r.obstructions.length})</summary>
        <div className="fz-muted">Object above the horizon but not usable.</div>
        {r.obstructions.length > 0 && (
          <table className="fz-table">
            <thead><tr><th>UTC</th><th>Sensor · where</th><th>Why</th></tr></thead>
            <tbody>
              {r.obstructions.map((b, i) => (
                <tr key={i}>
                  <td className="mono">{hhmm(b.t0)}–{hhmm(b.t1)}</td>
                  <td><span className="fz-sensor"><Mark kind={b.kind} /> {LABEL[b.kind]}</span><div className="fz-muted">{b.where}</div></td>
                  <td>{b.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
