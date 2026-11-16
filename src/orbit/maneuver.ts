// Collision-avoidance maneuver search. In the product this is the AI
// planning model; in the demo it is a deterministic search over impulsive
// along-track burns, each verified by re-propagating the orbits and
// recomputing miss distance and Pc against the fused covariance.
import { applyBurn, meanMotion, period, stateAt, type Kep } from './kepler';
import { encounter, type EncounterGeometry, type SigmaRtn } from './pc';
import { bodyState, refineTca, type Body } from './screening';

const G0 = 9.80665;
export const PC_TARGET = 1e-6;
/** "Safest" profile: Pc a hundred times below the normal target and at least 1 km miss. */
export const PC_SAFE = 1e-8;
export const MISS_SAFE_KM = 1.0;

/** Profiles the planner always surfaces, each on the option that best fits it. */
export type Profile = 'balanced' | 'fuel' | 'safe' | 'lead';
export const PROFILE_INFO: Record<Profile, { label: string; why: string }> = {
  balanced: { label: 'Recommended', why: 'Best overall score: propellant weighted by mission priority, time left to verify and upload, and residual risk.' },
  fuel: { label: 'Lowest fuel', why: 'Least propellant of all options that still bring Pc below 1e-6: the longest satellite lifetime.' },
  safe: { label: 'Safest', why: 'Lowest residual collision probability, with at least 1 km miss and Pc below 1e-8: margin against tracking errors.' },
  lead: { label: 'Most lead time', why: 'Earliest burn: the most time to upload the command, verify it, and re-plan if something goes wrong.' },
};

export interface SatBudget {
  id: string;
  name: string;
  operator: string;
  massKg: number;
  propellantKg: number;
  ispS: number;
  thrustN: number;
  priority: 1 | 2 | 3;
}

export interface Burn {
  satId: string;
  satName: string;
  operator: string;
  time: number;
  dvRtnMs: [number, number, number];
  dvMs: number;
  propellantG: number;
  durationS: number;
  deltaAltKm: number;
  driftKmPerDay: number;
  budgetUsedPct: number;
}

export interface ManeuverOption {
  id: string;
  label: string;
  strategy: 'own' | 'partner' | 'shared';
  burns: Burn[];
  result: { tca: number; missKm: number; pc: number; geometry: EncounterGeometry };
  totalDvMs: number;
  recoveryDvMs: number;
  score: number;
  recommended: boolean;
  rationale: string;
  /** Profiles this option wins (an option can win several). */
  profiles: Profile[];
}

export interface PlanInput {
  now: number;
  tca: number;
  primary: { kep: Kep; budget: SatBudget };
  secondary: { body: Body; budget?: SatBudget }; // budget present => maneuverable partner
  sigP: SigmaRtn;
  sigS: SigmaRtn;
  hbrKm: number;
}

const DV_GRID_CMS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 32, 40, 50];

function burnFor(b: SatBudget, kep: Kep, t: number, dvT: number): Burn {
  const dv = Math.abs(dvT) * 1000; // m/s
  const prop = b.massKg * (1 - Math.exp(-dv / (b.ispS * G0))) * 1000;
  const v = Math.sqrt(398600.4418 / kep.a);
  const da = (2 * kep.a * (dvT / v)); // km, near-circular
  const dn = -1.5 * meanMotion(kep.a) * (da / kep.a);
  return {
    satId: b.id,
    satName: b.name,
    operator: b.operator,
    time: t,
    dvRtnMs: [0, dvT * 1000, 0],
    dvMs: dv,
    propellantG: prop,
    durationS: (b.massKg * dv) / b.thrustN,
    deltaAltKm: da,
    driftKmPerDay: dn * 86400 * kep.a,
    budgetUsedPct: (prop / 1000 / b.propellantKg) * 100,
  };
}

function evaluate(pk: Kep, sb: Body, inp: PlanInput) {
  const p: Body = { type: 'kep', kep: pk };
  const ref = refineTca(p, sb, inp.tca - 240e3, inp.tca + 240e3);
  if (!ref) return null;
  const a = bodyState(p, ref.t)!, b = bodyState(sb, ref.t)!;
  const g = encounter(a.r, a.v, b.r, b.v, inp.sigP, inp.sigS, inp.hbrKm);
  return { tca: ref.t, missKm: g.missKm, pc: g.pc, geometry: g };
}

function leadTimes(inp: PlanInput, kep: Kep): number[] {
  const P = period(kep.a) * 1000;
  return [0.5, 1.5, 2.5, 3.5, 5.5]
    .map((r) => inp.tca - r * P)
    .filter((t) => t > inp.now + 20 * 60e3);
}

/** Smallest along-track burn at time t that brings Pc below target (and miss above missMin). */
function minimalBurn(kep: Kep, sb: Body, t: number, inp: PlanInput, scaleOther?: (dv: number) => Body, pcTarget = PC_TARGET, missMin = 0.4) {
  let best: { dvT: number; res: NonNullable<ReturnType<typeof evaluate>> } | null = null;
  for (const sign of [1, -1]) {
    for (const cms of DV_GRID_CMS) {
      const dvT = (sign * cms) / 1e5; // km/s
      const k2 = applyBurn(kep, t, [0, dvT, 0]);
      const res = evaluate(k2, scaleOther ? scaleOther(dvT) : sb, inp);
      if (res && res.pc < pcTarget && res.missKm > missMin) {
        if (!best || Math.abs(dvT) < Math.abs(best.dvT)) best = { dvT, res };
        break;
      }
    }
  }
  return best;
}

export function planAvoidance(inp: PlanInput): ManeuverOption[] {
  const opts: ManeuverOption[] = [];
  const pb = inp.primary.budget;
  const primLeads = leadTimes(inp, inp.primary.kep);

  // 1. Own satellite maneuvers only (the only choice against passive objects).
  primLeads.forEach((t, k) => {
    const m = minimalBurn(inp.primary.kep, inp.secondary.body, t, inp);
    if (!m) return;
    const burn = burnFor(pb, inp.primary.kep, t, m.dvT);
    opts.push({
      id: `own-${k}`,
      label: `${pb.name} ${m.dvT > 0 ? 'posigrade' : 'retrograde'} burn`,
      strategy: 'own',
      burns: [burn],
      result: m.res,
      totalDvMs: burn.dvMs,
      recoveryDvMs: burn.dvMs,
      score: 0,
      recommended: false,
      rationale: '',
      profiles: [],
    });
  });

  // 1b. Extra-margin variants of our own burn (candidates for the "Safest" profile).
  primLeads.forEach((t, k) => {
    const m = minimalBurn(inp.primary.kep, inp.secondary.body, t, inp, undefined, PC_SAFE, MISS_SAFE_KM);
    if (!m) return;
    const burn = burnFor(pb, inp.primary.kep, t, m.dvT);
    opts.push({
      id: `safe-${k}`,
      label: `${pb.name} ${m.dvT > 0 ? 'posigrade' : 'retrograde'} burn · extra margin`,
      strategy: 'own',
      burns: [burn],
      result: m.res,
      totalDvMs: burn.dvMs,
      recoveryDvMs: burn.dvMs,
      score: 0,
      recommended: false,
      rationale: '',
      profiles: [],
    });
  });

  // 2. Cooperative secondary: partner-only and shared plans.
  const sb = inp.secondary.budget;
  if (sb && inp.secondary.body.type === 'kep') {
    const sk = inp.secondary.body.kep;
    const swapped: PlanInput = { ...inp, sigP: inp.sigS, sigS: inp.sigP };
    leadTimes(inp, sk).forEach((t, k) => {
      const m = minimalBurn(sk, { type: 'kep', kep: inp.primary.kep }, t, swapped);
      if (!m) return;
      const burn = burnFor(sb, sk, t, m.dvT);
      opts.push({
        id: `partner-${k}`,
        label: `${sb.name} ${m.dvT > 0 ? 'posigrade' : 'retrograde'} burn`,
        strategy: 'partner',
        burns: [burn],
        result: m.res,
        totalDvMs: burn.dvMs,
        recoveryDvMs: burn.dvMs,
        score: 0,
        recommended: false,
        rationale: '',
        profiles: [],
      });
    });
    // Shared: both burn at the same lead, opposite along-track directions, split by weight.
    const wP = weight(pb), wS = weight(sb);
    const shareP = wS / (wP + wS); // the cheaper-to-move satellite takes the larger share
    primLeads.slice(0, 3).forEach((t, k) => {
      let bestForLead: ManeuverOption | null = null;
      for (const sign of [1, -1]) {
        let found: ManeuverOption | null = null;
        for (const cms of DV_GRID_CMS) {
          const total = cms / 1e5;
          const dvP = sign * total * shareP;
          const dvS = -sign * total * (1 - shareP);
          const kp = applyBurn(inp.primary.kep, t, [0, dvP, 0]);
          const ks = applyBurn(sk, t, [0, dvS, 0]);
          const res = evaluate(kp, { type: 'kep', kep: ks }, inp);
          if (res && res.pc < PC_TARGET && res.missKm > 0.4) {
            const b1 = burnFor(pb, inp.primary.kep, t, dvP);
            const b2 = burnFor(sb, sk, t, dvS);
            found = {
              id: `shared-${k}-${sign}`,
              label: `Joint burn · ${Math.round(shareP * 100)}/${Math.round((1 - shareP) * 100)} split`,
              strategy: 'shared',
              burns: [b1, b2],
              result: res,
              totalDvMs: b1.dvMs + b2.dvMs,
              recoveryDvMs: b1.dvMs + b2.dvMs,
              score: 0,
              recommended: false,
              rationale: '',
              profiles: [],
            };
            break;
          }
        }
        if (found && (!bestForLead || found.totalDvMs < bestForLead.totalDvMs)) bestForLead = found;
      }
      if (bestForLead) opts.push(bestForLead);
    });
  }

  // Score: normalised propellant use weighted by mission priority, plus a
  // penalty for burns close to TCA (less time to verify and upload).
  for (const o of opts) {
    const fuel = o.burns.reduce((s, b) => s + (b.budgetUsedPct / 100) * (4 - (budgetOf(inp, b.satId)?.priority ?? 2)), 0);
    const leadH = (inp.tca - Math.min(...o.burns.map((b) => b.time))) / 3600e3;
    const urgency = leadH < 1 ? 0.6 : leadH < 2 ? 0.25 : 0;
    const fairness = o.strategy === 'shared' ? -0.04 : 0;
    o.score = fuel * 40 + urgency + Math.log10(Math.max(o.result.pc, 1e-15)) * -0.01 + fairness;
  }
  opts.sort((a, b) => a.score - b.score);
  const pick = sb ? opts.find((o) => o.strategy === 'shared') ?? opts[0] : opts[0];
  if (pick) {
    pick.recommended = true;
    pick.rationale = sb
      ? 'Lowest combined cost for both missions: Δv is split so the satellite with more propellant margin and lower mission priority takes the larger share, and both operators keep their service windows.'
      : 'Smallest Δv that brings Pc below 1e-6 while leaving at least one orbit between burn and TCA for command upload and verification.';
  }
  // Profiles: tag the winner of each, then keep the tagged options first so all of them are always shown.
  if (pick) pick.profiles.push('balanced');
  const prop = (o: ManeuverOption) => o.burns.reduce((t, b) => t + b.propellantG, 0);
  const first = (o: ManeuverOption) => Math.min(...o.burns.map((b) => b.time));
  const winner = (better: (a: ManeuverOption, b: ManeuverOption) => boolean) => opts.reduce<ManeuverOption | undefined>((w, o) => (!w || better(o, w) ? o : w), undefined);
  winner((a, b) => prop(a) < prop(b) - 1e-9)?.profiles.push('fuel');
  winner((a, b) => a.result.pc < b.result.pc * 0.999 || (a.result.pc <= b.result.pc * 1.001 && a.result.missKm > b.result.missKm))?.profiles.push('safe');
  winner((a, b) => first(a) < first(b) || (first(a) === first(b) && prop(a) < prop(b)))?.profiles.push('lead');
  const tagged = opts.filter((o) => o.profiles.length);
  return [...tagged, ...opts.filter((o) => !o.profiles.length)].slice(0, Math.max(5, tagged.length));
}

function weight(b: SatBudget) {
  // Higher weight = more expensive to maneuver.
  return (4 - b.priority) / Math.max(0.05, b.propellantKg);
}

function budgetOf(inp: PlanInput, id: string) {
  return inp.primary.budget.id === id ? inp.primary.budget : inp.secondary.budget;
}

/** Primary orbit after the burns of an option that apply to it. */
export function postManeuverKep(kep: Kep, satId: string, o: ManeuverOption): Kep {
  let k = kep;
  for (const b of o.burns) if (b.satId === satId) k = applyBurn(k, b.time, [0, b.dvRtnMs[1] / 1000, 0]);
  return k;
}

export { stateAt };
