import { ORG, PLATFORM } from '../data/company';
import { clock, store, useStore } from '../state/store';
import { utc } from './format';
import { IconDb, IconPause, IconPlay, IconSliders, IconUpload, LogoMark } from './icons';

const SPEEDS = [1, 10, 60, 600];

export function TopBar() {
  const s = useStore();
  const now = clock.now();
  const live = s.speed === 1 && Math.abs(now - Date.now()) < 3000;
  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <span className="brand-name">{PLATFORM.name}</span>
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
      <div className="topbar-right">
        <div className="time-block">
          <div className="time-main mono">{utc(now)} <span className="muted utc">UTC</span></div>
          <div className="time-sub">{new Date(now).toISOString().slice(0, 10)} · {live ? 'Live' : `Simulated ×${s.speed}`}</div>
        </div>
        <div className="speed" role="group" aria-label="Simulation speed">
          <button className={`speed-btn ${s.speed === 0 ? 'on' : ''}`} onClick={() => store.setSpeed(s.speed === 0 ? 1 : 0)} title={s.speed === 0 ? 'Resume' : 'Pause'}>
            {s.speed === 0 ? <IconPlay size={14} /> : <IconPause size={14} />}
          </button>
          {SPEEDS.map((v) => (
            <button key={v} className={`speed-btn ${s.speed === v ? 'on' : ''}`} onClick={() => store.setSpeed(v)}>
              {v === 1 ? '1×' : `${v}×`}
            </button>
          ))}
          <button className={`live-btn ${live ? 'is-live' : ''}`} onClick={() => store.goLive()}>
            <span className="live-dot" /> Live
          </button>
        </div>
        <button className="bell" onClick={() => store.set({ modal: 'settings' })} aria-label="Settings" title="Settings">
          <IconSliders size={19} />
        </button>
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
