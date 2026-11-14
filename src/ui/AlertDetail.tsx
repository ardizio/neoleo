import { clock, store, useStore } from '../state/store';
import { latest, type Alert, type CdmRecord } from '../sim/alerts';
import { SEVERITY_LABEL, formatPc } from '../orbit/pc';
import { DATA_SOURCES, flag } from '../data/company';

import { countdown, meters, utc, utcShort } from './format';
import { BPlane } from './BPlane';
import { ManeuverPanel } from './ManeuverPanel';
import { statusText, typeLabel } from './AlertsPanel';
import { IconBack, IconCheck, IconTarget } from './icons';

export const SEV_HEX = { critical: '#e5383b', warning: '#f08c00', watch: '#c99700', monitor: '#7d8a9c' } as const;

export function AlertDetail() {
  const s = useStore();
  const a = s.alerts.find((x) => x.id === s.selectedAlertId);
  if (!a) return null;
  const c = latest(a);
  const now = clock.now();
  const st = statusText(a, s);
  const plan = s.plans[a.id];
  const chosen = plan?.options.find((o) => o.id === plan.selectedId);
  const g = c.geometry;
  const hbrKm = (a.primary.hbrM + a.secondary.hbrM) / 1000;

  return (
    <aside className="panel right wide detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={() => store.openAlert(null)} aria-label="Back to alerts"><IconBack size={18} /></button>
        <span className={`sev-pill ${c.severity} big`}>{SEVERITY_LABEL[c.severity]}</span>
        <span className="ac-type">{typeLabel(a)}</span>
        <span className="detail-id mono">{a.id}</span>
      </div>
      <div className="detail-scroll">
        <section className="d-hero">
          <div className="d-names">
            <ObjChip name={a.primary.name} sub={`NORAD ${a.primary.norad} · ${a.primary.operator}`} kind="own" />
            <span className="d-x">×</span>
            <ObjChip
              name={a.secondary.name}
              sub={`NORAD ${a.secondary.norad} · ${a.secondary.cls === 'PARTNER' ? a.secondary.operator : a.secondary.cls === 'DEBRIS' ? 'Debris, not maneuverable' : a.secondary.cls === 'DEFUNCT' ? 'Defunct, not maneuverable' : 'Third-party operator'}`}
              kind={a.secondary.cls.toLowerCase()}
            />
          </div>
          <div className="d-tca">
            <div>
              <div className="m-label">Time to closest approach</div>
              <div className={`d-count mono ${c.severity}`}>{countdown(a.tca - now)}</div>
            </div>
            <div className="d-tca-utc">
              <div className="m-label">TCA</div>
              <div className="mono">{utc(a.tca, true)} UTC</div>
              <button className="link-btn" onClick={() => { store.openAlert(null); store.openAlert(a.id); }}>
                <IconTarget size={14} /> Focus on globe
              </button>
            </div>
          </div>
          <div className={`ac-status ${st.tone} d-status`}><span className="st-dot" /> {st.text}</div>
        </section>

        <section className="d-metrics">
          <Metric label="Collision probability" value={formatPc(g.pc)} strong trend={a.cdms.map((x) => x.geometry.pc)} />
          <Metric label="Miss distance" value={meters(g.missKm)} strong />
          <Metric label="Relative speed" value={`${g.relSpeedKms.toFixed(2)} km/s`} />
          <Metric label="Radial" value={meters(g.relPosRtn[0])} />
          <Metric label="In-track" value={meters(g.relPosRtn[1])} />
          <Metric label="Cross-track" value={meters(g.relPosRtn[2])} />
          <Metric label="Approach angle" value={`${g.approachAngleDeg.toFixed(0)}°`} />
          <Metric label="Combined HBR" value={`${(hbrKm * 1000).toFixed(1)} m`} />
          <Metric label="σ combined (1σ)" value={`${meters(g.sigmaMajorKm)} × ${meters(g.sigmaMinorKm)}`} />
        </section>

        <ManeuverPanel alert={a} />

        <section className="card">
          <div className="card-title">Encounter geometry</div>
          <BPlane g={g} hbrKm={hbrKm} color={SEV_HEX[c.severity]} after={chosen?.result.geometry ?? null} />
          {chosen && <div className="hint">Green marker: predicted miss after the selected maneuver ({meters(chosen.result.missKm)}, Pc {formatPc(chosen.result.pc)}).</div>}
        </section>

        <section className="card">
          <div className="card-title">Data fusion <span className="muted">· {c.sources.length} of {DATA_SOURCES.length} feeds in latest solution</span></div>
          <div className="fusion">
            {DATA_SOURCES.filter((d) => c.sources.includes(d.id)).map((d) => (
              <div key={d.id} className="fusion-row used">
                <span className="fusion-check"><IconCheck size={13} /></span>
                <span className="fusion-name"><span className="flag">{flag(d.country)}</span> {d.name}</span>
                <span className="fusion-kind">{d.kind}</span>
                <span className={`src-status ${d.status}`}>{d.status}</span>
              </div>
            ))}
          </div>
          <div className="sigma-row mono">
            <span>σ {a.secondary.name.length > 18 ? 'secondary' : a.secondary.name} R/T/N: {c.sigmaSecondary.map((x) => (x * 1000).toFixed(0)).join(' / ')} m</span>
            <span>σ {a.primary.name} R/T/N: {c.sigmaPrimary.map((x) => (x * 1000).toFixed(0)).join(' / ')} m</span>
          </div>
        </section>

        <section className="card">
          <div className="card-title">CDM history <span className="muted">· CCSDS 508.0-B-1</span></div>
          <CdmHistory a={a} />
          {a.pendingPlan.length > 0 && <div className="hint">Further tracking updates expected from the data feeds.</div>}
        </section>
      </div>
    </aside>
  );
}

function ObjChip({ name, sub, kind }: { name: string; sub: string; kind: string }) {
  return (
    <div className={`obj-chip ${kind}`}>
      <span className="obj-dot" />
      <div>
        <div className="obj-name">{name}</div>
        <div className="obj-sub">{sub}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, strong, trend }: { label: string; value: string; strong?: boolean; trend?: number[] }) {
  return (
    <div className={`metric ${strong ? 'strong' : ''}`}>
      <div className="m-label">{label}</div>
      <div className="m-val mono">{value}</div>
      {trend && trend.length > 1 && <Spark values={trend} />}
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const lv = values.map((v) => Math.log10(Math.max(v, 1e-12)));
  const lo = Math.min(...lv, -8), hi = Math.max(...lv, -3);
  const W = 120, H = 22;
  const pts = lv.map((v, k) => `${(k / (lv.length - 1)) * (W - 6) + 3},${H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-label="Pc trend across CDMs">
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.6" />
      {pts.map((p, k) => <circle key={k} cx={p.split(',')[0]} cy={p.split(',')[1]} r="2.2" fill="currentColor" />)}
    </svg>
  );
}

function CdmHistory({ a }: { a: Alert }) {
  const rows = [...a.cdms].reverse();
  return (
    <div className="cdm-list">
      {rows.map((c: CdmRecord) => (
        <div key={c.messageId} className="cdm-row">
          <span className={`sev-bar ${c.severity}`} />
          <div className="cdm-main">
            <div className="cdm-top">
              <span className="mono">#{c.seq} · {c.messageId}</span>
              <span className="muted mono">{utcShort(c.created)} UTC</span>
            </div>
            <div className="cdm-note">{c.note}</div>
            <div className="cdm-vals mono">Pc {formatPc(c.geometry.pc)} · miss {meters(c.geometry.missKm)} · {c.sources.length} sources</div>
          </div>
          <button className="ghost-btn" onClick={() => store.set({ modal: { cdm: { alertId: a.id, seq: c.seq } } })}>View CDM</button>
        </div>
      ))}
    </div>
  );
}
