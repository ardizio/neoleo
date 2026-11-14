import { useState } from 'react';
import { store, useStore } from '../state/store';
import { DATA_SOURCES, ORG } from '../data/company';
import { IconAlert, IconCheck, IconClose, IconDownload, IconUpload } from './icons';

export function Toasts() {
  const s = useStore();
  return (
    <div className="toasts" aria-live="assertive">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.severity}`}>
          <span className="toast-icon">{t.severity === 'success' ? <IconCheck size={16} /> : <IconAlert size={16} />}</span>
          <button className="toast-body" onClick={() => { if (t.alertId) store.openAlert(t.alertId); store.dismissToast(t.id); }}>
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </button>
          <button className="icon-btn" onClick={() => store.dismissToast(t.id)} aria-label="Dismiss"><IconClose size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function Modals() {
  const s = useStore();
  if (!s.modal) return null;
  const close = () => store.set({ modal: null });
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="icon-btn modal-close" onClick={close} aria-label="Close"><IconClose size={18} /></button>
        {s.modal === 'sources' && <Sources />}
        {s.modal === 'ingest' && <Ingest />}
        {typeof s.modal === 'object' && 'cdm' in s.modal && <CdmViewer alertId={s.modal.cdm.alertId} seq={s.modal.cdm.seq} />}
      </div>
    </div>
  );
}

function Sources() {
  const s = useStore();
  const deb = s.objects.filter((o) => o.kind !== 'PAYLOAD').length;
  return (
    <>
      <h2>Data sources</h2>
      <p className="modal-lead">Orbitrace fuses public catalogs, commercial tracking contractors and operator ephemerides into one solution per object. Every CDM lists the feeds that contributed to it.</p>
      <table className="table">
        <thead><tr><th>Feed</th><th>Type</th><th>Detail</th><th>Latency</th><th>Status</th></tr></thead>
        <tbody>
          {DATA_SOURCES.map((d) => (
            <tr key={d.id}>
              <td><strong>{d.name}</strong><div className="muted mono">{d.id}</div></td>
              <td>{d.kind}</td>
              <td>{d.detail}</td>
              <td className="mono">{d.latencyMin} min</td>
              <td><span className={`src-status ${d.status}`}>{d.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="facts">
        <div><span className="mono">{s.objects.length.toLocaleString()}</span> catalog objects</div>
        <div><span className="mono">{(s.objects.length - deb).toLocaleString()}</span> active payloads</div>
        <div><span className="mono">{deb.toLocaleString()}</span> debris and defunct</div>
        <div>Snapshot <span className="mono">{s.snapshot?.fetchedAt.slice(0, 16).replace('T', ' ')} UTC</span></div>
      </div>
      <p className="hint">Demo: the catalog is a real CelesTrak GP snapshot propagated with SGP4. {ORG.name}, partner orbits, contractor feeds and covariances are simulated.</p>
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
      <p className="modal-lead">Paste or upload a CCSDS 508.0-B-1 conjunction data message in KVN format. If one of the two objects belongs to {ORG.name}, an alert is raised using the state vectors in the message.</p>
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
