import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { gstime, jday, sunPos } from 'satellite.js';
import { drawEarthTexture, earthOutlines, LIGHT_EARTH } from './earthTexture';
import dayUrl from './textures/earth-day.webp';
import nightUrl from './textures/earth-night.webp';
import { clock, store, visibleAlerts, type AppState } from '../state/store';
import { objectType, objectVisible, sgp4State, shapeOf } from '../data/catalog';
import { period, stateAt, RE, type Kep } from '../orbit/kepler';
import type { Vec3 } from '../orbit/vec';
import { latest } from '../sim/alerts';
import type { Severity } from '../orbit/pc';
import { PARTNER_ORG } from '../data/company';

const SCALE = 1 / RE;
const toWorld = (r: Vec3 | Float32Array, o = 0, out = new THREE.Vector3()) =>
  out.set(r[o] * SCALE, r[o + 2] * SCALE, -r[o + 1] * SCALE);

export const COLORS = {
  payload: new THREE.Color('#2A78D6'),
  debris: new THREE.Color('#C2368F'),
  defunct: new THREE.Color('#E87BA4'),
  own: new THREE.Color('#EE7414'),
  partner: new THREE.Color('#1BAF7A'),
  critical: new THREE.Color('#e5383b'),
  warning: new THREE.Color('#f08c00'),
};

const SEV_COLOR: Record<Severity, string> = { critical: '#e5383b', warning: '#f08c00', watch: '#d4a000', monitor: '#8a96a8' };

// Far away every object is a dot. Close up (< ~1.8 Earth radii from the camera) each object
// becomes a mock silhouette by type: 4 satellite designs, rocket stages, 4 debris shapes and
// dead payloads. Dead objects tumble. Shape variant comes from the NORAD number (aVar).
const pointsVertex = /* glsl */ `
  attribute vec3 aVel;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aKind;
  attribute float aVar;
  uniform float uDt;
  uniform float uPx;
  varying vec3 vColor;
  varying float vNear;
  varying float vKind;
  varying float vVar;
  void main() {
    vec3 p = position;
    float rm = length(p);
    if (rm < 100.0 || aSize <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec3 r = p + aVel * uDt - 0.5 * 398600.4418 * p / (rm * rm * rm) * uDt * uDt;
    vec3 w = vec3(r.x, r.z, -r.y) * ${SCALE.toFixed(12)};
    vec4 mv = modelViewMatrix * vec4(w, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    vNear = 1.0 - smoothstep(0.9, 1.8, dist);
    float far = clamp(3.4 / dist, 0.6, 1.7);
    float near = clamp(4.2 / dist, 3.0, 16.0);
    gl_PointSize = aSize * uPx * mix(far, near, vNear);
    vColor = aColor;
    vKind = aKind;
    vVar = aVar;
  }
`;
const pointsFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vNear;
  varying float vKind;
  varying float vVar;
  float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return max(d.x, d.y); }
  float circ(vec2 p, float r) { return length(p) - r; }
  vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
  // Returns signed distance; .y of the result picks a darker "panel" tone.
  vec2 satellite(vec2 c, float v) {
    float body, panel;
    if (v < 0.5) {            // classic bus + two wings
      body = box(c, vec2(0.09, 0.09));
      panel = box(vec2(abs(c.x) - 0.31, c.y), vec2(0.15, 0.07));
      body = min(body, box(c, vec2(0.18, 0.01)));
    } else if (v < 1.5) {     // cubesat with one long deployable array
      body = box(c, vec2(0.07, 0.1));
      panel = box(c - vec2(0.27, 0.0), vec2(0.19, 0.05));
    } else if (v < 2.5) {     // comsat: bus, dish, short wings
      body = min(box(c, vec2(0.1, 0.1)), abs(circ(c - vec2(0.0, 0.2), 0.09)) - 0.022);
      panel = box(vec2(abs(c.x) - 0.26, c.y + 0.02), vec2(0.12, 0.06));
    } else {                  // large platform, four arrays in a cross
      body = box(c, vec2(0.1, 0.1));
      panel = min(box(vec2(abs(c.x) - 0.28, c.y), vec2(0.15, 0.055)), box(vec2(c.x, abs(c.y) - 0.28), vec2(0.055, 0.15)));
    }
    return vec2(min(body, panel), panel < body ? 1.0 : 0.0);
  }
  vec2 rocket(vec2 c, float v) {
    float len = 0.30 + 0.06 * v;
    float tank = box(c, vec2(0.075, len));
    float nozzle = box(c - vec2(0.0, -len - 0.05), vec2(0.04 + (c.y + len) * -0.5, 0.05));
    float band = box(c - vec2(0.0, len * 0.35), vec2(0.08, 0.012));
    return vec2(min(tank, nozzle), band < 0.0 || nozzle < 0.0 ? 1.0 : 0.0);
  }
  vec2 debris(vec2 c, float v) {
    if (v < 0.5) return vec2(abs(c.x) * 1.6 + abs(c.y) * 0.9 + c.x * c.y * 2.0 - 0.17, 0.0);           // shard
    if (v < 1.5) return vec2(box(c, vec2(0.26, 0.035)), 1.0);                                            // panel strip
    if (v < 2.5) return vec2(min(circ(c, 0.09), min(circ(c - vec2(0.15, 0.08), 0.06), circ(c + vec2(0.13, 0.1), 0.05))), 0.0); // cluster
    return vec2(max(max(-c.y - 0.12, c.y - c.x * 1.7 - 0.12), c.y + c.x * 1.7 - 0.12), 1.0);            // triangle chunk
  }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.38, 0.5, length(c));
    // Per-object tumble: seed in fract(vVar)/0.4. Rates 0.02–0.25 rad/s, either direction, slowed further up close.
    float seed = fract(vVar) / 0.4;
    float rate = (0.02 + 0.23 * seed * seed) * (fract(seed * 7.13) < 0.5 ? -1.0 : 1.0) * mix(1.0, 0.4, vNear);
    float spin = vKind < 0.5 ? 0.6 : seed * 6.2832 + uTime * rate + 0.15 * sin(uTime * (0.3 + seed));
    vec2 q = rot(c, spin);
    vec2 g;
    if (vKind < 0.5) g = satellite(q, vVar);
    else if (vKind < 1.5) g = debris(q, vVar);
    else if (vKind < 2.5) g = satellite(q * 1.2, mod(vVar, 2.0));
    else g = rocket(q, vVar);
    float glyph = 1.0 - smoothstep(-0.012, 0.012, g.x);
    float edge = smoothstep(-0.035, -0.012, g.x) * glyph;
    vec3 col = vColor * mix(1.0, 0.6, g.y * vNear);
    col = mix(col, vec3(1.0), edge * 0.35 * vNear);
    float a = mix(disc, glyph, vNear);
    if (a < 0.02) discard;
    gl_FragColor = vec4(col, a * 0.92);
  }
`;
const fleetVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aRing;
  uniform float uPx;
  varying vec3 vColor;
  varying float vRing;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPx * clamp(3.0 / -mv.z, 0.8, 1.5);
    vColor = aColor;
    vRing = aRing;
  }
`;
const fleetFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vRing;
  uniform float uTime;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float core = 1.0 - smoothstep(0.42, 0.52, d);
    float halo = (1.0 - smoothstep(0.52, 1.0, d)) * 0.28;
    float ring = 0.0;
    if (vRing > 0.5) {
      float rr = fract(uTime * 0.9);
      ring = (1.0 - smoothstep(0.0, 0.08, abs(d - (0.5 + rr * 0.5)))) * (1.0 - rr);
    }
    vec3 col = vColor;
    float a = max(core, max(halo, ring));
    if (a < 0.02) discard;
    // white outline between core and halo
    float edge = smoothstep(0.40, 0.46, d) * (1.0 - smoothstep(0.52, 0.6, d));
    col = mix(col, vec3(1.0), edge);
    gl_FragColor = vec4(col, a);
  }
`;

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const earthFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec3 base = texture2D(uMap, vUv).rgb;
    float ndl = dot(normalize(vNormalW), normalize(uSun));
    float day = smoothstep(-0.18, 0.22, ndl);
    vec3 night = base * vec3(0.80, 0.84, 0.93);
    vec3 col = mix(night, base, day);
    float fres = pow(1.0 - max(dot(normalize(vNormalW), vViewDir), 0.0), 3.0);
    col = mix(col, vec3(0.70, 0.79, 0.96), fres * 0.22);
    gl_FragColor = vec4(col, 1.0);
  }
`;
// Photoreal: NASA Blue Marble by day, Black Marble city lights by night (no sun glint: it read as a glare spot).
const photoFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 l = normalize(uSun);
    vec3 v = normalize(vViewDir);
    float ndl = dot(n, l);
    float day = smoothstep(-0.10, 0.20, ndl);
    vec3 dayCol = texture2D(uDay, vUv).rgb * (0.30 + 0.85 * clamp(ndl + 0.2, 0.0, 1.0));
    vec3 lights = texture2D(uNight, vUv).rgb;
    vec3 nightCol = dayCol * 0.05 + lights * vec3(1.0, 0.80, 0.52) * 1.4;
    vec3 col = mix(nightCol, dayCol, day);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col = mix(col, vec3(0.32, 0.58, 1.0), fres * 0.55 * smoothstep(-0.3, 0.3, ndl));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;
const atmoFragment = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float i = pow(max(0.0, 0.62 - dot(normalize(vNormalW), vViewDir)), 2.2);
    gl_FragColor = vec4(0.55, 0.69, 0.98, i * 0.75);
  }
`;

interface FleetEntry {
  id: string;
  kep: Kep;
  own: boolean;
  label: CSS2DObject;
  pos: THREE.Vector3;
}

export class GlobeScene {
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  earth: THREE.Mesh;
  private mapMat: THREE.ShaderMaterial;
  private outlines: THREE.Group;
  private photoMat: THREE.ShaderMaterial | null = null;
  earthGroup = new THREE.Group();
  sunUniform = new THREE.Vector3(1, 0, 0);
  points!: THREE.Points;
  pointsGeo = new THREE.BufferGeometry();
  pointsMat: THREE.ShaderMaterial;
  fleetGeo = new THREE.BufferGeometry();
  fleetMat: THREE.ShaderMaterial;
  fleetPoints: THREE.Points;
  fleet: FleetEntry[] = [];
  fleetOrbitGroup = new THREE.Group();
  focusGroup = new THREE.Group();
  selectionMarker: THREE.Sprite;
  tcaMarker: THREE.Sprite;
  tooltip: HTMLDivElement;
  private lastVersion = -1;
  private lastRequest = 0;
  private lastWall = 0;
  private lastSim = 0;
  private tumbleT = 0;
  private catalogT = 0;
  private raf = 0;
  private lastState: AppState | null = null;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; t0: number; dur: number } | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  /** Active drag: the Earth-fixed point grabbed under the finger (null when the finger started in space). */
  private grab: { id: number; local: THREE.Vector3 | null; x: number; y: number; moved: boolean } | null = null;
  private pointers = new Set<number>();
  private dragRay = new THREE.Raycaster();
  private unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  private unsub: () => void;
  private resizeObs: ResizeObserver;
  private focusKey = '';
  private selectionKey = '';
  private colorKey = '';
  private fleetKepKey = '';
  private layerKey = '';
  private hoverAt = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'globe-labels';
    host.appendChild(this.labelRenderer.domElement);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'globe-tooltip';
    host.appendChild(this.tooltip);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 400);
    this.camera.position.set(0.9, 1.4, 3.9).normalize().multiplyScalar(4.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // One-finger / mouse drag is our own "grab" rotation (see onDragMove); OrbitControls only zooms (wheel, pinch) and auto-rotates.
    // No damping: the globe stops the moment the finger lifts instead of drifting.
    this.controls.enableDamping = false;
    this.controls.enableRotate = false;
    this.controls.enablePan = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 22;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => {
      this.fly = null;
      if (store.state.autoRotate) store.set({ autoRotate: false });
    });

    // Earth
    // Coast/border strokes come from vector lines (buildOutlines); the texture is fill only.
    const big = this.renderer.capabilities.maxTextureSize >= 8192 && !matchMedia('(max-width: 760px)').matches;
    const tex = new THREE.CanvasTexture(drawEarthTexture(big ? 8192 : 4096, { ...LIGHT_EARTH, border: 'rgba(0,0,0,0)', coast: 'rgba(0,0,0,0)' }));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.mapMat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: tex }, uSun: { value: this.sunUniform } }, vertexShader: earthVertex, fragmentShader: earthFragment });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), this.mapMat);
    this.earthGroup.add(this.earth);
    this.outlines = this.buildOutlines();
    this.earthGroup.add(this.outlines);
    this.scene.add(this.earthGroup);
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.07, 96, 64),
      new THREE.ShaderMaterial({ vertexShader: earthVertex, fragmentShader: atmoFragment, side: THREE.BackSide, transparent: true, depthWrite: false }),
    );
    this.scene.add(atmo);

    // Catalog points
    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: { uDt: { value: 0 }, uPx: { value: this.renderer.getPixelRatio() }, uTime: { value: 0 } },
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.pointsGeo, this.pointsMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Fleet points
    this.fleetMat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: this.renderer.getPixelRatio() }, uTime: { value: 0 } },
      vertexShader: fleetVertex,
      fragmentShader: fleetFragment,
      transparent: true,
      depthWrite: false,
    });
    this.fleetPoints = new THREE.Points(this.fleetGeo, this.fleetMat);
    this.fleetPoints.frustumCulled = false;
    this.fleetPoints.renderOrder = 3;
    this.scene.add(this.fleetOrbitGroup, this.focusGroup, this.fleetPoints);

    this.selectionMarker = this.makeRingSprite('#14275E', 1);
    this.tcaMarker = this.makeRingSprite('#e5383b', 2);
    this.scene.add(this.selectionMarker, this.tcaMarker);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.pointers.add(e.pointerId);
      if (this.pointers.size !== 1 || e.button > 0) { this.grab = null; return; } // pinch / right button: zoom only
      const hit = this.hitEarth(e);
      this.grab = { id: e.pointerId, local: hit ? this.earthGroup.worldToLocal(hit) : null, x: e.clientX, y: e.clientY, moved: false };
    });
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.grab?.id === e.pointerId) this.grab = null;
    };
    el.addEventListener('pointerup', (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) this.onClick(e);
      this.down = null;
      release(e);
    });
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointermove', (e) => {
      if (this.grab && e.pointerId === this.grab.id && this.pointers.size === 1) this.onDragMove(e);
      else this.onHover(e);
    });
    el.addEventListener('pointerleave', () => (this.tooltip.style.opacity = '0'));

    this.unsub = store.subscribe(() => this.sync());
    this.sync();
    this.loop();
  }

  private makeRingSprite(color: string, kind: 1 | 2) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.strokeStyle = color;
    g.lineWidth = kind === 1 ? 6 : 7;
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.stroke();
    if (kind === 2) {
      g.fillStyle = color;
      g.globalAlpha = 0.18;
      g.beginPath();
      g.arc(64, 64, 50, 0, Math.PI * 2);
      g.fill();
    } else {
      g.lineWidth = 4;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.beginPath();
        g.moveTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54);
        g.lineTo(64 + Math.cos(a) * 64, 64 + Math.sin(a) * 64);
        g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.setScalar(0.045);
    s.visible = false;
    s.renderOrder = 10;
    return s;
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    // Portrait (phones): keep the 38° framing horizontally so the globe is not cropped at the sides.
    const a = this.camera.aspect;
    this.camera.fov = a >= 1 ? 38 : Math.min(70, (2 * Math.atan(Math.tan((19 * Math.PI) / 180) / a) * 180) / Math.PI);
    this.camera.updateProjectionMatrix();
  }

  /** Vector coastlines + borders in the same frame as the sphere's equirectangular UVs. */
  private buildOutlines() {
    const { coast, borders } = earthOutlines();
    const R = 1.0006;
    const seg = (lines: number[][][]) => {
      const pts: number[] = [];
      for (const line of lines) {
        for (let k = 1; k < line.length; k++) {
          for (const [lon, lat] of [line[k - 1], line[k]]) {
            const phi = ((lon + 180) * Math.PI) / 180, la = (lat * Math.PI) / 180;
            pts.push(-Math.cos(phi) * Math.cos(la) * R, Math.sin(la) * R, Math.sin(phi) * Math.cos(la) * R);
          }
        }
      }
      return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    };
    const g = new THREE.Group();
    g.add(new THREE.LineSegments(seg(coast), new THREE.LineBasicMaterial({ color: '#A9B0C6' })));
    g.add(new THREE.LineSegments(seg(borders), new THREE.LineBasicMaterial({ color: '#D9DCE6' })));
    return g;
  }

  /** Built on first use so map-only sessions never download the imagery. */
  private photoMaterial() {
    if (this.photoMat) return this.photoMat;
    const load = (url: string) => {
      const t = new THREE.TextureLoader().load(url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return t;
    };
    this.photoMat = new THREE.ShaderMaterial({
      uniforms: { uDay: { value: load(dayUrl) }, uNight: { value: load(nightUrl) }, uSun: { value: this.sunUniform } },
      vertexShader: earthVertex,
      fragmentShader: photoFragment,
    });
    return this.photoMat;
  }

  // ---------- state sync ----------
  private sync() {
    const s = store.state;
    this.lastState = s;
    this.controls.autoRotate = s.autoRotate;
    this.earth.material = s.earthStyle === 'photo' ? this.photoMaterial() : this.mapMat;
    this.outlines.visible = s.earthStyle === 'map';
    if (s.objects.length && !this.pointsGeo.getAttribute('aColor')) this.initCatalogAttributes(s);
    const ck = JSON.stringify(s.layers.colors);
    if (ck !== this.colorKey) {
      this.colorKey = ck;
      this.paintCatalog(s);
      this.fleetKepKey = ''; // rebuild fleet orbit lines in the new colour
      this.focusKey = this.selectionKey = '\u0000';
    }
    const lk = JSON.stringify(s.layers);
    if (lk !== this.layerKey && this.pointsGeo.getAttribute('aSize')) {
      this.layerKey = lk;
      this.applyLayers(s);
    }
    const fk = s.fleet.map((f) => f.kep.M0.toFixed(9) + f.kep.a.toFixed(6)).join() + s.partners.map((f) => f.kep.a.toFixed(6) + f.kep.M0.toFixed(9)).join();
    if (fk !== this.fleetKepKey) {
      this.fleetKepKey = fk;
      this.buildFleet(s);
    }
    this.fleetOrbitGroup.visible = s.layers.fleetOrbits;
    const focus = s.selectedAlertId ?? '';
    if (focus !== this.focusKey) {
      this.focusKey = focus;
      this.buildFocus(s);
    }
    const sk = s.selected ? JSON.stringify(s.selected) : '';
    if (sk !== this.selectionKey) {
      this.selectionKey = sk;
      this.buildSelection(s);
    }
    for (const f of this.fleet) {
      const el = f.label.element as HTMLDivElement;
      const show = s.layers.labels && (f.own || s.layers.partner);
      el.style.display = show ? '' : 'none';
    }
  }

  private initCatalogAttributes(s: AppState) {
    const n = s.objects.length;
    this.pointsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.pointsGeo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.pointsGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.paintCatalog(s);
    const KIND = { payload: 0, debris: 1, defunct: 2, rocket: 3 } as const;
    this.pointsGeo.setAttribute('aKind', new THREE.BufferAttribute(Float32Array.from(s.objects, (o) => KIND[shapeOf(o)]), 1));
    this.pointsGeo.setAttribute('aVar', new THREE.BufferAttribute(Float32Array.from(s.objects, (o) => (o.norad % 4) + 0.4 * (((o.norad * 2654435761) >>> 0) / 2 ** 32)), 1));
    this.pointsGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.layerKey = '';
  }

  /** Catalog point colours from the user's colour settings. */
  private paintCatalog(s: AppState) {
    const c = s.layers.colors;
    COLORS.own.set(c.own); COLORS.payload.set(c.payload); COLORS.debris.set(c.debris); COLORS.defunct.set(c.defunct); COLORS.partner.set(c.partner);
    const attr = this.pointsGeo.getAttribute('aColor') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const col = attr.array as Float32Array;
    s.objects.forEach((o, k) => {
      const v = o.kind === 'DEBRIS' ? COLORS.debris : o.kind === 'DEFUNCT' ? COLORS.defunct : COLORS.payload;
      col[k * 3] = v.r; col[k * 3 + 1] = v.g; col[k * 3 + 2] = v.b;
    });
    attr.needsUpdate = true;
  }

  private applyLayers(s: AppState) {
    const size = this.pointsGeo.getAttribute('aSize') as THREE.BufferAttribute;
    s.objects.forEach((o, k) => {
      let v = o.kind === 'DEBRIS' ? 2.2 : o.kind === 'DEFUNCT' ? 3.2 : 2.3;
      if (!objectVisible(o, s.layers)) v = 0;
      size.setX(k, v);
    });
    size.needsUpdate = true;
  }

  private buildFleet(s: AppState) {
    for (const f of this.fleet) f.label.removeFromParent();
    this.fleetOrbitGroup.clear();
    this.fleet = [
      ...s.fleet.map((f) => ({ id: f.spec.id, kep: f.kep, own: true })),
      ...s.partners.map((f) => ({ id: f.spec.id, kep: f.kep, own: false })),
    ].map((f) => {
      const el = document.createElement('div');
      el.className = `sat-label ${f.own ? 'own' : 'partner'}`;
      el.textContent = f.id;
      el.addEventListener('click', () => store.select({ type: 'fleet', id: f.id }));
      const label = new CSS2DObject(el);
      label.center.set(-0.12, 0.5);
      this.scene.add(label);
      return { ...f, label, pos: new THREE.Vector3() };
    });
    const n = this.fleet.length;
    this.fleetGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.fleetGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.fleetGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.fleetGeo.setAttribute('aRing', new THREE.BufferAttribute(new Float32Array(n), 1));
    for (const f of this.fleet) {
      if (!f.own) continue;
      this.fleetOrbitGroup.add(this.orbitLine(f.kep, `#${COLORS.own.getHexString()}`, 0.22));
    }
  }

  private orbitLine(kep: Kep, color: string, opacity: number, segments = 256) {
    const pts: THREE.Vector3[] = [];
    const P = period(kep.a) * 1000;
    for (let k = 0; k <= segments; k++) pts.push(toWorld(stateAt(kep, kep.epoch + (k / segments) * P).r));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  }

  private sgp4Line(idx: number, color: string, opacity: number, t: number) {
    const s = store.state;
    const o = s.objects[idx];
    const rec = store.satrec(o);
    const P = o.periodMin * 60e3;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 256; k++) {
      const st = sgp4State(rec, t - P / 2 + (k / 256) * P);
      if (st) pts.push(toWorld(st.r));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  }

  private buildFocus(s: AppState) {
    this.focusGroup.clear();
    this.tcaMarker.visible = false;
    const a = s.alerts.find((x) => x.id === s.selectedAlertId);
    if (!a) return;
    const sev = a.cdms.length ? latest(a).severity : 'watch';
    const prim = store.fleetOrbit(a.primary.id);
    if (prim) this.focusGroup.add(this.orbitLine(prim.kep, `#${COLORS.own.getHexString()}`, 0.95));
    if (a.secondary.cls === 'PARTNER') {
      const p = store.fleetOrbit(a.secondary.id);
      if (p) this.focusGroup.add(this.orbitLine(p.kep, SEV_COLOR[sev], 0.95));
    } else {
      const o = store.catalogByNorad(a.secondary.norad);
      if (o) this.focusGroup.add(this.sgp4Line(o.idx, SEV_COLOR[sev], 0.95, a.tca));
    }
    const p = toWorld(a.truth.primary.r);
    this.tcaMarker.position.copy(p);
    (this.tcaMarker.material as THREE.SpriteMaterial).color.set(SEV_COLOR[sev]);
    this.tcaMarker.visible = true;
    this.flyTo(p, 3.6);
  }

  private buildSelection(s: AppState) {
    const sel = s.selected;
    this.selectionMarker.visible = !!sel;
    this.focusGroup.children.filter((c) => c.userData.selection).forEach((c) => c.removeFromParent());
    if (!sel) return;
    let line: THREE.Line | null = null;
    if (sel.type === 'fleet') {
      const f = store.fleetOrbit(sel.id);
      if (f) line = this.orbitLine(f.kep, `#${(f.spec.owner === 'own' ? COLORS.own : COLORS.partner).getHexString()}`, 0.8);
    } else {
      line = this.sgp4Line(sel.idx, '#14275E', 0.6, clock.now());
    }
    if (line) {
      line.userData.selection = true;
      this.focusGroup.add(line);
    }
    const p = this.selectedPosition();
    if (p && !s.selectedAlertId) this.flyTo(p, Math.max(3.2, Math.min(p.length() + 2.6, 12)));
  }

  selectedPosition(): THREE.Vector3 | null {
    const sel = store.state.selected;
    if (!sel) return null;
    if (sel.type === 'fleet') return this.fleet.find((f) => f.id === sel.id)?.pos.clone() ?? null;
    const st = store.catalogState;
    if (!st) return null;
    return this.catalogWorld(sel.idx, clock.now());
  }

  private catalogWorld(k: number, t: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const st = store.catalogState;
    if (!st) return null;
    const px = st.pos[k * 3], py = st.pos[k * 3 + 1], pz = st.pos[k * 3 + 2];
    const rm = Math.hypot(px, py, pz);
    if (rm < 100) return null;
    const dt = (t - st.t) / 1000;
    const g = (-0.5 * 398600.4418) / (rm * rm * rm) * dt * dt;
    const x = px + st.vel[k * 3] * dt + px * g;
    const y = py + st.vel[k * 3 + 1] * dt + py * g;
    const z = pz + st.vel[k * 3 + 2] * dt + pz * g;
    return out.set(x * SCALE, z * SCALE, -y * SCALE);
  }

  private hitEarth(e: PointerEvent): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.dragRay.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.dragRay.ray.intersectSphere(this.unitSphere, new THREE.Vector3());
  }

  /** Orbit the camera around the Earth, north kept up. */
  private orbitBy(dTheta: number, dPhi: number) {
    const sp = new THREE.Spherical().setFromVector3(this.camera.position);
    sp.theta += dTheta;
    sp.phi = THREE.MathUtils.clamp(sp.phi + dPhi, 0.05, Math.PI - 0.05);
    this.camera.position.setFromSpherical(sp);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Grab rotation: the ground point touched at pointer-down stays under the finger (Earth-fixed, so it holds even
   * while the Earth spins at 600×). Off the globe, the drag maps pixels to the same surface distance.
   */
  private onDragMove(e: PointerEvent) {
    const g = this.grab!;
    if (!g.moved) {
      if (Math.hypot(e.clientX - (this.down?.x ?? e.clientX), e.clientY - (this.down?.y ?? e.clientY)) < 4) return;
      g.moved = true;
      this.fly = null;
      this.tooltip.style.opacity = '0';
      const st = store.state;
      if (st.autoRotate || st.followSelected) store.set({ autoRotate: false, followSelected: false });
    }
    let hit = this.hitEarth(e);
    if (g.local && hit) {
      // Spherical deltas are exact only at screen centre; a few refinement passes pin the point under the finger anywhere.
      const s0 = new THREE.Spherical().setFromVector3(this.earthGroup.localToWorld(g.local.clone()));
      for (let i = 0; i < 4 && hit; i++) {
        const s1 = new THREE.Spherical().setFromVector3(hit);
        const dTheta = THREE.MathUtils.euclideanModulo(s0.theta - s1.theta + Math.PI, 2 * Math.PI) - Math.PI;
        const dPhi = s0.phi - s1.phi;
        if (Math.abs(dTheta) + Math.abs(dPhi) < 1e-5) break;
        this.orbitBy(dTheta, dPhi);
        this.camera.updateMatrixWorld();
        hit = this.hitEarth(e);
      }
    } else {
      const h = this.renderer.domElement.clientHeight || 1;
      const k = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.max(this.camera.position.length() - 1, 0.05)) / h;
      this.orbitBy(-(e.clientX - g.x) * k, -(e.clientY - g.y) * k);
      const again = this.hitEarth(e);
      if (again) g.local = this.earthGroup.worldToLocal(again); // finger reached the globe: grab it from here on
    }
    g.x = e.clientX;
    g.y = e.clientY;
  }

  flyTo(target: THREE.Vector3, dist: number) {
    this.fly = {
      from: this.camera.position.clone().normalize(),
      to: target.clone().normalize(),
      d0: this.camera.position.length(),
      d1: dist,
      t0: performance.now(),
      dur: 1300,
    };
  }

  resetView() {
    this.flyTo(new THREE.Vector3(0.9, 1.4, 3.9), 4.4);
  }

  zoom(f: number) {
    const d = THREE.MathUtils.clamp(this.camera.position.length() * f, this.controls.minDistance, this.controls.maxDistance);
    this.fly = { from: this.camera.position.clone().normalize(), to: this.camera.position.clone().normalize(), d0: this.camera.position.length(), d1: d, t0: performance.now(), dur: 400 };
  }

  // ---------- frame ----------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = clock.now();
    const date = new Date(now);
    this.earthGroup.rotation.y = gstime(date);
    const sun = sunPos(jday(date)).rsun as unknown as { x: number; y: number; z: number } | number[];
    const sv = Array.isArray(sun) ? sun : [sun.x, sun.y, sun.z];
    this.sunUniform.set(sv[0], sv[2], -sv[1]).normalize();

    // catalog state
    const st = store.catalogState;
    if (st && store.catalogVersion !== this.lastVersion) {
      this.lastVersion = store.catalogVersion;
      const posAttr = this.pointsGeo.getAttribute('position') as THREE.BufferAttribute;
      const velAttr = this.pointsGeo.getAttribute('aVel') as THREE.BufferAttribute;
      if (posAttr && posAttr.array.length === st.pos.length) {
        (posAttr.array as Float32Array).set(st.pos);
        (velAttr.array as Float32Array).set(st.vel);
        posAttr.needsUpdate = velAttr.needsUpdate = true;
        this.catalogT = st.t;
      }
    }
    this.pointsMat.uniforms.uDt.value = (now - this.catalogT) / 1000;
    const wallNow = performance.now();
    if (wallNow - this.lastRequest > 450) {
      this.lastRequest = wallNow;
      store.requestPropagation();
    }

    this.updateFleet(now);
    this.fleetMat.uniforms.uTime.value = wallNow / 1000;
    // Tumble clock: real-time rate whatever the sim speed, frozen when paused, backwards on rewind.
    const wallDt = (wallNow - this.lastWall) / 1000, simDt = (now - this.lastSim) / 1000;
    this.lastWall = wallNow; this.lastSim = now;
    if (wallDt > 0 && wallDt < 1) this.tumbleT += Math.max(-wallDt, Math.min(wallDt, simDt));
    this.pointsMat.uniforms.uTime.value = this.tumbleT;

    // selection marker follows object
    const sp = this.selectedPosition();
    if (sp) {
      this.selectionMarker.position.copy(sp);
      this.selectionMarker.visible = true;
      if (store.state.followSelected && !this.fly) {
        this.camera.position.copy(sp.clone().normalize().multiplyScalar(this.camera.position.length()));
      }
    } else this.selectionMarker.visible = false;
    const pulse = 0.04 + 0.012 * Math.sin(wallNow / 260);
    this.tcaMarker.scale.setScalar(pulse);

    if (this.fly) {
      const k = Math.min(1, (wallNow - this.fly.t0) / this.fly.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const dir = slerp(this.fly.from, this.fly.to, e);
      this.camera.position.copy(dir.multiplyScalar(THREE.MathUtils.lerp(this.fly.d0, this.fly.d1, e)));
      this.camera.lookAt(0, 0, 0);
      if (k >= 1) this.fly = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  private updateFleet(now: number) {
    const s = this.lastState;
    if (!s || !this.fleet.length) return;
    const pos = this.fleetGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.fleetGeo.getAttribute('aColor') as THREE.BufferAttribute;
    const size = this.fleetGeo.getAttribute('aSize') as THREE.BufferAttribute;
    const ring = this.fleetGeo.getAttribute('aRing') as THREE.BufferAttribute;
    const sevById = new Map<string, Severity>();
    for (const a of visibleAlerts(s)) {
      if (a.status === 'resolved' || a.tca < now) continue;
      const sev = latest(a).severity;
      if (sev === 'critical' || sev === 'warning') {
        const prev = sevById.get(a.primary.id);
        if (!prev || sev === 'critical') sevById.set(a.primary.id, sev);
      }
    }
    const camDir = this.camera.position.clone();
    this.fleet.forEach((f, k) => {
      toWorld(stateAt(f.kep, now).r, 0, f.pos);
      pos.setXYZ(k, f.pos.x, f.pos.y, f.pos.z);
      const sev = sevById.get(f.id);
      const c = f.own ? (sev === 'critical' ? COLORS.critical : sev === 'warning' ? COLORS.warning : COLORS.own) : COLORS.partner;
      col.setXYZ(k, c.r, c.g, c.b);
      const visible = f.own || s.layers.partner;
      size.setX(k, visible ? (f.own ? 15 : 11) : 0);
      ring.setX(k, sev === 'critical' ? 1 : 0);
      f.label.position.copy(f.pos);
      const el = f.label.element as HTMLDivElement;
      const hidden = occluded(camDir, f.pos);
      el.classList.toggle('hidden', hidden);
      el.classList.toggle('alert', !!sev);
    });
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = ring.needsUpdate = true;
  }

  // ---------- picking ----------
  private pick(e: PointerEvent): { type: 'fleet'; id: string } | { type: 'catalog'; idx: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = rect.width, h = rect.height;
    const v = new THREE.Vector3();
    const cam = this.camera.position;
    const s = store.state;
    let best: { d: number; r: { type: 'fleet'; id: string } | { type: 'catalog'; idx: number } } | null = null;
    for (const f of this.fleet) {
      if (!f.own && !s.layers.partner) continue;
      if (occluded(cam, f.pos)) continue;
      v.copy(f.pos).project(this.camera);
      const d = Math.hypot(((v.x + 1) / 2) * w - mx, ((1 - v.y) / 2) * h - my);
      if (d < 14 && (!best || d < best.d)) best = { d, r: { type: 'fleet', id: f.id } };
    }
    if (best) return best.r;
    const size = this.pointsGeo.getAttribute('aSize') as THREE.BufferAttribute | undefined;
    if (!size) return null;
    const now = clock.now();
    const p = new THREE.Vector3();
    for (let k = 0; k < s.objects.length; k++) {
      if (size.getX(k) <= 0) continue;
      if (!this.catalogWorld(k, now, p)) continue;
      if (occluded(cam, p)) continue;
      v.copy(p).project(this.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * w - mx, ((1 - v.y) / 2) * h - my);
      if (d < 8 && (!best || d < best.d)) best = { d, r: { type: 'catalog', idx: k } };
    }
    return best?.r ?? null;
  }

  private onClick(e: PointerEvent) {
    const r = this.pick(e);
    store.select(r);
  }

  private onHover(e: PointerEvent) {
    const t = performance.now();
    if (t - this.hoverAt < 60 || e.buttons) return;
    this.hoverAt = t;
    const r = this.pick(e);
    const s = store.state;
    if (!r) {
      this.tooltip.style.opacity = '0';
      this.renderer.domElement.style.cursor = '';
      return;
    }
    let title = '', sub = '';
    if (r.type === 'fleet') {
      const f = store.fleetOrbit(r.id)!;
      title = f.spec.name;
      sub = f.spec.owner === 'own' ? `${f.spec.mission} · your fleet` : `Partner operator · ${PARTNER_ORG.name}`;
    } else {
      const o = s.objects[r.idx];
      title = o.name;
      sub = `${objectType(o)} · NORAD ${o.norad}`;
    }
    const rect = this.host.getBoundingClientRect();
    this.tooltip.innerHTML = `<strong></strong><span></span>`;
    (this.tooltip.firstChild as HTMLElement).textContent = title;
    (this.tooltip.lastChild as HTMLElement).textContent = sub;
    this.tooltip.style.transform = `translate(${e.clientX - rect.left + 14}px, ${e.clientY - rect.top + 12}px)`;
    this.tooltip.style.opacity = '1';
    this.renderer.domElement.style.cursor = 'pointer';
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.host.innerHTML = '';
  }
}

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const th = Math.acos(dot) * t;
  if (Math.abs(dot) > 0.9995) return a.clone().lerp(b, t).normalize();
  const rel = b.clone().sub(a.clone().multiplyScalar(dot)).normalize();
  return a.clone().multiplyScalar(Math.cos(th)).add(rel.multiplyScalar(Math.sin(th)));
}

/** True when the unit Earth sphere hides point p from the camera. */
function occluded(cam: THREE.Vector3, p: THREE.Vector3) {
  const d = p.clone().sub(cam);
  const len = d.length();
  d.divideScalar(len);
  const b = cam.dot(d);
  const c = cam.lengthSq() - 1;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < len;
}
