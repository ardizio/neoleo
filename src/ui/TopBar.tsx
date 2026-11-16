import { useRef, useState } from 'react';
import { ORG } from '../data/company';
import { clock, store, useStore } from '../state/store';
import { speedLabel, utc } from './format';
import { IconDb, IconTarget, IconUpload, LogoMark } from './icons';

const WORDMARK = `${import.meta.env.BASE_URL}brand/neoleo-wordmark-color.svg`;

const HOLD_MS = 5000;

/** Hard refresh for phones / home-screen apps: drop Cache Storage and service workers, reload index.html from a new URL. Settings (localStorage) are kept. */
async function hardReload() {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    if (navigator.serviceWorker) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
  } finally {
    sessionStorage.setItem('hardReloaded', '1');
    location.replace(`${location.pathname}?reload=${Date.now()}`);
  }
}

/** Logo · time (tap = back to now) · tracked object. Map and time controls live in the map bar. Hold the logo 5 s = clear cache and reload. */
export function TopBar() {
  const s = useStore();
  const now = clock.now();
  const live = s.speed === 1 && Math.abs(now - Date.now()) < 3000;
  const sel = s.selected;
  const tracked = !sel ? null : sel.type === 'fleet' ? store.fleetSpec(sel.id)?.name : s.objects[sel.idx]?.name;
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const startHold = () => { setHolding(true); timer.current = window.setTimeout(() => void hardReload(), HOLD_MS); };
  const endHold = () => { clearTimeout(timer.current); setHolding(false); };
  return (
    <header className="topbar">
      <div className={`brand ${holding ? 'holding' : ''}`} aria-label="NeoLEO (hold 5 seconds to clear cache and reload)" title="Hold 5 s to clear cache and reload"
        onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold} onContextMenu={(e) => e.preventDefault()}>
        <span className="brand-mark">
          <LogoMark size={26} />
          <svg className="brand-ring" viewBox="0 0 36 36" aria-hidden><circle cx="18" cy="18" r="16" pathLength="100" /></svg>
        </span>
        <img className="brand-word" src={WORDMARK} alt="NeoLEO" draggable={false} />
        <span className="brand-sep" />
        <span className="org-chip" title="Organisation">
          <span className="org-dot" />
          {ORG.name}
        </span>
      </div>
      <nav className="topnav">
        <button className="nav-item active">Operations</button>
        <button className="nav-item" onClick={() => store.set({ modal: 'sources' })}>
          <IconDb size={15} /> Data sources
        </button>
        <button className="nav-item" onClick={() => store.set({ modal: 'ingest' })}>
          <IconUpload size={15} /> Ingest CDM
        </button>
      </nav>
      <button className={`time-block ${live ? 'is-live' : s.speed < 0 ? 'rewind' : 'sim'}`} onClick={() => store.goLive()} title="Back to current time">
        <span className="time-main mono">{utc(now)} <span className="utc">UTC</span></span>
        <span className="time-sub"><span className="live-dot" /> {new Date(now).toISOString().slice(5, 10)} · {speedLabel(s.speed, live)}</span>
      </button>
      <div className="topbar-right">
        {tracked && (
          <button className={`tracked ${s.followSelected ? 'on' : ''}`} onClick={() => store.set({ followSelected: !s.followSelected })} title={s.followSelected ? 'Stop camera tracking' : 'Track with camera'}>
            <IconTarget size={15} />
            <span>{tracked}</span>
          </button>
        )}
        <div className="user">
          <div className="avatar">{ORG.user.initials}</div>
          <div className="user-meta">
            <div className="user-name">{ORG.user.name}</div>
            <div className="user-role">{ORG.user.role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
