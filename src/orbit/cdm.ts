import { encounter } from './pc';
// CCSDS 508.0-B-1 Conjunction Data Message, KVN encoding (subset used by
// the platform: header, relative metadata and both object blocks).
import type { Vec3 } from './vec';

export interface CdmObject {
  designator: string;
  catalogName: string;
  name: string;
  intlDesignator: string;
  objectType: 'PAYLOAD' | 'ROCKET BODY' | 'DEBRIS' | 'UNKNOWN';
  operator: string;
  ephemerisName: string;
  maneuverable: 'YES' | 'NO' | 'N/A';
  r: Vec3; // km
  v: Vec3; // km/s
  sigmaRtnKm: Vec3;
}

export interface CdmData {
  messageId: string;
  created: number;
  originator: string;
  messageFor: string;
  tca: number;
  missKm: number;
  relSpeedKms: number;
  relPosRtnKm: Vec3;
  relVelRtnKms: Vec3;
  pc: number;
  screenStart: number;
  screenStop: number;
  comment?: string[];
  obj1: CdmObject;
  obj2: CdmObject;
}

const iso = (t: number) => new Date(t).toISOString().replace('Z', '');
const f = (x: number, d = 3) => x.toFixed(d);
const e = (x: number) => x.toExponential(4).toUpperCase();

function objectBlock(tag: 'OBJECT1' | 'OBJECT2', o: CdmObject): string[] {
  const s = o.sigmaRtnKm.map((k) => k * 1000);
  const vs = s.map((k) => k * 1.1e-3); // m/s, crude velocity sigma
  return [
    `OBJECT                               = ${tag}`,
    `OBJECT_DESIGNATOR                    = ${o.designator}`,
    `CATALOG_NAME                         = ${o.catalogName}`,
    `OBJECT_NAME                          = ${o.name}`,
    `INTERNATIONAL_DESIGNATOR             = ${o.intlDesignator}`,
    `OBJECT_TYPE                          = ${o.objectType}`,
    `OPERATOR_ORGANIZATION                = ${o.operator}`,
    `EPHEMERIS_NAME                       = ${o.ephemerisName}`,
    `COVARIANCE_METHOD                    = CALCULATED`,
    `MANEUVERABLE                         = ${o.maneuverable}`,
    `REF_FRAME                            = EME2000`,
    `X                                    = ${f(o.r[0], 6)} [km]`,
    `Y                                    = ${f(o.r[1], 6)} [km]`,
    `Z                                    = ${f(o.r[2], 6)} [km]`,
    `X_DOT                                = ${f(o.v[0], 9)} [km/s]`,
    `Y_DOT                                = ${f(o.v[1], 9)} [km/s]`,
    `Z_DOT                                = ${f(o.v[2], 9)} [km/s]`,
    `CR_R                                 = ${e(s[0] ** 2)} [m**2]`,
    `CT_R                                 = ${e(0)} [m**2]`,
    `CT_T                                 = ${e(s[1] ** 2)} [m**2]`,
    `CN_R                                 = ${e(0)} [m**2]`,
    `CN_T                                 = ${e(0)} [m**2]`,
    `CN_N                                 = ${e(s[2] ** 2)} [m**2]`,
    `CRDOT_R                              = ${e(0)} [m**2/s]`,
    `CRDOT_T                              = ${e(-s[0] * s[1] * 1.1e-3 * 0.4)} [m**2/s]`,
    `CRDOT_N                              = ${e(0)} [m**2/s]`,
    `CRDOT_RDOT                           = ${e(vs[0] ** 2)} [m**2/s**2]`,
    `CTDOT_R                              = ${e(-s[1] * s[0] * 1.1e-3 * 0.9)} [m**2/s]`,
    `CTDOT_T                              = ${e(0)} [m**2/s]`,
    `CTDOT_N                              = ${e(0)} [m**2/s]`,
    `CTDOT_RDOT                           = ${e(0)} [m**2/s**2]`,
    `CTDOT_TDOT                           = ${e(vs[1] ** 2)} [m**2/s**2]`,
    `CNDOT_R                              = ${e(0)} [m**2/s]`,
    `CNDOT_T                              = ${e(0)} [m**2/s]`,
    `CNDOT_N                              = ${e(0)} [m**2/s]`,
    `CNDOT_RDOT                           = ${e(0)} [m**2/s**2]`,
    `CNDOT_TDOT                           = ${e(0)} [m**2/s**2]`,
    `CNDOT_NDOT                           = ${e(vs[2] ** 2)} [m**2/s**2]`,
  ];
}

export function toKvn(c: CdmData): string {
  const lines = [
    `CCSDS_CDM_VERS                       = 1.0`,
    ...(c.comment ?? []).map((x) => `COMMENT ${x}`),
    `CREATION_DATE                        = ${iso(c.created)}`,
    `ORIGINATOR                           = ${c.originator}`,
    `MESSAGE_FOR                          = ${c.messageFor}`,
    `MESSAGE_ID                           = ${c.messageId}`,
    `TCA                                  = ${iso(c.tca)}`,
    `MISS_DISTANCE                        = ${f(c.missKm * 1000, 1)} [m]`,
    `RELATIVE_SPEED                       = ${f(c.relSpeedKms * 1000, 1)} [m/s]`,
    `RELATIVE_POSITION_R                  = ${f(c.relPosRtnKm[0] * 1000, 1)} [m]`,
    `RELATIVE_POSITION_T                  = ${f(c.relPosRtnKm[1] * 1000, 1)} [m]`,
    `RELATIVE_POSITION_N                  = ${f(c.relPosRtnKm[2] * 1000, 1)} [m]`,
    `RELATIVE_VELOCITY_R                  = ${f(c.relVelRtnKms[0] * 1000, 1)} [m/s]`,
    `RELATIVE_VELOCITY_T                  = ${f(c.relVelRtnKms[1] * 1000, 1)} [m/s]`,
    `RELATIVE_VELOCITY_N                  = ${f(c.relVelRtnKms[2] * 1000, 1)} [m/s]`,
    `START_SCREEN_PERIOD                  = ${iso(c.screenStart)}`,
    `STOP_SCREEN_PERIOD                   = ${iso(c.screenStop)}`,
    `SCREEN_VOLUME_FRAME                  = RTN`,
    `SCREEN_VOLUME_SHAPE                  = ELLIPSOID`,
    `SCREEN_VOLUME_X                      = 2000 [m]`,
    `SCREEN_VOLUME_Y                      = 5000 [m]`,
    `SCREEN_VOLUME_Z                      = 2000 [m]`,
    `COLLISION_PROBABILITY                = ${e(c.pc)}`,
    `COLLISION_PROBABILITY_METHOD         = FOSTER-1992`,
    ...objectBlock('OBJECT1', c.obj1),
    ...objectBlock('OBJECT2', c.obj2),
  ];
  return lines.join('\n') + '\n';
}

export interface ParsedCdm {
  header: Record<string, string>;
  objects: Record<string, string>[];
  /** Non-empty lines that are not KEY = VALUE (reported by validation). */
  unparsed?: string[];
}

/** Minimal KVN reader: returns header keys and per-object key/values (units stripped). */
export function parseKvn(text: string): ParsedCdm {
  const header: Record<string, string> = {};
  const objects: Record<string, string>[] = [];
  const unparsed: string[] = [];
  let cur: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('COMMENT')) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*?)\s*(\[.*\])?$/);
    if (!m) { unparsed.push(line); continue; }
    const [, key, val] = m;
    if (key === 'OBJECT') {
      cur = { OBJECT: val };
      objects.push(cur);
      continue;
    }
    (cur ?? header)[key] = val;
  }
  return { header, objects, unparsed };
}

export interface CdmCheck { label: string; level: 'ok' | 'warn' | 'error'; detail: string }

/**
 * Structural and sanity checks of a KVN CDM against CCSDS 508.0-B-1 essentials, before anything is ingested.
 * Errors block ingest; warnings are shown but allowed.
 */
export function validateCdm(text: string): { checks: CdmCheck[]; parsed: ParsedCdm; ok: boolean } {
  const parsed = parseKvn(text);
  const { header: h, objects } = parsed;
  const checks: CdmCheck[] = [];
  const add = (label: string, level: CdmCheck['level'], detail: string) => checks.push({ label, level, detail });
  const num = (v?: string) => (v === undefined || v === '' ? NaN : Number(v));
  const date = (v?: string) => (v ? Date.parse(v.endsWith('Z') ? v : v + 'Z') : NaN);

  add('Format', h.CCSDS_CDM_VERS ? 'ok' : 'error', h.CCSDS_CDM_VERS ? `CCSDS CDM version ${h.CCSDS_CDM_VERS}` : 'CCSDS_CDM_VERS missing: not a KVN CDM');
  const missingHdr = ['CREATION_DATE', 'ORIGINATOR', 'MESSAGE_ID'].filter((k) => !h[k]);
  add('Header', missingHdr.length ? 'warn' : 'ok', missingHdr.length ? `Missing ${missingHdr.join(', ')}` : `${h.MESSAGE_ID} from ${h.ORIGINATOR}`);
  const tca = date(h.TCA);
  add('Time of closest approach', !Number.isFinite(tca) ? 'error' : tca < Date.now() - 3600e3 ? 'warn' : 'ok',
    !Number.isFinite(tca) ? 'TCA missing or not an ISO date' : tca < Date.now() - 3600e3 ? `${h.TCA} is in the past` : `${h.TCA} UTC`);
  const miss = num(h.MISS_DISTANCE);
  add('Miss distance', Number.isFinite(miss) && miss >= 0 ? 'ok' : 'error', Number.isFinite(miss) && miss >= 0 ? `${miss} m` : 'MISS_DISTANCE missing or invalid');
  const pc = num(h.COLLISION_PROBABILITY);
  add('Collision probability', !Number.isFinite(pc) ? 'warn' : pc >= 0 && pc <= 1 ? 'ok' : 'error',
    !Number.isFinite(pc) ? 'Not given: NeoLEO will compute it' : pc >= 0 && pc <= 1 ? String(h.COLLISION_PROBABILITY) : `${pc} is outside 0–1`);
  add('Objects', objects.length === 2 ? 'ok' : 'error', objects.length === 2 ? 'OBJECT1 and OBJECT2 present' : `Expected 2 object blocks, found ${objects.length}`);
  objects.slice(0, 2).forEach((o, i) => {
    const tag = `Object ${i + 1}`;
    add(`${tag} identity`, o.OBJECT_DESIGNATOR ? 'ok' : 'error', o.OBJECT_DESIGNATOR ? `${o.OBJECT_DESIGNATOR} · ${o.OBJECT_NAME ?? 'no name'}` : 'OBJECT_DESIGNATOR missing');
    const sv = ['X', 'Y', 'Z', 'X_DOT', 'Y_DOT', 'Z_DOT'].map((k) => num(o[k]));
    const r = Math.hypot(sv[0], sv[1], sv[2]);
    add(`${tag} state vector`, !sv.every(Number.isFinite) ? 'error' : r < 6378 || r > 50000 ? 'warn' : 'ok',
      !sv.every(Number.isFinite) ? 'X…Z_DOT missing or not numeric' : `|r| = ${r.toFixed(0)} km${r < 6378 || r > 50000 ? ' (implausible)' : ''}, frame ${o.REF_FRAME ?? '?'}`);
    const cov = ['CR_R', 'CT_T', 'CN_N'].map((k) => num(o[k]));
    add(`${tag} covariance`, cov.every((v) => v > 0) ? 'ok' : 'warn', cov.every((v) => v > 0) ? `σR ${Math.sqrt(cov[0]).toFixed(0)} m · σT ${Math.sqrt(cov[1]).toFixed(0)} m · σN ${Math.sqrt(cov[2]).toFixed(0)} m` : 'Diagonal RTN covariance missing: default uncertainty will be used');
  });
  if (parsed.unparsed?.length) add('Unrecognised lines', 'warn', `${parsed.unparsed.length} line(s) ignored, e.g. "${parsed.unparsed[0].slice(0, 40)}"`);
  return { checks, parsed, ok: !checks.some((c) => c.level === 'error') };
}

export interface CdmSummary {
  messageId: string;
  tca: number;
  missKm: number;
  relSpeedKms: number;
  pc: number;
  obj1: { designator: string; name: string; type: string };
  obj2: { designator: string; name: string; type: string };
}

export function summarize(p: ParsedCdm): CdmSummary {
  const num = (k: string) => Number(p.header[k]);
  const obj = (o?: Record<string, string>) => ({
    designator: o?.OBJECT_DESIGNATOR ?? '?',
    name: o?.OBJECT_NAME ?? 'UNKNOWN',
    type: o?.OBJECT_TYPE ?? 'UNKNOWN',
  });
  const tcaRaw = p.header.TCA;
  if (!tcaRaw) throw new Error('Not a CDM: missing TCA');
  return {
    messageId: p.header.MESSAGE_ID ?? 'UNKNOWN',
    tca: Date.parse(tcaRaw.endsWith('Z') ? tcaRaw : tcaRaw + 'Z'),
    missKm: num('MISS_DISTANCE') / 1000,
    relSpeedKms: num('RELATIVE_SPEED') / 1000,
    pc: Number.isFinite(num('COLLISION_PROBABILITY')) ? num('COLLISION_PROBABILITY') : 0,
    obj1: obj(p.objects[0]),
    obj2: obj(p.objects[1]),
  };
}

/**
 * Recompute the 2D Pc from a CDM's own states and full RTN position covariances (EME2000 / inertial states).
 * HBR from the argument, else the CDM's `COMMENT HBR = x [m]` line. Returns null when inputs are missing.
 */
export function pcFromCdm(text: string, hbrM?: number): number | null {
  const { objects } = parseKvn(text);
  if (objects.length < 2) return null;
  const hbr = hbrM ?? Number(text.match(/COMMENT\s+HBR\s*=\s*([\d.eE+-]+)/)?.[1]);
  if (!(hbr > 0)) return null;
  const n = (o: Record<string, string>, k: string) => Number(o[k]);
  const st = (o: Record<string, string>) => ({
    r: ['X', 'Y', 'Z'].map((k) => n(o, k)) as Vec3,
    v: ['X_DOT', 'Y_DOT', 'Z_DOT'].map((k) => n(o, k)) as Vec3,
    // m^2 -> km^2
    C: [['CR_R', 'CT_R', 'CN_R'], ['CT_R', 'CT_T', 'CN_T'], ['CN_R', 'CN_T', 'CN_N']].map((row) => row.map((k) => n(o, k) * 1e-6)),
  });
  const a = st(objects[0]), b = st(objects[1]);
  const vals = [...a.r, ...a.v, ...b.r, ...b.v, ...a.C.flat(), ...b.C.flat()];
  if (!vals.every(Number.isFinite)) return null;
  return encounter(a.r, a.v, b.r, b.v, a.C, b.C, hbr / 1000).pc;
}
