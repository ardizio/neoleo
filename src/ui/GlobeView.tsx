import { useEffect, useRef } from 'react';
import { GlobeScene } from '../globe/scene';
import { clock, store, useStore, visibleAlerts } from '../state/store';
import { latest } from '../sim/alerts';
import { formatPc, SEVERITY_LABEL } from '../orbit/pc';
import { RE, stateAt } from '../orbit/kepler';
import { sgp4State } from '../data/catalog';
import { norm } from '../orbit/vec';
import { countdown, meters } from './format';
import { IconAlert, IconClose, IconHome, IconMinus, IconPlus, IconTarget } from './icons';
import { ORG, PARTNER_ORG } from '../data/company';
import { Toasts } from './Overlays';

let sceneRef: GlobeScene | null = null;

export function GlobeView() {
  const host = useRef<HTMLDivElement>(null);
  const s = useStore();
  useEffect(() => {
    if (!host.current) return;
    sceneRef = new GlobeScene(host.current);
    return () => {
      sceneRef?.dispose();
      sceneRef = null;
    };
  }, []);

  const now = clock.now();
  const open = visibleAlerts(s).filter((a) => a.status !== 'resolved' && a.tca > now);
  const top = open.filter((a) => latest(a).severity === 'critical' && !s.plans[a.id]?.sentAt).sort((a, b) => a.tca - b.tca)[0];

  return (
    <div className="globe-wrap">
      <div ref={host} className="globe-host" />
      {top && s.selectedAlertId !== top.id && (
        <button className="crit-banner" onClick={() => store.openAlert(top.id)}>
          <span className="crit-icon"><IconAlert size={18} /></span>
          <span className="crit-text">
            <strong>{SEVERITY_LABEL.critical} conjunction · {top.primary.name} × {top.secondary.name}</strong>
            <span>TCA in <span className="mono">{countdown(top.tca - now)}</span> · Pc {formatPc(latest(top).geometry.pc)} · miss {meters(latest(top).geometry.missKm)}</span>
          </span>
          <span className="crit-cta">Review</span>
        </button>
      )}
      <div className="globe-controls">
        <button onClick={() => sceneRef?.zoom(0.7)} aria-label="Zoom in"><IconPlus size={16} /></button>
        <button onClick={() => sceneRef?.zoom(1.4)} aria-label="Zoom out"><IconMinus size={16} /></button>
        <button onClick={() => { store.select(null); store.openAlert(null); sceneRef?.resetView(); store.set({ autoRotate: true }); }} aria-label="Reset view"><IconHome size={16} /></button>
        <button className={s.autoRotate ? 'on' : ''} onClick={() => store.set({ autoRotate: !s.autoRotate })} aria-label="Auto-rotate" title="Auto-rotate">⟳</button>
      </div>
      <div className="legend">
        <span><i className="lg own" /> {ORG.name}</span>
        <span><i className="lg partner" /> {PARTNER_ORG.name}</span>
        <span><i className="lg payload" /> Active satellites</span>
        <span><i className="lg debris" /> Debris</span>
        <span><i className="lg alert" /> At risk</span>
      </div>
      <ScreeningStatus />
      <Toasts />
      <ObjectCard />
    </div>
  );
}

function ScreeningStatus() {
  const s = useStore();
  const sc = s.screening;
  return (
    <div className={`screen-pill ${sc.done ? 'done' : ''}`}>
      {!sc.done && <span className="spinner" />}
      {sc.done ? (
        <span>Screening complete · {s.fleet.length} assets × {sc.candidates.toLocaleString()} objects · next 24 h</span>
      ) : (
        <span>Screening {s.fleet.length} assets × {sc.candidates.toLocaleString()} objects · <span className="mono">{Math.round(sc.fraction * 100)}%</span></span>
      )}
      <span className="pill-sep" />
      <span className="mono">{s.objects.length.toLocaleString()}</span> tracked
    </div>
  );
}

function ObjectCard() {
  const s = useStore();
  const sel = s.selected;
  if (!sel) return null;
  const now = clock.now();
  let title = '', sub = '', rows: [string, string][] = [];
  let alertsFor: string | null = null;
  if (sel.type === 'fleet') {
    const f = store.fleetOrbit(sel.id);
    if (!f) return null;
    const st = stateAt(f.kep, now);
    title = f.spec.name;
    sub = f.spec.owner === 'own' ? `${f.spec.mission} · ${ORG.name}` : `${f.spec.mission} · ${PARTNER_ORG.name} (partner)`;
    rows = [
      ['NORAD (sim.)', String(f.spec.norad)],
      ['Altitude', `${(norm(st.r) - RE).toFixed(1)} km`],
      ['Velocity', `${norm(st.v).toFixed(3)} km/s`],
      ['Inclination', `${f.spec.inclinationDeg.toFixed(2)}°`],
      ['Period', `${((2 * Math.PI * Math.sqrt(f.kep.a ** 3 / 398600.4418)) / 60).toFixed(1)} min`],
      ['Bus', f.spec.bus],
      ['Propellant', `${f.spec.propellantKg.toFixed(2)} kg · Isp ${f.spec.ispS} s`],
      ['Ephemeris', f.spec.owner === 'own' ? 'Owner GNSS (simulated)' : 'Partner-shared (simulated)'],
    ];
    alertsFor = f.spec.id;
  } else {
    const o = s.objects[sel.idx];
    const st = sgp4State(store.satrec(o), now);
    title = o.name;
    sub = `${o.kind === 'PAYLOAD' ? 'Active payload' : o.kind === 'DEBRIS' ? 'Debris fragment' : 'Defunct object'} · ${o.intlId}`;
    rows = [
      ['NORAD', String(o.norad)],
      ['Altitude', st ? `${(norm(st.r) - RE).toFixed(1)} km` : '—'],
      ['Velocity', st ? `${norm(st.v).toFixed(3)} km/s` : '—'],
      ['Perigee / apogee', `${o.perigeeKm.toFixed(0)} / ${o.apogeeKm.toFixed(0)} km`],
      ['Inclination', `${o.inclination.toFixed(2)}°`],
      ['Period', `${o.periodMin.toFixed(1)} min`],
      ['Element epoch', `${o.epoch.slice(0, 16).replace('T', ' ')} UTC`],
      ['Source', 'CelesTrak GP · SGP4'],
    ];
  }
  const related = alertsFor ? visibleAlerts(s).filter((a) => a.primary.id === alertsFor && a.status !== 'resolved' && a.tca > now && latest(a).severity !== 'monitor') : [];
  return (
    <div className="obj-card">
      <div className="obj-card-head">
        <div>
          <div className="obj-card-title">{title}</div>
          <div className="obj-card-sub">{sub}</div>
        </div>
        <button className="icon-btn" onClick={() => store.select(null)} aria-label="Close"><IconClose size={16} /></button>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
        ))}
      </dl>
      {related.length > 0 && (
        <div className="obj-alerts">
          {related.map((a) => (
            <button key={a.id} className={`mini-alert ${latest(a).severity}`} onClick={() => store.openAlert(a.id)}>
              <IconAlert size={13} /> {a.secondary.name} · <span className="mono">{countdown(a.tca - now)}</span>
            </button>
          ))}
        </div>
      )}
      <button className={`ghost-btn full ${s.followSelected ? 'on' : ''}`} onClick={() => store.set({ followSelected: !s.followSelected })}>
        <IconTarget size={14} /> {s.followSelected ? 'Stop tracking' : 'Track with camera'}
      </button>
    </div>
  );
}
