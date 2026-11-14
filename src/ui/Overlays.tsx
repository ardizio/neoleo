import { useState } from 'react';
import { store, useStore, type Layers } from '../state/store';
import { DATA_SOURCES, flag, ORG, type SourceGroup } from '../data/company';
import { IconAlert, IconCheck, IconClose, IconDownload, IconLayers, IconUpload } from './icons';

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
        <div>Snapshot <span className="mono">{s.snapshot?.fetchedAt.slice(0, 16).replace('T', ' ')} UTC</span></div>
      </div>
      <p className="hint">Demo: only the CelesTrak catalog and uploaded CDMs are real. Everything else shown is simulated, and no provider listed here supplies data to this demo.</p>
    </>
  );
}

function Settings() {
  const s = useStore();
  const layers = s.layers;
  const deb = s.objects.filter((o) => o.kind !== 'PAYLOAD').length;
  const set = (p: Partial<Layers>) => store.setLayers(p);
  const toggle = (k: keyof Layers, label: string, swatch: string, sub?: string) => (
    <label className="layer">
      <input type="checkbox" checked={layers[k] as boolean} onChange={(e) => set({ [k]: e.target.checked })} />
      <span className="swatch" style={{ background: swatch }} />
      <span className="layer-label">{label}</span>
      {sub && <span className="layer-sub mono">{sub}</span>}
    </label>
  );
  const sc = s.screening;
  return (
    <>
      <h2>Settings</h2>
      <div className="layers">
        <div className="group-title"><IconLayers size={13} /> Layers</div>
        {toggle('payload', 'Active satellites', 'var(--payload)', (s.objects.length - deb).toLocaleString())}
        {toggle('debris', 'Debris & defunct', 'var(--debris)', deb.toLocaleString())}
        {toggle('partner', 'Partner network', 'var(--partner)')}
        {toggle('fleetOrbits', 'Fleet orbits', 'var(--brand)')}
        {toggle('labels', 'Labels', 'var(--ink)')}
      </div>
      <p className="hint">
        Screening {sc.done ? 'complete' : `${Math.round(sc.fraction * 100)}%`} · {s.fleet.length} assets × {sc.candidates.toLocaleString()} objects · next 24 h · {s.objects.length.toLocaleString()} tracked
      </p>
    </>
  );
}

function Ingest() {
  const [text, setText] = useState('');
  const [res, setRes] = useState<{ ok: boolean; message: string; alertId?: string } | null>(null);
  const s = useStore();
  const sample = s.alerts.find((a) => a.cdms.length)?.cdms[0]?.kvn;
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
  };
  return (
    <>
      <h2>Ingest a CDM</h2>
      <p className="modal-lead">Paste or upload a CCSDS 508.0-B-1 conjunction data message in KVN format. If one of the two objects belongs to {ORG.name}, an alert is raised using the state vectors in the message. If that conjunction is already tracked, the message is checked for consistency and fused into the existing alert instead of duplicating it.</p>
      <div className="ingest-actions">
        <label className="ghost-btn">
          <IconUpload size={14} /> Upload .cdm / .txt
          <input type="file" accept=".cdm,.txt,.kvn" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {sample && <button className="ghost-btn" onClick={() => setText(sample)}>Load a sample CDM</button>}
      </div>
      <textarea className="kvn-input mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="CCSDS_CDM_VERS = 1.0&#10;CREATION_DATE = …" spellCheck={false} />
      <div className="ingest-foot">
        <button className="primary-btn" disabled={!text.trim()} onClick={() => setRes(store.ingestCdm(text))}>Parse and ingest</button>
        {res && <span className={res.ok ? 'ok-text' : 'err-text'}>{res.message}</span>}
        {res?.alertId && <button className="ghost-btn" onClick={() => { store.set({ modal: null }); store.openAlert(res.alertId!); }}>Open alert</button>}
      </div>
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
