// Client organisation used by the demo. SVST26 fleet and SVST Singapore
// partner satellites are simulated.

export const PLATFORM = {
  name: 'NeoLEO',
  tagline: 'Conjunction intelligence',
};

export const ORG = {
  name: 'SVST26',
  short: 'SVST',
  user: { name: 'Elena Varga', role: 'Chief Executive Officer · Admin', initials: 'EV' },
  flightDynamicsTeam: 'SVST26 Flight Dynamics',
};

export const PARTNER_ORG = {
  name: 'SVST Singapore',
  short: 'SVST-SG',
  ops: 'SVST Singapore Operations Center',
};

export type Mission = 'Earth observation' | 'SAR imaging' | 'IoT relay' | 'Broadband';

export interface FleetSpec {
  id: string;
  name: string;
  norad: number; // simulated catalog number (analyst range)
  owner: 'own' | 'partner';
  mission: Mission;
  inclinationDeg: number;
  raanDeg: number;
  altitudeKm: number;
  phaseDeg: number;
  massKg: number;
  propellantKg: number;
  ispS: number;
  thrustN: number;
  hbrM: number; // hard-body radius
  priority: 1 | 2 | 3; // 1 = highest mission priority
  bus: string;
  launchYear: number;
  lifeYears: number; // design life; end of mission = launchYear + lifeYears
  disposal: string;
  disposalPlan: string;
}

const eo = (n: number, raan: number, phase: number): FleetSpec => ({
  id: '',
  name: '',
  norad: 91000 + n,
  owner: 'own',
  mission: 'Earth observation',
  inclinationDeg: 97.45,
  raanDeg: raan,
  altitudeKm: 512 + (n % 3) * 3,
  phaseDeg: phase,
  massKg: 182,
  propellantKg: 4.2 + (n % 4) * 0.6,
  ispS: 220,
  thrustN: 0.1,
  hbrM: 4,
  priority: 1,
  bus: 'HV-180 smallsat',
  launchYear: 2023 + (n % 3),
  lifeYears: 5,
  disposal: 'Propulsive lowering + natural decay',
  disposalPlan: 'Lower perigee to 350 km with remaining propellant, then re-entry by drag within 2 years (Zero Debris < 5 yr).',
});

const sar = (n: number, raan: number, phase: number): FleetSpec => ({
  id: '',
  name: '',
  norad: 91100 + n,
  owner: 'own',
  mission: 'SAR imaging',
  inclinationDeg: 97.9,
  raanDeg: raan,
  altitudeKm: 768,
  phaseDeg: phase,
  massKg: 410,
  propellantKg: 11.5 - n,
  ispS: 1600, // electric propulsion
  thrustN: 0.03,
  hbrM: 6,
  priority: 1,
  bus: 'HV-400 radar',
  launchYear: 2025,
  lifeYears: 7,
  disposal: 'Controlled lowering (electric propulsion)',
  disposalPlan: 'Electric-propulsion spiral down from 768 km to 300 km over ~6 months, then re-entry within weeks. Propellant reserved: 2.5 kg.',
});

const iot = (n: number, raan: number, phase: number): FleetSpec => ({
  id: '',
  name: '',
  norad: 91200 + n,
  owner: 'own',
  mission: 'IoT relay',
  inclinationDeg: 51.6 + (n % 2) * 6,
  raanDeg: raan,
  altitudeKm: 600,
  phaseDeg: phase,
  massKg: 24,
  propellantKg: 0.35,
  ispS: 65, // cold gas
  thrustN: 0.02,
  hbrM: 1.5,
  priority: 2,
  bus: '12U cubesat',
  launchYear: 2024,
  lifeYears: 3,
  disposal: 'Drag sail + natural decay',
  disposalPlan: 'Deploy drag sail at end of mission; re-entry from 600 km within ~3 years. Passivation: vent cold gas, discharge batteries.',
});

/** Own fleet, named SVST001…SVST024 in list order. */
export const FLEET: FleetSpec[] = [
  eo(1, 20, 0), eo(2, 20, 120), eo(3, 20, 240),
  eo(4, 65, 40), eo(5, 65, 160), eo(6, 65, 280),
  eo(7, 110, 80), eo(8, 110, 200), eo(9, 110, 320),
  eo(10, 155, 20), eo(11, 155, 140), eo(12, 155, 260),
  sar(1, 300, 0), sar(2, 300, 180), sar(3, 330, 90), sar(4, 330, 270),
  iot(1, 0, 0), iot(2, 45, 45), iot(3, 90, 90), iot(4, 135, 135),
  iot(5, 180, 180), iot(6, 225, 225), iot(7, 270, 270), iot(8, 315, 315),
].map((f, k) => {
  const name = `SVST${String(k + 1).padStart(3, '0')}`;
  return { ...f, id: name, name };
});

export const PARTNER_FLEET: FleetSpec[] = Array.from({ length: 10 }, (_, k) => ({
  id: `SVST-SG${String(k + 1).padStart(2, '0')}`,
  name: `SVST-SG${String(k + 1).padStart(2, '0')}`,
  norad: 92000 + k + 1,
  owner: 'partner' as const,
  mission: 'Broadband' as const,
  inclinationDeg: 87.9,
  raanDeg: 15 + (k % 5) * 36,
  altitudeKm: 548,
  phaseDeg: k * 67,
  massKg: 260,
  propellantKg: 6 + (k % 3),
  ispS: 1400,
  thrustN: 0.05,
  hbrM: 5,
  priority: 2 as const,
  bus: 'MC-260',
  launchYear: 2024,
  lifeYears: 6,
  disposal: 'Propulsive deorbit',
  disposalPlan: 'Managed by SVST Singapore: direct deorbit burn sequence at end of mission.',
}));

export type SourceGroup = 'Platform' | 'Government' | 'Commercial · own sensors' | 'Commercial · fused data';

export interface DataSource {
  id: string;
  name: string;
  /** ISO 3166 alpha-2 country code ('EU' for European bodies, '' when not tied to one). */
  country: string;
  group: SourceGroup;
  kind: string;
  detail: string;
  latencyMin: number;
  status: 'online' | 'degraded';
  /** Demo: only CelesTrak and uploaded CDMs carry real data; every other feed is mocked. */
  simulated: boolean;
}

/** Emoji flag from a 2-letter code ('EU' works too). */
export const flag = (cc: string) => (cc ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐');

const src = (group: SourceGroup) => (id: string, name: string, country: string, kind: string, detail: string, latencyMin: number, status: DataSource['status'] = 'online'): DataSource =>
  ({ id, name, country, group, kind, detail, latencyMin, status, simulated: true });
const gov = src('Government');
const sensor = src('Commercial · own sensors');
const fused = src('Commercial · fused data');

/** Feeds shown in the demo. Ids LEOLABS / SLINGSHOT / VYOMA are the ones fused into CDMs (src/sim/scenario.ts). */
export const DATA_SOURCES: DataSource[] = [
  { id: 'PUB-GP', name: 'CelesTrak GP catalog', country: 'US', group: 'Platform', kind: 'Public catalog', detail: 'General perturbations element sets (OMM), redistributed from Space-Track', latencyMin: 180, status: 'online', simulated: false },
  { id: 'PUB-CDM', name: 'Public CDM feed', country: 'US', group: 'Platform', kind: 'CDM', detail: 'CCSDS 508.0-B-1 conjunction data messages', latencyMin: 60, status: 'online', simulated: true },
  { id: 'PTN-EPH', name: 'Partner ephemerides', country: 'SG', group: 'Platform', kind: 'Owner/operator', detail: `GNSS ephemerides shared by ${PARTNER_ORG.name}`, latencyMin: 5, status: 'online', simulated: true },
  { id: 'EXT-CDM', name: 'Ingested CDMs', country: '', group: 'Platform', kind: 'Upload', detail: 'Uploaded CDMs, consistency-gated then fused by covariance intersection', latencyMin: 0, status: 'online', simulated: false },

  gov('SPACETRACK', 'Space-Track / 18 SDS', 'US', 'Catalog', 'US Space Force catalog of orbital elements', 120),
  gov('SPACEFENCE', 'Space Fence', 'US', 'S-band radar', 'US Space Force radar, feeds the 18 SDS catalog', 30),
  gov('TRACSS', 'TraCSS', 'US', 'Conjunction service', 'US Department of Commerce traffic coordination', 240, 'degraded'),
  gov('EUSST', 'EU SST', 'EU', 'Sensor network', 'Member-state sensors, EU surveillance and tracking', 90),
  gov('GESTRA', 'GESTRA', 'DE', 'Radar', 'Phased-array surveillance radar', 45),
  gov('GRAVES', 'GRAVES', 'FR', 'Bistatic radar', 'French surveillance radar', 60),
  gov('S3TSR', 'S3TSR', 'ES', 'Radar + optical', 'Spanish surveillance and tracking sensors', 75),
  gov('BIRALES', 'BIRALES / BIRALET / MFDR', 'IT', 'Passive radar', 'Passive and multistatic radar', 50),
  gov('FLYEYE', 'ESA Flyeye', 'EU', 'Optical', 'Wide-field survey telescope', 120),

  sensor('LEOLABS', 'LeoLabs', 'US', 'Ground radar', 'Global radar network, LEO tracking', 15),
  sensor('SLINGSHOT', 'Slingshot Aerospace', 'US', 'Ground optical', 'Global ground optical network', 40),
  sensor('STARGAZE', 'SpaceX Stargaze', 'US', 'Space-based', 'Starlink star-tracker detections', 10),
  sensor('LOOKUP', 'Look Up Space', 'FR', 'Ground radar', 'LEO surveillance radar', 20),
  sensor('SPACEFLUX', 'Spaceflux', 'GB', 'Optical', 'Ground and on-orbit optical tracking', 35),
  sensor('SILENTIUM', 'Silentium Defence', 'AU', 'Passive radar', 'Signals-of-opportunity radar', 30),
  sensor('VYOMA', 'Vyoma', 'DE', 'Space-based', 'On-orbit optical sensors', 25, 'degraded'),
  sensor('DIGANTARA', 'Digantara', 'IN', 'Space-based', 'On-orbit SSA sensors', 25),
  sensor('ARCA', 'ARCA Dynamics', 'IT', 'Ground optical', 'Optical LEO tracking', 40),
  sensor('SCOUT', 'Scout Space', 'US', 'Space-based', 'On-orbit optical sensors', 30),
  sensor('TURION', 'Turion Space', 'US', 'Space-based', 'On-orbit SDA sensors', 30),
  sensor('ALDORIA', 'Aldoria', 'FR', 'Ground optical', 'Optical surveillance and tracking', 45),
  sensor('CN-CONST', 'Aotian · Kaiyun · Xingyan', 'CN', 'Space-based', 'Commercial sensor constellations', 60),

  fused('ECOSMIC', 'Ecosmic', 'IT', 'Fusion', 'Collision-avoidance software on fused catalogs', 30),
  fused('KAYHAN', 'Kayhan', 'US', 'Fusion', 'Data fusion and coordination', 30),
  fused('OKAPI', 'OKAPI:Orbits', 'DE', 'Fusion', 'Orbit determination and collision avoidance', 30),
  fused('NEURASPACE', 'Neuraspace', 'PT', 'AI analytics', 'AI services for space traffic management', 30),
  fused('COMSPOC', 'COMSPOC', 'US', 'Fusion', 'SSA services with partner sensors', 20),
  fused('PRIVATEER', 'Privateer', 'US', 'Analytics', 'Visualisation and analysis platform', 60),
  fused('HEO', 'HEO', 'AU', 'Imaging', 'Non-cooperative satellite imaging', 120),
  fused('NORTHSTAR', 'NorthStar', 'CA', 'Hybrid', 'Own and third-party data', 45),
  fused('TELESPAZIO', 'Telespazio / Leonardo ISOC', 'IT', 'Operations centre', 'SSA operations centre', 30),
  fused('SPACEDYS', 'SpaceDyS', 'IT', 'Orbit determination', 'Orbit determination services', 45),
  fused('FR-SSA', 'Sodern · Eutelsat · ArianeGroup', 'FR', 'SSA services', 'French SSA programmes and services', 60),
];
