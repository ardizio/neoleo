export function countdown(ms: number): string {
  if (ms <= 0) return 'passed';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function utc(t: number, withDate = false): string {
  const d = new Date(t).toISOString();
  return withDate ? `${d.slice(0, 10)} ${d.slice(11, 19)}` : d.slice(11, 19);
}

export function utcShort(t: number): string {
  const d = new Date(t);
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()} ${mon} ${d.toISOString().slice(11, 16)}`;
}

export function meters(km: number): string {
  const m = km * 1000;
  if (Math.abs(m) >= 10000) return `${(m / 1000).toFixed(1)} km`;
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function cms(ms: number): string {
  return `${(ms * 100).toFixed(1)} cm/s`;
}
