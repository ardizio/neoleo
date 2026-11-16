import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GlobeScene } from '../globe/scene';
import { clock, store, useStore, visibleAlerts } from '../state/store';
import { latest } from '../sim/alerts';
import { formatPc, SEVERITY_LABEL } from '../orbit/pc';
import { meanMotion, RE, stateAt } from '../orbit/kepler';
import { objectType, sgp4State } from '../data/catalog';
import { norm } from '../orbit/vec';
import { countdown, meters, speedLabel, stepSpeed } from './format';
import { IconAlert, IconClose, IconForward, IconLayers, IconMap, IconMinus, IconPause, IconPhoto, IconPlay, IconPlus, IconRewind, IconRotate, IconTarget } from './icons';
import { ORG, PARTNER_ORG } from '../data/company';
import { Toasts } from './Overlays';
import { FusionPanel, trackFor } from './FusionPanel';

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
    <div className={`globe-wrap ${s.earthStyle}`}>
      <div ref={host} className="globe-host" />
      {/* One stack pinned under the top bar: critical banner first, notifications (e.g. manoeuvre accepted) right under it, or alone at the top. */}
      <div className="top-stack">
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
      <Toasts />
      </div>
      <MapBar />
      <div className="legend">
        <span><i className="lg own" /> {ORG.name}</span>
        <span><i className="lg partner" /> {PARTNER_ORG.name}</span>
        <span><i className="lg payload" /> Active satellites</span>
        <span><i className="lg debris" /> Debris</span>
        <span><i className="lg alert" /> At risk</span>
      </div>
      <ObjectCard />
    </div>
  );
}

/** One bar for every map and time option: zoom, home, rotation, imagery, time (rewind / pause / faster / now) and layers. */
function MapBar() {
  const s = useStore();
  const now = clock.now();
  const live = s.speed === 1 && Math.abs(now - Date.now()) < 3000;
  return (
    <div className="map-bar" role="toolbar" aria-label="Map and time controls">
      <div className="mb-group">
        <button onClick={() => sceneRef?.zoom(1.4)} aria-label="Zoom out"><IconMinus size={18} /></button>
        <button onClick={() => sceneRef?.zoom(0.7)} aria-label="Zoom in"><IconPlus size={18} /></button>
        <button className={s.autoRotate ? 'on' : ''} aria-pressed={s.autoRotate} title={s.autoRotate ? 'Stop rotation' : 'Reset view and rotate'} aria-label={s.autoRotate ? 'Stop rotation' : 'Reset view and rotate'}
          onClick={() => { if (s.autoRotate) { store.set({ autoRotate: false }); return; } store.select(null); store.openAlert(null); sceneRef?.resetView(); store.set({ autoRotate: true }); }}>
          <IconRotate size={18} />
        </button>
        <button onClick={() => store.setEarthStyle(s.earthStyle === 'photo' ? 'map' : 'photo')} aria-label={s.earthStyle === 'photo' ? 'Map view' : 'Satellite imagery'}>
          {s.earthStyle === 'photo' ? <IconMap size={18} /> : <IconPhoto size={18} />}
        </button>
      </div>
      <div className="mb-group">
        <button className={s.speed < 0 ? 'on' : ''} onClick={() => store.setSpeed(stepSpeed(s.speed, -1))} aria-label="Slower / rewind"><IconRewind size={18} /></button>
        <button onClick={() => store.setSpeed(s.speed === 0 ? 1 : 0)} aria-label={s.speed === 0 ? 'Play' : 'Pause'}>{s.speed === 0 ? <IconPlay size={18} /> : <IconPause size={18} />}</button>
        <button className={s.speed > 1 ? 'on' : ''} onClick={() => store.setSpeed(stepSpeed(s.speed, 1))} aria-label="Faster"><IconForward size={18} /></button>
        <button className={`mb-now ${live ? 'is-live' : s.speed < 0 ? 'rewind' : ''}`} onClick={() => store.goLive()} aria-label="Back to current time" title="Back to current time">
          <span className="live-dot" /><span className="mb-long">{speedLabel(s.speed, live)}</span><span className="mb-short">{live ? 'Live' : s.speed === 0 ? 'Pause' : `${s.speed < 0 ? '−' : ''}${Math.abs(s.speed)}×`}</span>
        </button>
      </div>
      <div className="mb-group">
        <button onClick={() => store.set({ modal: 'settings' })} aria-label="Layers and settings"><IconLayers size={18} /></button>
      </div>
    </div>
  );
}

/**
 * Details panel. Desktop: floating card. Phones: iOS-style bottom sheet with a grab handle,
 * snapping to peek (name + one line, globe stays visible) / half / full; drag down past peek to close.
 */
function Sheet({ title, sub, summary, onClose, children }: { title: string; sub: string; summary?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('peek');
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const phone = () => matchMedia('(max-width: 760px)').matches;
  const heights = () => {
    const H = ref.current?.parentElement?.clientHeight ?? 600;
    return { peek: 104, half: Math.round(H * 0.52), full: Math.round(H * 0.94) };
  };
  useLayoutEffect(() => {
    const el = ref.current, host = el?.parentElement;
    if (!el || !host) return;
    if (!phone()) { el.style.height = ''; return; }
    el.style.height = `${heights()[snap]}px`;
    host.style.setProperty('--sheet-peek', `${heights().peek}px`);
    return () => { host.style.removeProperty('--sheet-peek'); };
  }, [snap]);
  const down = (e: React.PointerEvent) => {
    if (!phone() || !ref.current || (e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, h: ref.current.offsetHeight, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ref.current.classList.add('dragging');
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    ref.current.style.height = `${Math.max(40, Math.min(heights().full, d.h - dy))}px`;
  };
  const up = () => {
    const d = drag.current, el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    el.classList.remove('dragging');
    const hs = heights();
    if (!d.moved) { setSnap(snap === 'peek' ? 'half' : 'peek'); return; }
    const h = el.offsetHeight;
    if (h < hs.peek * 0.7) { onClose(); return; }
    const best = (Object.keys(hs) as (keyof typeof hs)[]).reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a));
    el.style.height = `${hs[best]}px`;
    setSnap(best);
  };
  return (
    <div ref={ref} className={`obj-card sheet snap-${snap}`}>
      <div className="sheet-top" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="sheet-handle" aria-hidden />
        <div className="obj-card-head">
          <div>
            <div className="obj-card-title">{title}</div>
            <div className="obj-card-sub">{sub}</div>
            {summary && <div className="sheet-summary mono">{summary}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={16} /></button>
        </div>
      </div>
      <div className="sheet-body">{children}</div>
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
  let plan = '';
  let track = null as ReturnType<typeof trackFor> | null;
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
      ['Launched', String(f.spec.launchYear)],
      ['End of mission (ETA)', String(f.spec.launchYear + f.spec.lifeYears)],
      ['Disposal', f.spec.disposal],
    ];
    plan = f.spec.disposalPlan;
    alertsFor = f.spec.id;
    track = trackFor(f.spec.id, f.spec.norad, meanMotion(f.kep.a), (t) => stateAt(f.kep, t), now, true);
  } else {
    const o = s.objects[sel.idx];
    const st = sgp4State(store.satrec(o), now);
    title = o.name;
    sub = `${objectType(o)} · ${o.intlId}`;
    rows = [
      ['NORAD', String(o.norad)],
      ['Altitude', st ? `${(norm(st.r) - RE).toFixed(1)} km` : '—'],
      ['Velocity', st ? `${norm(st.v).toFixed(3)} km/s` : '—'],
      ['Perigee / apogee', `${o.perigeeKm.toFixed(0)} / ${o.apogeeKm.toFixed(0)} km`],
      ['Inclination', `${o.inclination.toFixed(2)}°`],
      ['Period', `${o.periodMin.toFixed(1)} min`],
      ['Element epoch', `${o.epoch.slice(0, 16).replace('T', ' ')} UTC`],
    ];
    const rec = store.satrec(o);
    track = trackFor(`c${o.norad}`, o.norad, (2 * Math.PI) / (o.periodMin * 60), (t) => sgp4State(rec, t), now, o.kind === 'PAYLOAD');
  }
  const related = alertsFor ? visibleAlerts(s).filter((a) => a.primary.id === alertsFor && a.status !== 'resolved' && a.tca > now && latest(a).severity !== 'monitor') : [];
  const alt = rows.find(([k]) => k === 'Altitude')?.[1];
  const summary = [alt, track && (track.nSources ? `seen by ${track.nSources} source${track.nSources > 1 ? 's' : ''}` : 'catalog only'), track && `±${meters(track.sigmaM[track.sigmaM.length - 1] / 1000)}`].filter(Boolean).join(' · ');
  return (
    <Sheet key={JSON.stringify(sel)} title={title} sub={sub} summary={summary} onClose={() => store.select(null)}>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
        ))}
      </dl>
      {plan && <p className="hint"><strong>Disposal plan:</strong> {plan}</p>}
      {track && <FusionPanel r={track} />}
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
    </Sheet>
  );
}
