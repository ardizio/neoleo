import { useSyncExternalStore } from 'react';
import type { SatRec } from 'satellite.js';
import { CATALOG_URL, loadCatalog, toSatrec, type CatalogObject, type CatalogSnapshot } from '../data/catalog';
import { FLEET, ORG, PARTNER_FLEET, PARTNER_ORG, type FleetSpec } from '../data/company';
import type { Kep, State } from '../orbit/kepler';
import { planAvoidance, postManeuverKep, type ManeuverOption, type SatBudget } from '../orbit/maneuver';
import { SEVERITY_LABEL, encounter, formatPc, severityOf, type Severity } from '../orbit/pc';
import { fuseCI, GATE_D2, mahalanobis2, type Estimate } from '../orbit/fusion';
import type { ScreeningHit } from '../orbit/screening';
import { parseKvn, summarize } from '../orbit/cdm';
import { issueCdm, latest, type Alert, type ObjectRef } from '../sim/alerts';
import { catalogRef, fleetRef } from '../sim/refs';
import { DESIGNS, type CdmPlanStep, type FleetOrbit, type ResolvedDesign } from '../sim/scenario';
import { add, fromRtn, type Vec3 } from '../orbit/vec';

export type Selection = { type: 'catalog'; idx: number } | { type: 'fleet'; id: string };

export interface PlanState {
  status: 'computing' | 'ready';
  auto: boolean;
  stepIdx: number;
  options: ManeuverOption[];
  selectedId?: string;
  check?: { status: 'running' | 'clear' | 'issues'; hits: ScreeningHit[]; optionId: string };
  ticket?: string;
  counterpart?: 'pending' | 'reviewing' | 'accepted';
  sentAt?: number;
  fdAck?: boolean;
  executed?: boolean;
}

export interface LogEntry {
  id: number;
  t: number;
  level: 'info' | 'warn' | 'critical' | 'success';
  title: string;
  detail?: string;
  alertId?: string;
}

export interface Toast {
  id: number;
  alertId?: string;
  severity: Severity | 'success';
  title: string;
  body: string;
}

export interface Layers {
  payload: boolean;
  debris: boolean;
  partner: boolean;
  fleetOrbits: boolean;
  labels: boolean;
  regime: 'ALL' | 'LEO' | 'MEO' | 'GEO';
}

export interface AppState {
  phase: 'loading' | 'ready' | 'error';
  loadingStep: string;
  error?: string;
  snapshot?: Omit<CatalogSnapshot, 'rows'>;
  objects: CatalogObject[];
  fleet: FleetOrbit[];
  partners: FleetOrbit[];
  designs: ResolvedDesign[];
  alerts: Alert[];
  plans: Record<string, PlanState>;
  log: LogEntry[];
  toasts: Toast[];
  screening: { fraction: number; candidates: number; done: boolean; hits: number };
  selected: Selection | null;
  selectedAlertId: string | null;
  hoverAlertId: string | null;
  layers: Layers;
  speed: number;
  autoRotate: boolean;
  tick: number;
  modal: null | 'sources' | 'ingest' | 'settings' | { cdm: { alertId: string; seq: number } };
  rightTab: 'alerts' | 'log';
  followSelected: boolean;
  earthStyle: 'photo' | 'map';
  /** Which pane fills the screen on phones (ignored on desktop). */
  mobileTab: 'globe' | 'alerts' | 'fleet';
}

export const PLAN_STEPS_SINGLE = [
  'Loading fused ephemerides and covariance',
  'Sampling along-track burn candidates',
  'Re-propagating orbits and recomputing Pc',
  'Applying mission and propellant constraints',
  'Ranking maneuver options',
];
export const PLAN_STEPS_JOINT = [
  'Exchanging ephemerides with counterpart operator',
  'Sampling single and joint burn candidates',
  'Re-propagating both orbits and recomputing Pc',
  'Balancing propellant and service impact of both missions',
  'Ranking coordinated solutions',
];

class Clock {
  base = Date.now();
  wallBase = Date.now();
  speed = 1;
  now() {
    return this.base + (Date.now() - this.wallBase) * this.speed;
  }
  setSpeed(s: number) {
    this.base = this.now();
    this.wallBase = Date.now();
    this.speed = s;
  }
  reset() {
    this.base = Date.now();
    this.wallBase = Date.now();
    this.speed = 1;
  }
}

export const clock = new Clock();

type Listener = () => void;

const DEFAULT_LAYERS: Layers = { payload: true, debris: true, partner: true, fleetOrbits: true, labels: true, regime: 'LEO' };
function loadLayers(): Layers {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem('layers') ?? '{}'), regime: 'LEO' };
  } catch {
    return DEFAULT_LAYERS;
  }
}

class Store {
  state: AppState = {
    phase: 'loading',
    loadingStep: 'Connecting to data feeds',
    objects: [],
    fleet: [],
    partners: [],
    designs: [],
    alerts: [],
    plans: {},
    log: [],
    toasts: [],
    screening: { fraction: 0, candidates: 0, done: false, hits: 0 },
    selected: null,
    selectedAlertId: null,
    hoverAlertId: null,
    layers: loadLayers(),
    speed: 1,
    autoRotate: true,
    tick: 0,
    modal: null,
    rightTab: 'alerts',
    earthStyle: localStorage.getItem('earthStyle') === 'photo' ? 'photo' : 'map',
    mobileTab: 'globe',
    followSelected: false,
  };
  private listeners = new Set<Listener>();
  private logId = 1;
  private toastId = 1;
  private sessionStart = Date.now();
  private releaseSec = new Map<string, number>();
  private recCache = new Map<number, SatRec>();
  private byNorad = new Map<number, CatalogObject>();
  private customWorker: Worker | null = null;
  private customReq = new Map<number, (hits: ScreeningHit[]) => void>();
  private customId = 1;
  propagator: Worker | null = null;
  /** Latest SGP4 batch for the renderer. */
  catalogState: { t: number; pos: Float32Array; vel: Float32Array } | null = null;
  catalogVersion = 0;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.state;
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  // ---------- boot ----------
  async boot() {
    try {
      this.set({ loadingStep: 'Loading public GP catalog (CelesTrak)' });
      const { snapshot, objects } = await loadCatalog();
      objects.forEach((o) => this.byNorad.set(o.norad, o));
      const { rows: _rows, ...meta } = snapshot;
      this.set({ objects, snapshot: meta, loadingStep: 'Starting SGP4 propagation' });

      // Workers resolve relative URLs against their own script (/assets/), so pass an absolute one.
      const catalogUrl = new URL(CATALOG_URL, location.href).href;
      this.propagator = new Worker(new URL('../workers/propagator.worker.ts', import.meta.url), { type: 'module' });
      this.propagator.onmessage = (ev) => {
        if (ev.data.type === 'state') {
          this.catalogState = { t: ev.data.t, pos: ev.data.pos, vel: ev.data.vel };
          this.catalogVersion++;
        } else if (ev.data.type === 'ready') this.requestPropagation();
      };
      this.propagator.postMessage({ type: 'init', catalogUrl });

      this.set({ loadingStep: 'Building fleet ephemerides and screening' });
      const t0 = clock.now();
      const engine = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
      await new Promise<void>((resolve) => {
        engine.onmessage = (ev) => this.onEngine(ev.data, resolve);
        engine.postMessage({ type: 'init', t0, catalogUrl });
      });
      this.customWorker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
      this.customWorker.onmessage = (ev) => {
        if (ev.data.type === 'custom-result') {
          this.customReq.get(ev.data.reqId)?.(ev.data.hits);
          this.customReq.delete(ev.data.reqId);
        }
      };
      this.customWorker.postMessage({ type: 'init', t0, sweep: false, catalogUrl });

      this.sessionStart = Date.now();
      this.addLog('info', `Signed in as ${ORG.user.name}`, `${ORG.name} · ${FLEET.length} satellites under management`);
      this.addLog('info', 'Catalog loaded', `${objects.length.toLocaleString()} objects · ${snapshot.source}`);
      this.set({ phase: 'ready' });
      setInterval(() => this.onTick(), 1000);
    } catch (err) {
      this.set({ phase: 'error', error: String(err) });
    }
  }

  requestPropagation() {
    this.propagator?.postMessage({ type: 'propagate', t: clock.now() });
  }

  private onEngine(m: any, resolveScenario: () => void) {
    if (m.type === 'scenario') {
      this.set({ fleet: m.fleet, partners: m.partners, designs: m.designs, screening: { ...this.state.screening, candidates: m.candidates } });
    } else if (m.type === 'designed-hits') {
      const alerts = (m.hits as ScreeningHit[]).map((h) => {
        const d = this.state.designs.find((x) => x.primaryId === h.primaryId && x.secondaryId === h.secondaryId)!;
        const design = DESIGNS.find((x) => x.key === d.key)!;
        return this.makeAlert(h, design.plan, design.releaseSec, d.key);
      });
      this.set({ alerts });
      resolveScenario();
      this.onTick();
    } else if (m.type === 'hits') {
      const existing = this.state.alerts;
      const fresh = (m.hits as ScreeningHit[])
        .filter((h) => !existing.some((a) => a.primary.id === h.primaryId && a.secondary.id === h.secondaryId && Math.abs(a.tca - h.tca) < 600e3))
        .map((h) => {
          const elapsed = (Date.now() - this.sessionStart) / 1000;
          const sec = this.secondaryRef(h.secondaryId);
          const plan: CdmPlanStep[] = [{
            atSec: 0,
            sources: sec.cls === 'DEBRIS' || sec.cls === 'DEFUNCT' ? ['PUB-GP', 'PUB-CDM', 'LEOLABS'] : ['PUB-GP', 'PUB-CDM'],
            sigmaScale: 1,
            note: 'Detected by NeoLEO catalog sweep',
          }];
          return this.makeAlert(h, plan, Math.max(4, elapsed) + Math.random() * 20);
        });
      this.set((s) => ({ alerts: [...s.alerts, ...fresh], screening: { ...s.screening, fraction: m.fraction, hits: s.screening.hits + m.hits.length } }));
    } else if (m.type === 'screening-done') {
      this.set((s) => ({ screening: { ...s.screening, fraction: 1, done: true } }));
      this.addLog('info', 'Catalog sweep complete', `${this.state.screening.candidates.toLocaleString()} candidate objects screened over 24 h`);
    }
  }

  // ---------- object helpers ----------
  fleetSpec(id: string): FleetSpec | undefined {
    return this.state.fleet.find((f) => f.spec.id === id)?.spec ?? this.state.partners.find((f) => f.spec.id === id)?.spec ??
      FLEET.find((f) => f.id === id) ?? PARTNER_FLEET.find((f) => f.id === id);
  }
  fleetOrbit(id: string): FleetOrbit | undefined {
    return this.state.fleet.find((f) => f.spec.id === id) ?? this.state.partners.find((f) => f.spec.id === id);
  }
  catalogByNorad(n: number) {
    return this.byNorad.get(n);
  }
  satrec(o: CatalogObject): SatRec {
    let r = this.recCache.get(o.idx);
    if (!r) {
      r = toSatrec(o);
      this.recCache.set(o.idx, r);
    }
    return r;
  }
  secondaryRef(id: string): ObjectRef {
    if (id.startsWith('C')) return catalogRef(this.byNorad.get(Number(id.slice(1)))!);
    return fleetRef(this.fleetSpec(id)!);
  }

  private makeAlert(h: ScreeningHit, plan: CdmPlanStep[], releaseSec: number, designKey?: string): Alert {
    const primary = fleetRef(this.fleetSpec(h.primaryId)!);
    const secondary = this.secondaryRef(h.secondaryId);
    const id = `CNJ-${primary.norad}-${secondary.norad}-${Math.round(h.tca / 60e3) % 100000}`;
    this.releaseSec.set(id, releaseSec);
    return {
      id,
      primary,
      secondary,
      type: secondary.cls === 'PARTNER' || secondary.cls === 'PAYLOAD' ? 'ACTIVE_ACTIVE' : 'ACTIVE_PASSIVE',
      tca: h.tca,
      truth: { primary: h.primary, secondary: h.secondary },
      cdms: [],
      pendingPlan: [...plan],
      releasedAt: 0,
      status: 'new',
      designKey,
      unread: true,
    };
  }

  // ---------- tick ----------
  private onTick() {
    const elapsed = (Date.now() - this.sessionStart) / 1000;
    const simNow = clock.now();
    let changed = false;
    const alerts = this.state.alerts.map((a) => {
      const rel = this.releaseSec.get(a.id) ?? 0;
      if (!a.pendingPlan.length || a.tca < simNow) return a;
      const due = a.pendingPlan.filter((s) => rel + s.atSec <= elapsed);
      if (!due.length) return a;
      changed = true;
      let next: Alert = { ...a, pendingPlan: a.pendingPlan.filter((s) => !due.includes(s)), cdms: [...a.cdms] };
      for (const step of due) {
        const prev = next.cdms.length ? latest(next) : null;
        const cdm = issueCdm(next, step, simNow);
        next.cdms.push(cdm);
        if (!prev) {
          next.releasedAt = Date.now();
          this.onNewAlert(next);
        } else this.onUpdate(next, prev.severity);
      }
      if (due.length && next.cdms.length > 1) next = { ...next, unread: true };
      return next;
    });
    if (changed) this.set({ alerts });

    // Automatic coordination for active-active conjunctions with a cooperative partner.
    for (const a of this.state.alerts) {
      const c = a.cdms.length ? latest(a) : null;
      if (!c || a.tca < simNow) continue;
      if (a.type === 'ACTIVE_ACTIVE' && a.secondary.cls === 'PARTNER' && !this.state.plans[a.id] && (c.severity === 'critical' || c.severity === 'warning')) {
        this.addLog('warn', 'Auto-coordination started', `${a.primary.name} × ${a.secondary.name}: both satellites are active; joint maneuver request opened with ${PARTNER_ORG.name}`, a.id);
        this.startPlan(a.id, true);
      }
    }
    this.progressWorkflows(simNow);
    this.set((s) => ({ tick: s.tick + 1 }));
  }

  private onNewAlert(a: Alert) {
    const c = latest(a);
    if (c.severity === 'monitor') return;
    const lvl = c.severity === 'critical' ? 'critical' : c.severity === 'warning' ? 'warn' : 'info';
    this.addLog(lvl, `New ${SEVERITY_LABEL[c.severity].toLowerCase()} conjunction`, `${a.primary.name} × ${a.secondary.name} · Pc ${formatPc(c.geometry.pc)} · miss ${(c.geometry.missKm * 1000).toFixed(0)} m`, a.id);
    const quiet = (Date.now() - this.sessionStart) / 1000 < 6; // initial alerts are already on screen
    if (!quiet && (c.severity !== 'watch' || a.designKey)) {
      this.toast({ alertId: a.id, severity: c.severity, title: `${SEVERITY_LABEL[c.severity]} conjunction`, body: `${a.primary.name} × ${a.secondary.name}` });
    }
  }

  private onUpdate(a: Alert, prevSev: Severity) {
    const c = latest(a);
    const order: Severity[] = ['monitor', 'watch', 'warning', 'critical'];
    const up = order.indexOf(c.severity) > order.indexOf(prevSev);
    this.addLog(up ? (c.severity === 'critical' ? 'critical' : 'warn') : 'info',
      up ? `Escalated to ${SEVERITY_LABEL[c.severity]}` : `CDM #${c.seq} received`,
      `${a.primary.name} × ${a.secondary.name} · ${c.note} · Pc ${formatPc(c.geometry.pc)}`, a.id);
    if (up) this.toast({ alertId: a.id, severity: c.severity, title: `Escalated to ${SEVERITY_LABEL[c.severity]}`, body: `${a.primary.name} × ${a.secondary.name} · ${c.note}` });
  }

  private progressWorkflows(simNow: number) {
    const plans = { ...this.state.plans };
    let changed = false;
    for (const [id, p] of Object.entries(plans)) {
      const a = this.state.alerts.find((x) => x.id === id);
      if (!a || !p.sentAt) continue;
      const age = (Date.now() - p.sentAt) / 1000;
      if (p.counterpart === 'pending' && age > 3) {
        plans[id] = { ...p, counterpart: 'reviewing' };
        this.addLog('info', `${PARTNER_ORG.name} reviewing proposal`, `${PARTNER_ORG.ops} received the joint maneuver plan`, id);
        changed = true;
      } else if (p.counterpart === 'reviewing' && age > 14) {
        plans[id] = { ...p, counterpart: 'accepted' };
        this.setAlertStatus(id, 'agreed');
        this.addLog('success', 'Joint maneuver agreed', `${PARTNER_ORG.name} accepted the coordinated plan for ${a.primary.name} × ${a.secondary.name}`, id);
        this.toast({ alertId: id, severity: 'success', title: 'Joint maneuver agreed', body: `${PARTNER_ORG.name} accepted the plan` });
        changed = true;
      } else if (!p.counterpart && !p.fdAck && age > 8) {
        plans[id] = { ...p, fdAck: true };
        this.addLog('success', 'Flight Dynamics acknowledged', `${ORG.flightDynamicsTeam} scheduled the burn for ${a.primary.name} (${p.ticket})`, id);
        changed = true;
      }
      const opt = p.options.find((o) => o.id === p.selectedId);
      const own = opt?.burns.find((b) => b.satId === a.primary.id);
      const ready = p.counterpart ? p.counterpart === 'accepted' : p.fdAck;
      if (opt && ready && !p.executed && own && simNow >= own.time) {
        this.executeBurn(a, opt);
        plans[id] = { ...plans[id], executed: true };
        changed = true;
      }
    }
    if (changed) this.set({ plans });
    // TCA passed
    for (const a of this.state.alerts) {
      if (a.cdms.length && a.tca < simNow && a.status !== 'resolved') {
        const mitigated = this.state.plans[a.id]?.executed;
        this.setAlertStatus(a.id, 'resolved');
        if (latest(a).severity !== 'monitor')
          this.addLog(mitigated ? 'success' : 'info', mitigated ? 'Conjunction cleared' : 'TCA passed', `${a.primary.name} × ${a.secondary.name}${mitigated ? ' · avoided by maneuver' : ''}`, a.id);
      }
    }
  }

  private executeBurn(a: Alert, opt: ManeuverOption) {
    const upd = (list: FleetOrbit[]) => list.map((f) => (opt.burns.some((b) => b.satId === f.spec.id) ? { ...f, kep: postManeuverKep(f.kep, f.spec.id, opt) } : f));
    this.set((s) => ({ fleet: upd(s.fleet), partners: upd(s.partners) }));
    this.addLog('success', 'Avoidance burn executed', opt.burns.map((b) => `${b.satName} Δv ${(b.dvMs * 100).toFixed(1)} cm/s`).join(' · '), a.id);
  }

  setAlertStatus(id: string, status: Alert['status']) {
    this.set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status } : a)) }));
  }

  // ---------- planning ----------
  private budget(spec: FleetSpec): SatBudget {
    return { id: spec.id, name: spec.name, operator: spec.owner === 'own' ? ORG.name : PARTNER_ORG.name, massKg: spec.massKg, propellantKg: spec.propellantKg, ispS: spec.ispS, thrustN: spec.thrustN, priority: spec.priority };
  }

  startPlan(alertId: string, auto = false) {
    const a = this.state.alerts.find((x) => x.id === alertId);
    if (!a) return;
    this.set((s) => ({ plans: { ...s.plans, [alertId]: { status: 'computing', auto, stepIdx: 0, options: [] } } }));
    this.setAlertStatus(alertId, 'computing');
    if (!auto) this.addLog('info', 'Maneuver computation requested', `${a.primary.name} × ${a.secondary.name}`, alertId);
    const steps = a.secondary.cls === 'PARTNER' ? PLAN_STEPS_JOINT : PLAN_STEPS_SINGLE;
    let k = 0;
    const iv = setInterval(() => {
      k++;
      if (k < steps.length) {
        this.set((s) => ({ plans: { ...s.plans, [alertId]: { ...s.plans[alertId], stepIdx: k } } }));
        return;
      }
      clearInterval(iv);
      this.finishPlan(alertId, auto);
    }, 650);
  }

  private finishPlan(alertId: string, auto: boolean) {
    const a = this.state.alerts.find((x) => x.id === alertId)!;
    const c = latest(a);
    const prim = this.fleetOrbit(a.primary.id)!;
    const partner = a.secondary.cls === 'PARTNER' ? this.fleetOrbit(a.secondary.id) : undefined;
    const secBody = partner
      ? { type: 'kep' as const, kep: partner.kep }
      : { type: 'sgp4' as const, rec: this.satrec(this.byNorad.get(a.secondary.norad)!) };
    const options = planAvoidance({
      now: clock.now(),
      tca: a.tca,
      primary: { kep: prim.kep, budget: this.budget(prim.spec) },
      secondary: { body: secBody, budget: partner ? this.budget(partner.spec) : undefined },
      sigP: c.sigmaPrimary,
      sigS: c.sigmaSecondary,
      hbrKm: (a.primary.hbrM + a.secondary.hbrM) / 1000,
    });
    const rec = options.find((o) => o.recommended);
    this.set((s) => ({ plans: { ...s.plans, [alertId]: { ...s.plans[alertId], status: 'ready', options, selectedId: rec?.id, stepIdx: 99 } } }));
    this.setAlertStatus(alertId, 'plan-ready');
    this.addLog('info', 'Maneuver options ready', `${options.length} options · recommended: ${rec?.label ?? 'none'}`, alertId);
    if (rec) this.checkOption(alertId, rec.id);
    if (auto && rec) setTimeout(() => this.sendPlan(alertId), 1800);
  }

  selectOption(alertId: string, optionId: string) {
    this.set((s) => ({ plans: { ...s.plans, [alertId]: { ...s.plans[alertId], selectedId: optionId } } }));
    this.checkOption(alertId, optionId);
  }

  /** Post-maneuver screening of the new orbit against the catalog. */
  private checkOption(alertId: string, optionId: string) {
    const a = this.state.alerts.find((x) => x.id === alertId)!;
    const p = this.state.plans[alertId];
    const opt = p.options.find((o) => o.id === optionId);
    if (!opt || !this.customWorker) return;
    const prim = this.fleetOrbit(a.primary.id)!;
    const ownBurn = opt.burns.find((b) => b.satId === a.primary.id);
    const set = (check: PlanState['check']) => this.set((s) => ({ plans: { ...s.plans, [alertId]: { ...s.plans[alertId], check } } }));
    if (!ownBurn) {
      set({ status: 'clear', hits: [], optionId });
      return;
    }
    set({ status: 'running', hits: [], optionId });
    const kep = postManeuverKep(prim.kep, a.primary.id, opt);
    const reqId = this.customId++;
    this.customReq.set(reqId, (hits) => {
      const bad = hits.filter((h) => h.missKm < 1);
      if (this.state.plans[alertId]?.check?.optionId === optionId) set({ status: bad.length ? 'issues' : 'clear', hits: bad, optionId });
    });
    this.customWorker.postMessage({ type: 'screen-custom', reqId, id: a.primary.id, kep, t0: ownBurn.time, hours: 24, exclude: [a.secondary.id] });
  }

  sendPlan(alertId: string) {
    const a = this.state.alerts.find((x) => x.id === alertId)!;
    const p = this.state.plans[alertId];
    const opt = p.options.find((o) => o.id === p.selectedId);
    if (!opt) return;
    const ticket = `MR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100)}`;
    const joint = a.secondary.cls === 'PARTNER';
    this.set((s) => ({ plans: { ...s.plans, [alertId]: { ...p, ticket, sentAt: Date.now(), counterpart: joint ? 'pending' : undefined } } }));
    this.setAlertStatus(alertId, joint ? 'proposal-sent' : 'sent-internal');
    if (joint) {
      this.addLog('info', `Joint proposal sent to ${PARTNER_ORG.name}`, `${ticket} · ${opt.label}`, alertId);
    } else {
      this.addLog('success', `Sent to ${ORG.flightDynamicsTeam}`, `${ticket} · ${opt.label} · Δv ${(opt.totalDvMs * 100).toFixed(1)} cm/s`, alertId);
      this.toast({ alertId, severity: 'success', title: 'Maneuver request sent', body: `${ticket} → ${ORG.flightDynamicsTeam}` });
    }
  }

  acknowledge(alertId: string) {
    const a = this.state.alerts.find((x) => x.id === alertId);
    if (a?.status === 'new') this.setAlertStatus(alertId, 'acknowledged');
  }

  // ---------- CDM ingest ----------
  ingestCdm(text: string): { ok: boolean; message: string; alertId?: string } {
    let sum;
    let parsed;
    try {
      parsed = parseKvn(text);
      sum = summarize(parsed);
    } catch (e) {
      return { ok: false, message: String((e as Error).message) };
    }
    const all = [...this.state.fleet, ...this.state.partners];
    const mine = this.state.fleet.find((f) => String(f.spec.norad) === sum.obj1.designator || String(f.spec.norad) === sum.obj2.designator);
    if (!mine) {
      this.addLog('info', 'CDM ingested (no matching asset)', `${sum.messageId}: ${sum.obj1.name} × ${sum.obj2.name}`);
      return { ok: true, message: `Parsed ${sum.messageId}: ${sum.obj1.name} × ${sum.obj2.name}, Pc ${formatPc(sum.pc)}. Neither object belongs to ${ORG.name}, so it was logged without raising an alert.` };
    }
    const mineIsObj1 = String(mine.spec.norad) === sum.obj1.designator;
    const [po, so] = mineIsObj1 ? [parsed.objects[0], parsed.objects[1]] : [parsed.objects[1], parsed.objects[0]];
    const st = (o: Record<string, string>): State | null => {
      const n = ['X', 'Y', 'Z', 'X_DOT', 'Y_DOT', 'Z_DOT'].map((k) => Number(o?.[k]));
      return n.every(Number.isFinite) ? { r: n.slice(0, 3) as Vec3, v: n.slice(3) as Vec3 } : null;
    };
    const ps = st(po), ss = st(so);
    if (!ps || !ss) return { ok: false, message: 'CDM matched your fleet but has no usable state vectors.' };
    const otherNorad = Number(so.OBJECT_DESIGNATOR);
    const other = all.find((f) => f.spec.norad === otherNorad);
    const secId = other ? other.spec.id : this.byNorad.has(otherNorad) ? `C${otherNorad}` : null;
    if (!secId) return { ok: false, message: `Secondary object ${otherNorad} is not in the current catalog.` };

    // Same conjunction already tracked (other provider / later update): fuse instead of duplicating.
    const existing = this.state.alerts.find(
      (a) => a.primary.id === mine.spec.id && a.secondary.id === secId && a.status !== 'resolved' && Math.abs(a.tca - sum.tca) < 600e3,
    );
    if (existing) return this.fuseIngested(existing, so, ss, sum.messageId, text);
    const hit: ScreeningHit = { primaryId: mine.spec.id, secondaryId: secId, tca: sum.tca, missKm: sum.missKm, primary: ps, secondary: ss };
    const alert = this.makeAlert(hit, [{ atSec: 0, sources: ['PUB-CDM'], sigmaScale: 1, note: `Ingested ${sum.messageId}` }], 0);
    alert.id += '-I';
    this.releaseSec.set(alert.id, 0);
    this.set((s) => ({ alerts: [...s.alerts, alert] }));
    this.addLog('info', 'CDM ingested', `${sum.messageId} matched ${mine.spec.name}`, alert.id);
    this.onTick();
    return { ok: true, message: `Matched ${mine.spec.name}. Alert created.`, alertId: alert.id };
  }

  /**
   * Merge an ingested CDM's secondary estimate into an existing alert.
   * The primary stays on the owner GNSS ephemeris (authoritative for own satellites);
   * the secondary is gated for consistency, then fused by covariance intersection.
   */
  private fuseIngested(alert: Alert, so: Record<string, string>, ss: State, messageId: string, kvn: string) {
    if (alert.cdms.some((c) => c.messageId === messageId)) return { ok: true, message: `${messageId} is already part of this alert; nothing to fuse.`, alertId: alert.id };
    const cur = latest(alert);
    const p = alert.truth.primary;
    const sd = (k: string, fallback: number) => {
      const x = Number(so[k]);
      return Number.isFinite(x) && x > 0 ? Math.sqrt(x) / 1000 : fallback; // m^2 -> km
    };
    const mineEst: Estimate = { r: add(p.r, fromRtn(cur.geometry.relPosRtn, p.r, p.v)), v: alert.truth.secondary.v, sigma: cur.sigmaSecondary, source: cur.sources.join('+') };
    const theirs: Estimate = { r: ss.r, v: ss.v, sigma: [sd('CR_R', 0.1), sd('CT_T', 0.5), sd('CN_N', 0.1)], source: messageId };
    const d2 = mahalanobis2(mineEst, theirs);
    if (d2 > GATE_D2) {
      this.addLog('warn', 'Ingested CDM inconsistent, not fused', `${messageId}: Mahalanobis d² ${d2.toFixed(1)} > ${GATE_D2} (99%)`, alert.id);
      return { ok: true, message: `Matched existing alert, but the secondary state disagrees with the current solution beyond its stated covariance (d² = ${d2.toFixed(1)}). Logged for review, not fused.`, alertId: alert.id };
    }
    const f = fuseCI([mineEst, theirs]);
    const hbrKm = (alert.primary.hbrM + alert.secondary.hbrM) / 1000;
    const geometry = encounter(p.r, p.v, f.r, ss.v, cur.sigmaPrimary, f.sigma, hbrKm);
    const rec = {
      ...cur,
      seq: alert.cdms.length + 1,
      messageId,
      created: clock.now(),
      geometry,
      severity: severityOf(geometry.pc, geometry.missKm),
      sources: [...cur.sources, 'EXT-CDM'],
      note: `Fused with ingested ${messageId} · covariance intersection, weights ${f.weights.map((w) => w.toFixed(2)).join(' / ')}`,
      sigmaSecondary: f.sigma,
      kvn,
    };
    this.set((s) => ({ alerts: s.alerts.map((a) => (a.id === alert.id ? { ...a, cdms: [...a.cdms, rec] } : a)) }));
    this.addLog('info', 'CDM fused into existing alert', `${messageId} · d² ${d2.toFixed(1)} · Pc ${formatPc(cur.geometry.pc)} → ${formatPc(geometry.pc)}`, alert.id);
    this.onTick();
    return { ok: true, message: `Matched existing alert. Fused with the current solution: Pc ${formatPc(cur.geometry.pc)} → ${formatPc(geometry.pc)}.`, alertId: alert.id };
  }

  // ---------- ui ----------
  addLog(level: LogEntry['level'], title: string, detail?: string, alertId?: string) {
    const e: LogEntry = { id: this.logId++, t: clock.now(), level, title, detail, alertId };
    this.set((s) => ({ log: [e, ...s.log].slice(0, 300) }));
  }
  toast(t: Omit<Toast, 'id'>) {
    const id = this.toastId++;
    this.set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    setTimeout(() => this.dismissToast(id), 9000);
  }
  setLayers(p: Partial<Layers>) {
    this.set((s) => ({ layers: { ...s.layers, ...p } }));
    localStorage.setItem('layers', JSON.stringify(this.state.layers));
  }
  setEarthStyle(earthStyle: AppState['earthStyle']) {
    localStorage.setItem('earthStyle', earthStyle);
    this.set({ earthStyle });
  }
  dismissToast(id: number) {
    this.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }
  openAlert(id: string | null) {
    this.set((s) => ({ selectedAlertId: id, alerts: s.alerts.map((a) => (a.id === id ? { ...a, unread: false } : a)), autoRotate: id ? false : s.autoRotate, mobileTab: id ? 'alerts' : s.mobileTab }));
    if (id) this.acknowledge(id);
  }
  select(sel: Selection | null) {
    this.set({ selected: sel, autoRotate: sel ? false : this.state.autoRotate, mobileTab: sel ? 'globe' : this.state.mobileTab });
  }
  setSpeed(s: number) {
    clock.setSpeed(s);
    // Pausing also stops the globe's auto-rotation so everything visibly freezes.
    this.set(s === 0 ? { speed: s, autoRotate: false } : { speed: s });
    this.requestPropagation();
  }
  goLive() {
    clock.reset();
    this.set({ speed: 1 });
    this.requestPropagation();
  }
}

export const store = new Store();

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export const visibleAlerts = (s: AppState) => s.alerts.filter((a) => a.cdms.length > 0);

export type { Kep };
