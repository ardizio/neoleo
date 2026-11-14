import type { EncounterGeometry } from '../orbit/pc';

interface Props {
  g: EncounterGeometry;
  hbrKm: number;
  after?: EncounterGeometry | null;
  color: string;
}

/** Encounter-plane view: combined covariance ellipses around the estimated miss vector. */
export function BPlane({ g, hbrKm, after, color }: Props) {
  const W = 360, H = 230, cx = W / 2, cy = H / 2;
  const reach = Math.max(
    Math.hypot(g.bPlane[0], g.bPlane[1]) + 3.2 * g.sigmaMajorKm,
    after ? Math.hypot(after.bPlane[0], after.bPlane[1]) * 1.15 : 0,
    0.05,
  );
  const s = (Math.min(W, H) / 2 - 14) / reach; // px per km
  const px = (x: number) => cx + x * s;
  const py = (y: number) => cy - y * s;
  const ang = (-g.ellipseAngle * 180) / Math.PI;
  const tick = niceStep(reach);
  const ticks: number[] = [];
  for (let v = -Math.floor(reach / tick) * tick; v <= reach; v += tick) ticks.push(v);
  return (
    <svg className="bplane" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Encounter plane with covariance ellipse">
      <rect x="0" y="0" width={W} height={H} rx="10" className="bp-bg" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={px(v)} y1={8} x2={px(v)} y2={H - 8} className="bp-grid" />
          {Math.abs(v) < 1e-9 ? null : <text x={px(v)} y={H - 10} className="bp-tick">{fmt(v)}</text>}
          {py(v) > 8 && py(v) < H - 8 && <line x1={8} y1={py(v)} x2={W - 8} y2={py(v)} className="bp-grid" />}
        </g>
      ))}
      <line x1={8} y1={cy} x2={W - 8} y2={cy} className="bp-axis" />
      <line x1={cx} y1={8} x2={cx} y2={H - 8} className="bp-axis" />
      <g transform={`translate(${px(g.bPlane[0])} ${py(g.bPlane[1])}) rotate(${ang})`}>
        <ellipse rx={g.sigmaMajorKm * 3 * s} ry={Math.max(1, g.sigmaMinorKm * 3 * s)} fill={color} fillOpacity="0.07" stroke={color} strokeOpacity="0.45" strokeDasharray="3 3" />
        <ellipse rx={g.sigmaMajorKm * s} ry={Math.max(1, g.sigmaMinorKm * s)} fill={color} fillOpacity="0.16" stroke={color} strokeOpacity="0.9" />
      </g>
      <line x1={cx} y1={cy} x2={px(g.bPlane[0])} y2={py(g.bPlane[1])} stroke={color} strokeWidth="1.5" />
      <circle cx={px(g.bPlane[0])} cy={py(g.bPlane[1])} r="3.5" fill={color} />
      {after && (
        <g>
          <line x1={px(g.bPlane[0])} y1={py(g.bPlane[1])} x2={px(after.bPlane[0])} y2={py(after.bPlane[1])} className="bp-move" markerEnd="url(#bp-arrow)" />
          <circle cx={px(after.bPlane[0])} cy={py(after.bPlane[1])} r="5" className="bp-after" />
        </g>
      )}
      <circle cx={cx} cy={cy} r={Math.max(3, hbrKm * s)} className="bp-hbr" />
      <text x={12} y={20} className="bp-title">Encounter plane · 1σ / 3σ combined covariance</text>
      <g transform={`translate(14 ${H - 40})`} className="bp-legend">
        <circle cx="4" cy="0" r="3.5" className="bp-hbr" />
        <text x="12" y="3.5">Primary (hard body)</text>
        <circle cx="4" cy="14" r="3.5" fill={color} />
        <text x="12" y="17.5">Secondary estimate</text>
      </g>
      <defs>
        <marker id="bp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#1f9d55" />
        </marker>
      </defs>
    </svg>
  );
}

function niceStep(r: number) {
  const raw = r / 1.3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const fmt = (km: number) => (Math.abs(km) >= 1 ? `${km.toFixed(km % 1 ? 1 : 0)} km` : `${Math.round(km * 1000)} m`);
