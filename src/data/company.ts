// Fictional client organisation used by the demo. Halvane Space and
// Meridane Connect are invented names; their satellites are simulated.

export const PLATFORM = {
  name: 'Orbitrace',
  tagline: 'Conjunction intelligence',
};

export const ORG = {
  name: 'Halvane Space',
  short: 'HLV',
  user: { name: 'Elena Varga', role: 'Chief Executive Officer · Admin', initials: 'EV' },
  flightDynamicsTeam: 'Halvane Flight Dynamics',
};

export const PARTNER_ORG = {
  name: 'Meridane Connect',
  short: 'MRD',
  ops: 'Meridane Network Operations Center',
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
}

const eo = (n: number, raan: number, phase: number): FleetSpec => ({
  id: `HLV-EO-${String(n).padStart(2, '0')}`,
  name: `HALVANE EO-${String(n).padStart(2, '0')}`,
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
});

const sar = (n: number, raan: number, phase: number): FleetSpec => ({
  id: `HLV-SAR-${String(n).padStart(2, '0')}`,
  name: `HALVANE SAR-${String(n).padStart(2, '0')}`,
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
});

const iot = (n: number, raan: number, phase: number): FleetSpec => ({
  id: `HLV-IOT-${String(n).padStart(2, '0')}`,
  name: `HALVANE IOT-${String(n).padStart(2, '0')}`,
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
});

export const FLEET: FleetSpec[] = [
  eo(1, 20, 0), eo(2, 20, 120), eo(3, 20, 240),
  eo(4, 65, 40), eo(5, 65, 160), eo(6, 65, 280),
  eo(7, 110, 80), eo(8, 110, 200), eo(9, 110, 320),
  eo(10, 155, 20), eo(11, 155, 140), eo(12, 155, 260),
  sar(1, 300, 0), sar(2, 300, 180), sar(3, 330, 90), sar(4, 330, 270),
  iot(1, 0, 0), iot(2, 45, 45), iot(3, 90, 90), iot(4, 135, 135),
  iot(5, 180, 180), iot(6, 225, 225), iot(7, 270, 270), iot(8, 315, 315),
];

export const PARTNER_FLEET: FleetSpec[] = Array.from({ length: 10 }, (_, k) => ({
  id: `MRD-${String(k + 1).padStart(2, '0')}`,
  name: `MERIDANE-${String(k + 1).padStart(2, '0')}`,
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
}));

export interface DataSource {
  id: string;
  name: string;
  kind: string;
  detail: string;
  latencyMin: number;
  status: 'online' | 'degraded';
  isPublic: boolean;
}

/** Feeds aggregated by the platform. Contractors X/Y/Z are placeholders. */
export const DATA_SOURCES: DataSource[] = [
  { id: 'PUB-GP', name: 'CelesTrak GP catalog', kind: 'Public', detail: 'General perturbations element sets (OMM)', latencyMin: 180, status: 'online', isPublic: true },
  { id: 'PUB-CDM', name: 'Public CDM feed', kind: 'Public', detail: 'CCSDS 508.0-B-1 conjunction data messages', latencyMin: 60, status: 'online', isPublic: true },
  { id: 'CTR-X', name: 'Contractor X', kind: 'Ground radar', detail: 'Phased-array radar network, LEO tracking', latencyMin: 15, status: 'online', isPublic: false },
  { id: 'CTR-Y', name: 'Contractor Y', kind: 'Optical', detail: 'Ground telescopes, passive optical tracks', latencyMin: 40, status: 'online', isPublic: false },
  { id: 'CTR-Z', name: 'Contractor Z', kind: 'Space-based', detail: 'On-orbit sensors in higher orbits', latencyMin: 25, status: 'degraded', isPublic: false },
  { id: 'PTN-EPH', name: 'Partner ephemerides', kind: 'Owner/operator', detail: 'GNSS ephemerides shared by partner operators', latencyMin: 5, status: 'online', isPublic: false },
];
