import { useMemo, useState } from 'react';
import { clock, store, useStore, visibleAlerts } from '../state/store';
import { latest, type Alert } from '../sim/alerts';
import { RE } from '../orbit/kepler';
import type { Severity } from '../orbit/pc';
import { ORG, PARTNER_ORG } from '../data/company';
import { countdown } from './format';
import { IconDb, IconLink, IconMore, IconSearch, IconUpload } from './icons';

const SEV_RANK: Record<Severity, number> = { critical: 3, warning: 2, watch: 1, monitor: 0 };

/** ⋯ menu: fleet data in and out (CDM ingest, API, feeds). */
function FleetMenu() {
  const [open, setOpen] = useState(false);
  const go = (modal: 'ingest' | 'api' | 'sources') => { setOpen(false); store.set({ modal }); };
  return (
    <div className="more">
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Fleet data options" aria-expanded={open}><IconMore size={18} /></button>
      {open && (
        <>
          <div className="more-scrim" onClick={() => setOpen(false)} />
          <div className="more-menu" role="menu">
            <button role="menuitem" onClick={() => go('ingest')}><IconUpload size={15} /> Ingest CDM</button>
            <button role="menuitem" onClick={() => go('api')}><IconLink size={15} /> API access</button>
            <button role="menuitem" onClick={() => go('sources')}><IconDb size={15} /> Data sources</button>
          </div>
        </>
      )}
    </div>
  );
}

export function FleetPanel() {
  const s = useStore();
  const [q, setQ] = useState('');
  const now = clock.now();

  const worst = useMemo(() => {
    const m = new Map<string, Alert>();
    for (const a of visibleAlerts(s)) {
      if (a.status === 'resolved' || a.tca < now) continue;
      const sev = latest(a).severity;
      if (sev === 'monitor') continue;
      const cur = m.get(a.primary.id);
      if (!cur || SEV_RANK[sev] > SEV_RANK[latest(cur).severity] || (SEV_RANK[sev] === SEV_RANK[latest(cur).severity] && a.tca < cur.tca)) m.set(a.primary.id, a);
    }
    return m;
  }, [s.alerts, s.tick]);

  const query = q.trim().toUpperCase();
  const fleet = s.fleet.filter((f) => !query || f.spec.name.includes(query) || f.spec.id.includes(query));
  const groups = ['Earth observation', 'SAR imaging', 'IoT relay'] as const;
  const catalogMatches = query.length >= 2
    ? s.objects.filter((o) => !o.generated && (o.name.includes(query) || String(o.norad) === query)).slice(0, 30)
    : [];
  const sel = s.selected;

  return (
    <aside className="panel left">
      <div className="panel-head">
        <div>
          <div className="eyebrow">{ORG.name}</div>
          <h2>My fleet</h2>
        </div>
        <div className="fleet-head-right">
          <div className="fleet-count">
            <span className="mono">{s.fleet.length}</span> satellites
          </div>
          <FleetMenu />
        </div>
      </div>
      <div className="search">
        <IconSearch size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fleet or catalog (name, NORAD)" />
      </div>
      <div className="fleet-scroll">
        {groups.map((g) => {
          const items = fleet.filter((f) => f.spec.mission === g);
          if (!items.length) return null;
          return (
            <div key={g} className="fleet-group">
              <div className="group-title">{g} <span>{items.length}</span></div>
              {items.map((f) => {
                const a = worst.get(f.spec.id);
                const sev = a ? latest(a).severity : null;
                const active = sel?.type === 'fleet' && sel.id === f.spec.id;
                return (
                  <button key={f.spec.id} className={`fleet-row ${active ? 'active' : ''}`} onClick={() => store.select({ type: 'fleet', id: f.spec.id })}>
                    <span className={`status-dot ${sev ?? 'nominal'}`} />
                    <span className="fleet-main">
                      <span className="fleet-name">{f.spec.name}</span>
                      <span className="fleet-sub mono">
                        {(f.kep.a - RE).toFixed(0)} km · {f.spec.inclinationDeg.toFixed(1)}°
                      </span>
                    </span>
                    {a ? (
                      <span
                        className={`fleet-alert ${sev}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          store.openAlert(a.id);
                        }}
                        title="Open alert"
                      >
                        <span className="mono">{countdown(a.tca - now)}</span>
                      </span>
                    ) : (
                      <span className="fleet-ok">Nominal</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
        {s.partners.length > 0 && !query && (
          <div className="fleet-group">
            <div className="group-title">Partner network · {PARTNER_ORG.name} <span>{s.partners.length}</span></div>
            <div className="partner-note">Cooperative operator. Ephemerides are shared and joint maneuvers are negotiated automatically.</div>
          </div>
        )}
        {catalogMatches.length > 0 && (
          <div className="fleet-group">
            <div className="group-title">Public catalog <span>{catalogMatches.length}</span></div>
            {catalogMatches.map((o) => (
              <button key={o.idx} className={`fleet-row compact ${sel?.type === 'catalog' && sel.idx === o.idx ? 'active' : ''}`} onClick={() => store.select({ type: 'catalog', idx: o.idx })}>
                <span className={`kind-dot ${o.kind.toLowerCase()}`} />
                <span className="fleet-main">
                  <span className="fleet-name">{o.name}</span>
                  <span className="fleet-sub mono">NORAD {o.norad} · {o.perigeeKm.toFixed(0)}–{o.apogeeKm.toFixed(0)} km</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
