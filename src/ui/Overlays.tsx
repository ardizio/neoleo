import { useMemo, useState } from 'react';
import { DEFAULT_COLORS, store, useStore, type Layers, type ObjColors } from '../state/store';
import { objectVisible, shapeOf } from '../data/catalog';
import { DATA_SOURCES, flag, ORG, type SourceGroup } from '../data/company';
import { IconAlert, IconCheck, IconClose, IconDownload, IconLayers, IconUpload } from './icons';
import { summarize, validateCdm, type CdmSummary } from '../orbit/cdm';

/** One compact notification at a time (newest); older ones collapse into a "+N" counter. */
export function Toasts() {
  const s = useStore();
  const t = s.toasts[s.toasts.length - 1];
  if (!t) return null;
  const more = s.toasts.length - 1;
  return (
    <div className="toasts" aria-live="assertive">
      <div key={t.id} className={`toast ${t.severity}`}>
        <span className="toast-icon">{t.severity === 'success' ? <IconCheck size={15} /> : <IconAlert size={15} />}</span>
        <button className="toast-body" onClick={() => { if (t.alertId) store.openAlert(t.alertId); store.dismissToast(t.id); }}>
          <strong>{t.title}</strong>
          <span>{t.body}</span>
        </button>
        {more > 0 && (
          <button className="toast-more mono" onClick={() => s.toasts.forEach((x) => store.dismissToast(x.id))} title="Dismiss all">+{more}</button>
        )}
        <button className="icon-btn" onClick={() => store.dismissToast(t.id)} aria-label="Dismiss"><IconClose size={14} /></button>
      </div>
    </div>
  );
}

export function Modals() {
  const s = useStore();
  if (!s.modal) return null;
  const close = () => store.set({ modal: null });
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className={`modal ${s.modal === 'settings' ? 'narrow' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="icon-btn modal-close" onClick={close} aria-label="Close"><IconClose size={18} /></button>
        {s.modal === 'sources' && <Sources />}
        {s.modal === 'ingest' && <Ingest />}
        {s.modal === 'settings' && <Settings />}
        {s.modal === 'api' && <Api />}
        {typeof s.modal === 'object' && 'cdm' in s.modal && <CdmViewer alertId={s.modal.cdm.alertId} seq={s.modal.cdm.seq} />}
      </div>
    </div>
  );
}

const GROUPS: SourceGroup[] = ['Platform', 'Government', 'Commercial · own sensors', 'Commercial · fused data'];

function Sources() {
  const s = useStore();
  const deb = s.objects.filter((o) => o.kind !== 'PAYLOAD').length;
  const online = DATA_SOURCES.filter((d) => d.status === 'online').length;
  return (
    <>
      <h2>Data sources</h2>
      <p className="modal-lead">NeoLEO fuses government catalogs, commercial sensor networks and analytics providers into one solution per object. Every CDM lists the feeds that contributed to it.</p>
      <div className="src-stats">
        <div><b className="mono">{DATA_SOURCES.length}</b><span>feeds</span></div>
        <div><b className="mono ok">{online}</b><span>online</span></div>
        <div><b className="mono">{new Set(DATA_SOURCES.map((d) => d.country).filter(Boolean)).size}</b><span>countries</span></div>
        <div><b className="mono">{s.objects.length.toLocaleString()}</b><span>objects tracked</span></div>
      </div>
      {GROUPS.map((g) => {
        const list = DATA_SOURCES.filter((d) => d.group === g);
        return (
          <section key={g} className="src-group">
            <div className="group-title">{g} <span>{list.length}</span></div>
            <div className="src-grid">
              {list.map((d) => (
                <div key={d.id} className="src-card">
                  <div className="src-card-top">
                    <span className="flag" title={d.country || 'Not tied to one country'}>{flag(d.country)}</span>
                    <span className="src-card-name">{d.name}</span>
                    <span className={`src-dot ${d.status}`} title={d.status} />
                  </div>
                  <div className="src-card-detail">{d.detail}</div>
                  <div className="src-card-meta mono">
                    <span>{d.kind}</span>
                    <span>{d.latencyMin ? `${d.latencyMin} min` : 'on upload'}</span>
                    {!d.simulated && <span className="real-tag">live data</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <div className="facts">
        <div><span className="mono">{(s.objects.length - deb).toLocaleString()}</span> active payloads</div>
        <div><span className="mono">{deb.toLocaleString()}</span> debris and defunct</div>
        {/* ponytail: cosmetic counter, wraps every 30 s; not tied to real fetch time */}
        <div>Last update <span className="mono">{Math.floor(Date.now() / 1000) % 30 + 1} s</span> ago</div>
      </div>
      <p className="hint">Demo created for the SVST hackathon.</p>
    </>
  );
}

const ALT_PRESETS: [string, number, number][] = [
  ['LEO (0–2,000)', 0, 2000],
  ['Very low (<450)', 0, 450],
  ['450–650', 450, 650],
  ['650–1,200', 650, 1200],
  ['All altitudes', 0, 100000],
];

function Settings() {
  const s = useStore();
  const layers = s.layers;
  const count = useMemo(() => {
    const c = { payload: 0, debris: 0, rocket: 0, defunct: 0, visible: 0 };
    for (const o of s.objects) { c[shapeOf(o)]++; if (objectVisible(o, s.layers)) c.visible++; }
    return c;
  }, [s.objects, s.layers]);
  const set = (p: Partial<Layers>) => store.setLayers(p);
  const toggle = (k: keyof Layers, label: string, swatch: string, sub?: string) => (
    <label className="layer">
      <input type="checkbox" checked={layers[k] as boolean} onChange={(e) => set({ [k]: e.target.checked })} />
      <span className="swatch" style={{ background: swatch }} />
      <span className="layer-label">{label}</span>
      {sub && <span className="layer-sub mono">{sub}</span>}
    </label>
  );
  const color = (k: keyof ObjColors, label: string) => (
    <label className="color-row">
      <input type="color" value={layers.colors[k]} onChange={(e) => set({ colors: { ...layers.colors, [k]: e.target.value }, colorsCustom: true })} aria-label={`${label} colour`} />
      {label}
    </label>
  );
  const sc = s.screening;
  return (
    <>
      <h2>Settings</h2>
      <div className="layers">
        <div className="group-title"><IconLayers size={13} /> Layers</div>
        {toggle('partner', 'Partner network', 'var(--partner)')}
        {toggle('fleetOrbits', 'Fleet orbits', 'var(--own)')}
        {toggle('labels', 'Labels', 'var(--ink)')}
      </div>
      <div className="layers">
        <div className="group-title">Object types</div>
        {toggle('payload', 'Active satellites', 'var(--payload)', count.payload.toLocaleString())}
        {toggle('debris', 'Debris fragments', 'var(--debris)', count.debris.toLocaleString())}
        {toggle('rocket', 'Rocket bodies', 'var(--defunct)', count.rocket.toLocaleString())}
        {toggle('defunct', 'Defunct satellites', 'var(--defunct)', count.defunct.toLocaleString())}
      </div>
      <div className="layers">
        <div className="group-title">Altitude</div>
        <div className="alt-row">
          <label>From <input type="number" inputMode="numeric" min={0} max={layers.altMax} step={50} value={layers.altMin} onChange={(e) => set({ altMin: Math.max(0, Math.min(Number(e.target.value) || 0, layers.altMax)) })} /> km</label>
          <label>to <input type="number" inputMode="numeric" min={layers.altMin} step={50} value={layers.altMax} onChange={(e) => set({ altMax: Math.max(Number(e.target.value) || 0, layers.altMin) })} /> km</label>
        </div>
        <div className="alt-presets">
          {ALT_PRESETS.map(([label, lo, hi]) => (
            <button key={label} className={layers.altMin === lo && layers.altMax === hi ? 'on' : ''} onClick={() => set({ altMin: lo, altMax: hi })}>{label}</button>
          ))}
        </div>
        <p className="hint">Shows objects whose orbit (perigee to apogee) crosses this band: <b className="mono">{count.visible.toLocaleString()}</b> of {s.objects.length.toLocaleString()} on the globe. Your fleet and partners are always shown.</p>
      </div>
      <div className="layers">
        <div className="group-title">Colours</div>
        <div className="colors">
          {color('own', 'Your fleet')}
          {color('payload', 'Active satellites')}
          {color('debris', 'Debris')}
          {color('defunct', 'Rocket bodies & defunct')}
          {color('partner', 'Partner network')}
        </div>
        <button className="link-btn small" onClick={() => set({ colors: DEFAULT_COLORS, colorsCustom: false })}>Reset to default colours</button>
      </div>
      <p className="hint">
        Build <span className="mono">{import.meta.env.VITE_BUILD_ID}</span> · hold the NeoLEO logo 5 s to clear cache and reload.<br />
        Screening {sc.done ? 'complete' : `${Math.round(sc.fraction * 100)}%`} · {s.fleet.length} assets × {sc.candidates.toLocaleString()} objects · next 24 h · {s.objects.length.toLocaleString()} tracked
      </p>
    </>
  );
}

/** Integration surface for operators (demo: documented, not live). */
const API_ROUTES: [string, string, string][] = [
  ['POST', '/v1/fleet/{id}/ephemeris', 'Share your satellite ephemerides (CCSDS OEM). Improves the fused path and Pc for your fleet.'],
  ['POST', '/v1/cdm', 'Push conjunction data messages (CCSDS 508, KVN or XML). Same consistency gate and fusion as Ingest CDM.'],
  ['GET', '/v1/alerts?status=open', 'Open conjunction alerts with TCA, Pc, miss distance and severity.'],
  ['GET', '/v1/alerts/{id}/cdms', 'CDM history of an alert, as issued by NeoLEO.'],
  ['GET', '/v1/objects/{norad}/track', 'Fused track: sources count, 1σ uncertainty, passes, obstructions, validation.'],
  ['POST', '/v1/alerts/{id}/maneuver', 'Request avoidance options; returns Δv, propellant and post-manoeuvre Pc.'],
];
function Api() {
  return (
    <>
      <h2>API access</h2>
      <p className="hint">Connect your flight-dynamics tools. Authentication with a per-organisation API key (header <span className="mono">Authorization: Bearer …</span>); webhooks on <span className="mono">alert.created</span> and <span className="mono">alert.updated</span>. <strong>Demo:</strong> the API is documented here but not live.</p>
      <table className="api-table">
        <tbody>
          {API_ROUTES.map(([m, path, what]) => (
            <tr key={path}><td><span className={`api-m ${m.toLowerCase()}`}>{m}</span></td><td><div className="mono">{path}</div><div className="muted">{what}</div></td></tr>
          ))}
        </tbody>
      </table>
      <pre className="api-ex mono">{`curl -X POST https://api.neoleo.example/v1/cdm \\
  -H "Authorization: Bearer $NEOLEO_KEY" \\
  -H "Content-Type: text/plain" \\
  --data-binary @conjunction.kvn`}</pre>
      <button className="primary-btn" disabled>Generate API key (not available in demo)</button>
    </>
  );
}

type Step = 'validate' | 'parse' | 'ingest';
/** Ingest a CDM in three visible steps: 1 Validate (structure + sanity), 2 Parse (what the message says), 3 Ingest (alert / fusion). */
function Ingest() {
  const [text, setText] = useState('');
  const [val, setVal] = useState<ReturnType<typeof validateCdm> | null>(null);
  const [sum, setSum] = useState<CdmSummary | null>(null);
  const [res, setRes] = useState<{ ok: boolean; message: string; alertId?: string } | null>(null);
  const s = useStore();
  const sample = s.alerts.find((a) => a.cdms.length)?.cdms[0]?.kvn;
  const load = (t: string) => { setText(t); setVal(null); setSum(null); setRes(null); };
  const onFile = async (f: File | undefined) => { if (f) load(await f.text()); };
  const run = () => {
    const v = validateCdm(text);
    setVal(v);
    setRes(null);
    try { setSum(v.ok ? summarize(v.parsed) : null); } catch { setSum(null); }
  };
  const step: Step = res ? 'ingest' : sum ? 'parse' : 'validate';
  const errors = val?.checks.filter((c) => c.level === 'error').length ?? 0;
  const warns = val?.checks.filter((c) => c.level === 'warn').length ?? 0;
  const mark = (st: Step, done: boolean, failed = false) => (
    <span className={`ing-step ${done ? (failed ? 'bad' : 'done') : step === st ? 'now' : ''}`}>{failed ? '✗' : done ? '✓' : st === 'validate' ? 1 : st === 'parse' ? 2 : 3}</span>
  );
  return (
    <>
      <h2>Ingest a CDM</h2>
      <p className="modal-lead">Paste or upload a CCSDS 508.0-B-1 conjunction data message (KVN). NeoLEO <b>validates</b> it, <b>parses</b> what it says, then <b>ingests</b> it: if one object belongs to {ORG.name} an alert is raised from the message's state vectors, or fused into the existing alert after a consistency check.</p>
      <div className="ingest-actions">
        <label className="ghost-btn">
          <IconUpload size={14} /> Upload .cdm / .txt
          <input type="file" accept=".cdm,.txt,.kvn" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {sample && <button className="ghost-btn" onClick={() => load(sample)}>Load a sample CDM</button>}
      </div>
      <textarea className="kvn-input mono" value={text} onChange={(e) => load(e.target.value)} placeholder="CCSDS_CDM_VERS = 1.0&#10;CREATION_DATE = …" spellCheck={false} />

      <ol className="ing-steps">
        <li>
          <div className="ing-head">{mark('validate', !!val, !!val && !val.ok)} <b>Validate</b>
            {val && <span className="muted"> · {errors ? `${errors} error(s)` : 'no errors'}{warns ? `, ${warns} warning(s)` : ''}</span>}
          </div>
          {!val && <button className="primary-btn" disabled={!text.trim()} onClick={run}>Validate and parse</button>}
          {val && (
            <ul className="ing-checks">
              {val.checks.map((c) => (
                <li key={c.label} className={c.level}><span>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '⚠' : '✗'}</span><b>{c.label}</b> <span className="muted">{c.detail}</span></li>
              ))}
            </ul>
          )}
        </li>
        <li className={val?.ok ? '' : 'off'}>
          <div className="ing-head">{mark('parse', !!sum)} <b>Parse</b></div>
          {sum && (
            <dl className="kv ing-sum">
              <div><dt>Message</dt><dd className="mono">{sum.messageId}</dd></div>
              <div><dt>Objects</dt><dd>{sum.obj1.name} ({sum.obj1.designator}) × {sum.obj2.name} ({sum.obj2.designator})</dd></div>
              <div><dt>TCA</dt><dd className="mono">{new Date(sum.tca).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd></div>
              <div><dt>Miss · relative speed</dt><dd className="mono">{(sum.missKm * 1000).toFixed(0)} m · {sum.relSpeedKms.toFixed(2)} km/s</dd></div>
              <div><dt>Pc</dt><dd className="mono">{sum.pc ? sum.pc.toExponential(1) : '—'}</dd></div>
            </dl>
          )}
        </li>
        <li className={sum ? '' : 'off'}>
          <div className="ing-head">{mark('ingest', !!res, !!res && !res.ok)} <b>Ingest</b></div>
          {sum && !res && <button className="primary-btn" onClick={() => setRes(store.ingestCdm(text))}>Ingest into NeoLEO</button>}
          {res && <p className={res.ok ? 'ok-text' : 'err-text'}>{res.message}</p>}
          {res?.alertId && <button className="ghost-btn" onClick={() => { store.set({ modal: null }); store.openAlert(res.alertId!); }}>Open alert</button>}
        </li>
      </ol>
    </>
  );
}

function CdmViewer({ alertId, seq }: { alertId: string; seq: number }) {
  const s = useStore();
  const a = s.alerts.find((x) => x.id === alertId);
  const c = a?.cdms.find((x) => x.seq === seq);
  if (!a || !c) return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([c.kvn], { type: 'text/plain' }));
    const el = document.createElement('a');
    el.href = url;
    el.download = `${c.messageId}.cdm`;
    el.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <h2>CDM #{c.seq} · {c.messageId}</h2>
      <p className="modal-lead">{a.primary.name} × {a.secondary.name} · {c.note}</p>
      <pre className="kvn mono">{c.kvn}</pre>
      <button className="ghost-btn" onClick={download}><IconDownload size={14} /> Download .cdm</button>
    </>
  );
}
