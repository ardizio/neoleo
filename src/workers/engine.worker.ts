/// <reference lib="webworker" />
// Conjunction screening engine: builds the demo scenario, verifies the
// pairs announced by incoming CDMs, then sweeps the full catalog.
import { parseCatalog, type CatalogSnapshot } from '../data/catalog';
import { Engine } from '../sim/engine';
import { altitudeRange } from '../orbit/screening';
import type { Kep } from '../orbit/kepler';

let engine: Engine | null = null;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const snap = (await (await fetch(msg.catalogUrl)).json()) as CatalogSnapshot;
    engine = new Engine(parseCatalog(snap), msg.t0);
    const sc = engine.build();
    if (msg.sweep === false) {
      postMessage({ type: 'ready' });
      return;
    }
    postMessage({ type: 'scenario', fleet: sc.fleet, partners: sc.partners, designs: sc.designs, candidates: engine.candidateCount() });
    postMessage({ type: 'designed-hits', hits: engine.screenDesigned() });
    for (const chunk of engine.screenAll(2)) {
      postMessage({ type: 'hits', hits: chunk.hits, fraction: chunk.fraction });
    }
    postMessage({ type: 'screening-done' });
  } else if (msg.type === 'screen-custom' && engine) {
    const kep = msg.kep as Kep;
    const hits = engine
      .screenCustom({ id: msg.id, body: { type: 'kep', kep }, ...altitudeRange(kep) }, msg.t0, msg.hours)
      .filter((h) => !(msg.exclude as string[]).includes(h.secondaryId));
    postMessage({ type: 'custom-result', reqId: msg.reqId, hits });
  }
};
