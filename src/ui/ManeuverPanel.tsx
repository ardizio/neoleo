import { clock, PLAN_STEPS_JOINT, PLAN_STEPS_SINGLE, store, useStore } from '../state/store';
import { latest, type Alert } from '../sim/alerts';
import { formatPc } from '../orbit/pc';
import { PC_TARGET, PROFILE_INFO, type ManeuverOption, type Profile } from '../orbit/maneuver';
import { ORG, PARTNER_ORG } from '../data/company';
import { cms, countdown, meters, utc } from './format';
import { IconCheck, IconDownload, IconLink, IconSpark } from './icons';

export function ManeuverPanel({ alert: a }: { alert: Alert }) {
  const s = useStore();
  const plan = s.plans[a.id];
  const c = latest(a);
  const now = clock.now();
  const joint = a.secondary.cls === 'PARTNER';
  const passive = a.type === 'ACTIVE_PASSIVE';
  const actionable = c.severity === 'critical' || c.severity === 'warning';
  const closed = a.status === 'resolved' || a.tca < now;

  if (!plan) {
    return (
      <section className={`card action-card ${actionable ? 'urgent' : ''}`}>
        <div className="action-head">
          <div className="ai-badge"><IconSpark size={14} /> NeoLEO AI · Maneuver engine</div>
        </div>
        {passive ? (
          <>
            <h3>{a.secondary.cls === 'DEFUNCT' ? 'Defunct object' : 'Passive debris'}: only {a.primary.name} can move</h3>
            <p>The secondary cannot maneuver. The engine computes an avoidance burn for your satellite and hands it to {ORG.flightDynamicsTeam} for upload.</p>
          </>
        ) : joint ? (
          <>
            <h3>Two active satellites: joint solution</h3>
            <p>{PARTNER_ORG.name} is a cooperative operator. When the risk crosses the warning threshold the engine opens a coordinated request automatically and balances the maneuver between both missions.</p>
          </>
        ) : (
          <>
            <h3>Active third-party satellite</h3>
            <p>No coordination agreement with this operator. The engine can compute an own-satellite maneuver; a coordination notice is sent through the public CDM channel.</p>
          </>
        )}
        <button className="primary-btn" disabled={closed} onClick={() => store.startPlan(a.id)}>
          <IconSpark size={16} /> {joint ? 'Compute joint maneuver now' : 'Compute avoidance maneuver'}
        </button>
        {!actionable && !closed && <div className="hint">Current risk is below the maneuver threshold (Pc 1e-5). You can still compute options.</div>}
      </section>
    );
  }

  if (plan.status === 'computing') {
    const steps = joint ? PLAN_STEPS_JOINT : PLAN_STEPS_SINGLE;
    return (
      <section className="card action-card computing">
        <div className="action-head">
          <div className="ai-badge busy"><IconSpark size={14} /> NeoLEO AI · {plan.auto ? 'auto-coordination' : 'computing'}</div>
        </div>
        <ol className="ai-steps">
          {steps.map((t, k) => (
            <li key={t} className={k < plan.stepIdx ? 'done' : k === plan.stepIdx ? 'now' : ''}>
              <span className="ai-step-dot">{k < plan.stepIdx ? <IconCheck size={11} /> : null}</span>
              {t}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const chosen = plan.options.find((o) => o.id === plan.selectedId);
  const sent = !!plan.sentAt;
  return (
    <section className="card action-card ready">
      <div className="action-head">
        <div className="ai-badge"><IconSpark size={14} /> NeoLEO AI · {plan.options.length} options · target Pc &lt; {PC_TARGET.toExponential(0)}</div>
        {plan.auto && <span className="auto-tag">Auto-initiated</span>}
      </div>
      {plan.options.length === 0 && <p>No burn within the search space brings Pc below target before TCA. Escalate to {ORG.flightDynamicsTeam}.</p>}
      <div className="opt-list">
        {plan.options.map((o) => (
          <OptionRow key={o.id} o={o} tca={a.tca} selected={o.id === plan.selectedId} disabled={sent} onSelect={() => store.selectOption(a.id, o.id)} />
        ))}
      </div>
      {chosen && (
        <>
          {chosen.profiles.length > 0 && (
            <div className="rationale">
              <strong>Why this option:</strong>{' '}
              {chosen.recommended && chosen.rationale ? chosen.rationale : chosen.profiles.map((p) => PROFILE_INFO[p].why).join(' ')}
            </div>
          )}
          <div className={`check ${plan.check?.status ?? 'running'}`}>
            {plan.check?.status === 'running' && <><span className="spinner" /> Post-maneuver screening of the new orbit against the catalog (24 h)…</>}
            {plan.check?.status === 'clear' && <><IconCheck size={14} /> Post-maneuver screening: no new close approaches under 1 km in 24 h.</>}
            {plan.check?.status === 'issues' && <>⚠ Post-maneuver screening found {plan.check.hits.length} new approach(es) under 1 km: consider another option.</>}
          </div>
          <Workflow a={a} chosen={chosen} />
        </>
      )}
    </section>
  );
}

const PROFILE_ICON: Record<Profile, string> = { balanced: '★', fuel: '⛽', safe: '🛡', lead: '⏱' };

function OptionRow({ o, tca, selected, disabled, onSelect }: { o: ManeuverOption; tca: number; selected: boolean; disabled: boolean; onSelect: () => void }) {
  const first = Math.min(...o.burns.map((b) => b.time));
  return (
    <button className={`opt ${selected ? 'selected' : ''} ${o.recommended ? 'rec' : ''}`} onClick={onSelect} disabled={disabled && !selected}>
      <div className="opt-top">
        <span className="opt-radio" />
        <span className="opt-label">{o.label}</span>
        {o.profiles.map((p) => <span key={p} className={`prof-tag ${p}`} title={PROFILE_INFO[p].why}>{PROFILE_ICON[p]} {PROFILE_INFO[p].label}</span>)}
        <span className="opt-lead mono">burn T−{countdown(tca - first)}</span>
      </div>
      <div className="opt-burns">
        {o.burns.map((b) => (
          <div key={b.satId} className="burn">
            <span className="burn-sat">{b.satName}</span>
            <span className="mono">Δv {cms(b.dvMs)} {b.dvRtnMs[1] > 0 ? '+T' : '−T'}</span>
            <span className="mono">{b.propellantG.toFixed(1)} g</span>
            <span className="mono">{b.budgetUsedPct.toFixed(2)}% budget</span>
            <span className="mono">{b.durationS < 120 ? `${b.durationS.toFixed(0)} s` : `${(b.durationS / 60).toFixed(0)} min`} burn</span>
          </div>
        ))}
      </div>
      <div className="opt-result mono">
        <span>→ miss {meters(o.result.missKm)}</span>
        <span>Pc {formatPc(o.result.pc)}</span>
        <span>Δalt {(o.burns[0].deltaAltKm * 1000).toFixed(0)} m</span>
      </div>
    </button>
  );
}

function Workflow({ a, chosen }: { a: Alert; chosen: ManeuverOption }) {
  const s = useStore();
  const plan = s.plans[a.id];
  const joint = a.secondary.cls === 'PARTNER';
  const closed = a.status === 'resolved';

  const download = () => {
    const payload = {
      request: plan.ticket ?? 'DRAFT',
      createdUtc: new Date().toISOString(),
      conjunction: { id: a.id, tca: new Date(a.tca).toISOString(), primary: a.primary, secondary: a.secondary, latestCdm: latest(a).messageId, pc: latest(a).geometry.pc },
      maneuver: chosen.burns.map((b) => ({ satellite: b.satName, operator: b.operator, epochUtc: new Date(b.time).toISOString(), frame: 'RTN', deltaV_ms: b.dvRtnMs, propellant_g: +b.propellantG.toFixed(2), burnDuration_s: +b.durationS.toFixed(1) })),
      predicted: { missDistance_m: +(chosen.result.missKm * 1000).toFixed(1), pc: chosen.result.pc, tca: new Date(chosen.result.tca).toISOString() },
      recovery: { note: 'Return-to-slot burn of equal magnitude after TCA', deltaV_ms: chosen.recoveryDvMs },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = `${plan.ticket ?? 'maneuver-draft'}.json`;
    el.click();
    URL.revokeObjectURL(url);
  };

  if (!plan.sentAt) {
    return (
      <div className="workflow">
        <button className="primary-btn" disabled={closed} onClick={() => store.sendPlan(a.id)}>
          {joint ? <><IconLink size={16} /> Send joint proposal to {PARTNER_ORG.name}</> : <>Send to {ORG.flightDynamicsTeam}</>}
        </button>
        <button className="ghost-btn" onClick={download}><IconDownload size={14} /> Export plan</button>
      </div>
    );
  }
  const steps = joint
    ? [
        { label: `Proposal ${plan.ticket} sent to ${PARTNER_ORG.ops}`, done: true },
        { label: `${PARTNER_ORG.name} reviewing`, done: plan.counterpart === 'reviewing' || plan.counterpart === 'accepted', now: plan.counterpart === 'pending' },
        { label: 'Both operators accepted the joint plan', done: plan.counterpart === 'accepted', now: plan.counterpart === 'reviewing' },
        { label: `Burns execute at ${chosen.burns.map((b) => utc(b.time)).join(' / ')} UTC`, done: !!plan.executed, now: plan.counterpart === 'accepted' && !plan.executed },
      ]
    : [
        { label: `Request ${plan.ticket} sent to ${ORG.flightDynamicsTeam}`, done: true },
        { label: 'Flight Dynamics validates and schedules the command upload', done: !!plan.fdAck, now: !plan.fdAck },
        { label: `Burn executes at ${utc(chosen.burns[0].time)} UTC`, done: !!plan.executed, now: !!plan.fdAck && !plan.executed },
      ];
  return (
    <div className="workflow sent">
      <ol className="wf-steps">
        {steps.map((st) => (
          <li key={st.label} className={st.done ? 'done' : st.now ? 'now' : ''}>
            <span className="ai-step-dot">{st.done ? <IconCheck size={11} /> : null}</span>
            {st.label}
          </li>
        ))}
      </ol>
      <button className="ghost-btn" onClick={download}><IconDownload size={14} /> Export {plan.ticket}</button>
    </div>
  );
}
