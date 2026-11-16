import { useState } from 'react';
import { Term } from './Term';
import { clock, store, useStore, visibleAlerts, type AppState } from '../state/store';
import { latest, type Alert } from '../sim/alerts';
import { SEVERITY_LABEL, formatPc, type Severity } from '../orbit/pc';
import { PARTNER_ORG, ORG } from '../data/company';
import { countdown, meters, utc } from './format';
import { AlertDetail } from './AlertDetail';

const ORDER: Severity[] = ['critical', 'warning', 'watch', 'monitor'];

export function statusText(a: Alert, s: AppState): { text: string; tone: 'idle' | 'busy' | 'ok' | 'action' } {
  const p = s.plans[a.id];
  const contact = `Matchmaking instantiated · in contact with ${a.secondary.operator}`;
  switch (a.status) {
    case 'computing':
      return { text: p?.auto ? `${contact} · computing joint plan` : 'Computing maneuver…', tone: 'busy' };
    case 'plan-ready':
      return { text: p?.auto ? 'Joint plan ready · sending' : 'Maneuver options ready', tone: 'action' };
    case 'sent-internal':
      return { text: p?.fdAck ? `Scheduled by ${ORG.flightDynamicsTeam}` : `Sent to ${ORG.flightDynamicsTeam}`, tone: 'ok' };
    case 'proposal-sent':
      return { text: `Awaiting ${PARTNER_ORG.name}`, tone: 'busy' };
    case 'agreed':
      return { text: `Joint maneuver agreed`, tone: 'ok' };
    case 'resolved':
      return { text: s.plans[a.id]?.executed ? 'Cleared by maneuver' : 'TCA passed', tone: 'idle' };
    default: {
      const sev = latest(a).severity;
      if (sev === 'critical' || sev === 'warning') return { text: a.type === 'ACTIVE_PASSIVE' ? 'Action required · compute avoidance' : contact, tone: 'action' };
      return { text: 'Monitoring', tone: 'idle' };
    }
  }
}

export function typeLabel(a: Alert) {
  if (a.secondary.cls === 'PARTNER') return 'Active × active · coordinated';
  if (a.secondary.cls === 'PAYLOAD') return 'Active × active · third party';
  if (a.secondary.cls === 'DEFUNCT') return 'Defunct object · own maneuver';
  return 'Debris · own maneuver';
}

export function AlertsPanel() {
  const s = useStore();
  const [filter, setFilter] = useState<'action' | 'all'>('action');
  const now = clock.now();
  if (s.selectedAlertId) return <AlertDetail />;

  const all = visibleAlerts(s);
  const open = all.filter((a) => a.status !== 'resolved' && a.tca > now);
  const counts = Object.fromEntries(ORDER.map((k) => [k, open.filter((a) => latest(a).severity === k).length])) as Record<Severity, number>;
  const rank = (a: Alert) => ORDER.indexOf(latest(a).severity);
  let list = filter === 'action' ? open.filter((a) => rank(a) <= 2) : all;
  list = [...list].sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || rank(a) - rank(b) || a.tca - b.tca);

  return (
    <aside className="panel right">
      <div className="panel-head">
        <div>
          <div className="eyebrow"><span className="live-pulse" /> Real-time · fused from 6 feeds</div>
          <h2>Conjunction alerts</h2>
        </div>
      </div>
      <div className="sev-tiles">
        {(['critical', 'warning', 'watch'] as const).map((k) => (
          <button key={k} className={`sev-tile ${k} ${counts[k] ? 'has' : ''}`} onClick={() => setFilter('action')}>
            <span className="sev-num mono">{counts[k]}</span>
            <span className="sev-name">{SEVERITY_LABEL[k]}</span>
          </button>
        ))}
      </div>
      <div className="tabs">
        <button className={s.rightTab === 'alerts' ? 'on' : ''} onClick={() => store.set({ rightTab: 'alerts' })}>Alert log</button>
        <button className={s.rightTab === 'log' ? 'on' : ''} onClick={() => store.set({ rightTab: 'log' })}>Event log <span className="tab-count">{s.log.length}</span></button>
        {s.rightTab === 'alerts' && (
          <div className="filter">
            {([['action', 'Action'], ['all', 'All']] as const).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {s.rightTab === 'alerts' ? (
        <div className="alert-list">
          {list.length === 0 && (
            <div className="empty">
              {s.screening.done ? 'No conjunctions in this view.' : 'Screening the catalog… new conjunctions will appear here.'}
            </div>
          )}
          {list.map((a) => <AlertCard key={a.id} a={a} s={s} now={now} />)}
        </div>
      ) : (
        <EventLog s={s} />
      )}
    </aside>
  );
}

function AlertCard({ a, s, now }: { a: Alert; s: AppState; now: number }) {
  const c = latest(a);
  const st = statusText(a, s);
  const resolved = a.status === 'resolved' || a.tca < now;
  return (
    <button
      className={`alert-card ${c.severity} ${a.unread ? 'unread' : ''} ${resolved ? 'resolved' : ''}`}
      onClick={() => store.openAlert(a.id)}
      onMouseEnter={() => store.set({ hoverAlertId: a.id })}
      onMouseLeave={() => store.set({ hoverAlertId: null })}
    >
      <div className="ac-top">
        <span className={`sev-pill ${c.severity}`}>{SEVERITY_LABEL[c.severity]}</span>
        <span className="ac-type">{typeLabel(a)}</span>
        {a.unread && <span className="new-tag">{c.seq > 1 ? 'UPDATED' : 'NEW'}</span>}
        <span className="ac-cdm mono">CDM #{c.seq}</span>
      </div>
      <div className="ac-names">
        <strong>{a.primary.name}</strong>
        <span className="vs">×</span>
        <span className={`sec ${a.secondary.cls.toLowerCase()}`}>{a.secondary.name}</span>
      </div>
      <div className="ac-metrics">
        <div>
          <Term label="TCA in" />
          <span className="m-val big mono">{countdown(a.tca - now)}</span>
        </div>
        <div>
          <Term label="Pc" />
          <span className="m-val mono">{formatPc(c.geometry.pc)}</span>
        </div>
        <div>
          <Term label="Miss" />
          <span className="m-val mono">{meters(c.geometry.missKm)}</span>
        </div>
      </div>
      <div className={`ac-status ${st.tone}`}>
        <span className="st-dot" /> {st.text}
        <span className="ac-time mono">{utc(a.tca)} UTC</span>
      </div>
    </button>
  );
}

function EventLog({ s }: { s: AppState }) {
  return (
    <div className="event-log">
      {s.log.map((e) => (
        <button key={e.id} className={`log-row ${e.level}`} onClick={() => e.alertId && store.openAlert(e.alertId)} disabled={!e.alertId}>
          <span className="log-time mono">{utc(e.t)}</span>
          <span className="log-dot" />
          <span className="log-body">
            <span className="log-title">{e.title}</span>
            {e.detail && <span className="log-detail">{e.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
