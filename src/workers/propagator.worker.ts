/// <reference lib="webworker" />
// Propagates the whole public catalog with SGP4 for the renderer.
import type { SatRec } from 'satellite.js';
import { propagate } from 'satellite.js';
import { CATALOG_URL, parseCatalog, toSatrec, type CatalogSnapshot } from '../data/catalog';

let recs: (SatRec | null)[] = [];

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const snap = (await (await fetch(CATALOG_URL)).json()) as CatalogSnapshot;
    recs = parseCatalog(snap).map((o) => {
      try {
        return toSatrec(o);
      } catch {
        return null;
      }
    });
    postMessage({ type: 'ready', count: recs.length });
  } else if (msg.type === 'propagate') {
    const n = recs.length;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const d = new Date(msg.t);
    for (let k = 0; k < n; k++) {
      const rec = recs[k];
      const pv = rec ? propagate(rec, d) : null;
      const p = pv?.position as { x: number; y: number; z: number } | undefined;
      const v = pv?.velocity as { x: number; y: number; z: number } | undefined;
      if (p && v && Number.isFinite(p.x)) {
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
        vel[k * 3] = v.x; vel[k * 3 + 1] = v.y; vel[k * 3 + 2] = v.z;
      } // else stays at origin: hidden inside the Earth
    }
    postMessage({ type: 'state', t: msg.t, pos, vel }, [pos.buffer, vel.buffer]);
  }
};
