import type { State } from '../orbit/kepler';
import { encounter, severityOf, type EncounterGeometry, type Severity } from '../orbit/pc';
import { toKvn, type CdmObject } from '../orbit/cdm';
import { add, fromRtn, type Vec3 } from '../orbit/vec';
import { ORG, PARTNER_ORG } from '../data/company';
import type { CdmPlanStep } from './scenario';

export type SecondaryClass = 'DEBRIS' | 'DEFUNCT' | 'PAYLOAD' | 'PARTNER';
export type ConjunctionType = 'ACTIVE_ACTIVE' | 'ACTIVE_PASSIVE';

export interface ObjectRef {
  id: string;
  name: string;
  norad: number;
  intlId: string;
  cls: SecondaryClass | 'OWN';
  operator: string;
  hbrM: number;
}

export interface CdmRecord {
  seq: number;
  messageId: string;
  created: number;
  tca: number;
  geometry: EncounterGeometry;
  severity: Severity;
  sources: string[];
  note: string;
  sigmaPrimary: Vec3;
  sigmaSecondary: Vec3;
  kvn: string;
}

export type WorkflowStatus =
  | 'new'
  | 'acknowledged'
  | 'computing'
  | 'plan-ready'
  | 'sent-internal'
  | 'proposal-sent'
  | 'agreed'
  | 'resolved';

export interface Alert {
  id: string;
  primary: ObjectRef;
  secondary: ObjectRef;
  type: ConjunctionType;
  tca: number;
  truth: { primary: State; secondary: State };
  cdms: CdmRecord[];
  pendingPlan: CdmPlanStep[];
  releasedAt: number; // wall-clock ms of first CDM
  status: WorkflowStatus;
  designKey?: string;
  unread: boolean;
}

/** Position uncertainty model (1-sigma RTN, km) by data quality. */
export function sigmaFor(cls: SecondaryClass | 'OWN', hoursToTca: number, scale: number): Vec3 {
  const base: Record<SecondaryClass | 'OWN', Vec3> = {
    OWN: [0.006, 0.025, 0.006], // GNSS-derived owner ephemeris
    PARTNER: [0.012, 0.06, 0.012], // shared owner ephemeris
    PAYLOAD: [0.05, 0.25, 0.05],
    DEFUNCT: [0.04, 0.2, 0.04],
    DEBRIS: [0.06, 0.32, 0.06],
  };
  const g = 1 + Math.max(0, hoursToTca) / 30;
  const s = cls === 'OWN' ? 1 : scale;
  return base[cls].map((x) => x * s * g) as Vec3;
}

let cdmCounter = 4100;

export function issueCdm(alert: Alert, step: CdmPlanStep, now: number): CdmRecord {
  const { primary: p, secondary: s } = alert.truth;
  const hours = (alert.tca - now) / 3600e3;
  const sigP = sigmaFor('OWN', hours, 1);
  const sigS = sigmaFor(alert.secondary.cls as SecondaryClass, hours, step.sigmaScale);
  // Fused estimate of the secondary = truth + current estimation error.
  const bias = step.biasRtnKm ? fromRtn(step.biasRtnKm, p.r, p.v) : ([0, 0, 0] as Vec3);
  const sr = add(s.r, bias);
  const hbrKm = (alert.primary.hbrM + alert.secondary.hbrM) / 1000;
  const geometry = encounter(p.r, p.v, sr, s.v, sigP, sigS, hbrKm);
  const seq = alert.cdms.length + 1;
  const messageId = `ORT_${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}_${++cdmCounter}`;
  const obj = (o: ObjectRef, st: State, sig: Vec3): CdmObject => ({
    designator: String(o.norad),
    catalogName: o.cls === 'OWN' || o.cls === 'PARTNER' ? 'OPERATOR' : 'SATCAT',
    name: o.name,
    intlDesignator: o.intlId,
    objectType: o.cls === 'DEBRIS' ? 'DEBRIS' : 'PAYLOAD',
    operator: o.operator,
    ephemerisName: o.cls === 'OWN' || o.cls === 'PARTNER' ? 'OPERATOR_GNSS' : 'FUSED_' + step.sources.length + 'SRC',
    maneuverable: o.cls === 'OWN' || o.cls === 'PARTNER' ? 'YES' : o.cls === 'PAYLOAD' ? 'N/A' : 'NO',
    r: st.r,
    v: st.v,
    sigmaRtnKm: sig,
  });
  const kvn = toKvn({
    messageId,
    created: now,
    originator: 'NEOLEO',
    messageFor: ORG.name.toUpperCase().replace(/\s+/g, '_'),
    tca: alert.tca,
    missKm: geometry.missKm,
    relSpeedKms: geometry.relSpeedKms,
    relPosRtnKm: geometry.relPosRtn,
    relVelRtnKms: geometry.relVelRtn,
    pc: geometry.pc,
    screenStart: now,
    screenStop: now + 7 * 86400e3,
    comment: [
      `Fused solution, sources: ${step.sources.join(', ')}`,
      'Demo data: simulated operator orbit vs public catalog object; TEME states labelled EME2000',
    ],
    obj1: obj(alert.primary, p, sigP),
    obj2: obj(alert.secondary, { r: sr, v: s.v }, sigS),
  });
  return {
    seq,
    messageId,
    created: now,
    tca: alert.tca,
    geometry,
    severity: severityOf(geometry.pc, geometry.missKm),
    sources: step.sources,
    note: step.note,
    sigmaPrimary: sigP,
    sigmaSecondary: sigS,
    kvn,
  };
}

export const latest = (a: Alert) => a.cdms[a.cdms.length - 1];

export const partnerOperator = PARTNER_ORG.name;
