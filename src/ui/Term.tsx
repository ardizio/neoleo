import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Plain-language meaning of every metric label shown in alerts and the encounter view. */
export const GLOSSARY: Record<string, string> = {
  'Collision probability': 'Chance that the two objects actually collide, computed from their predicted positions, their uncertainty (covariance) and their combined size. Operators usually manoeuvre above 1 in 10,000 (1e-4).',
  Pc: 'Probability of collision: chance that the two objects actually collide. Usually a manoeuvre is planned above 1e-4 (1 in 10,000).',
  'Miss distance': 'Predicted distance between the two objects at the moment of closest approach. A small miss is only dangerous if the uncertainty is small too.',
  Miss: 'Predicted distance between the two objects at closest approach.',
  'TCA in': 'Countdown to the Time of Closest Approach: when the two objects will be nearest to each other.',
  'Time to closest approach': 'Countdown to the moment the two objects will be nearest to each other (TCA).',
  TCA: 'Time of Closest Approach, in UTC: the moment the two objects are predicted to be nearest.',
  'Relative speed': 'How fast the objects move relative to each other at closest approach. In LEO this is often 7–15 km/s, so even a 1 cm fragment can disable a satellite.',
  Radial: 'Separation along the up/down direction (from Earth’s centre through your satellite) at closest approach.',
  'In-track': 'Separation along the direction of flight (ahead / behind). This is usually the most uncertain direction.',
  'Cross-track': 'Sideways separation, perpendicular to your satellite’s orbit plane.',
  'Approach angle': 'Angle between the two velocity directions at closest approach. Near 180° means almost head-on.',
  'Combined HBR': 'Combined hard-body radius: both objects’ sizes added together. A collision means the true miss falls inside this circle.',
  'CDM history': 'A CDM (Conjunction Data Message) is the standard CCSDS 508.0-B-1 message that warns of a close approach: time of closest approach, miss distance, collision probability, and the state and uncertainty of both objects. A new CDM is issued each time tracking improves, so this list shows how the risk evolved.',
  'σ combined (1σ)': 'Combined position uncertainty of both objects in the encounter plane (one standard deviation, ellipse axes). Bigger means a less confident prediction.',
};

/** Label with a tap/hover explanation. The popup is placed against the viewport and clamped inside it. */
export function Term({ label, className = 'm-label' }: { label: string; className?: string }) {
  const text = GLOSSARY[label];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { const t = e.target as Node; if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !ref.current || !pop.current) return setPos(null);
    const a = ref.current.getBoundingClientRect(), p = pop.current.getBoundingClientRect(), M = 8;
    const left = Math.min(Math.max(a.left, M), window.innerWidth - p.width - M);
    const below = a.bottom + 6, above = a.top - 6 - p.height;
    setPos({ left, top: below + p.height <= window.innerHeight - M || above < M ? Math.min(below, window.innerHeight - p.height - M) : above });
  }, [open]);
  if (!text) return <div className={className}>{label}</div>;
  return (
    <div className={`${className} term ${open ? 'open' : ''}`}>
      <span ref={ref} className="term-hit" role="button" tabIndex={0} aria-expanded={open} aria-label={`${label}: what does this mean?`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(!open)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)} onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}>
        <span className="term-label">{label}</span>
        <span className="term-i" aria-hidden>i</span>
        {open && createPortal(<span ref={pop} className="term-pop" role="tooltip" onPointerDown={(e) => e.stopPropagation()} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>{text}</span>, document.body)}
      </span>
    </div>
  );
}
