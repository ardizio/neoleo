import { useEffect } from 'react';
import { store, useStore, type AppState } from './state/store';
import { TopBar } from './ui/TopBar';
import { FleetPanel } from './ui/FleetPanel';
import { AlertsPanel } from './ui/AlertsPanel';
import { GlobeView } from './ui/GlobeView';
import { Modals } from './ui/Overlays';
import { LogoMark, TabAlerts, TabData, TabFleet, TabGlobe } from './ui/icons';
import { ORG, PLATFORM } from './data/company';

let booted = false;

export function App() {
  const s = useStore();
  useEffect(() => {
    if (!booted) {
      booted = true;
      void store.boot();
    }
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="layout" data-tab={s.mobileTab}>
        <FleetPanel />
        <GlobeView />
        <AlertsPanel />
      </main>
      <MobileNav />
      <Modals />
      {s.phase !== 'ready' && (
        <div className="loading">
          <div className="loading-card">
            <LogoMark size={44} />
            <div className="loading-title">{PLATFORM.name}</div>
            <div className="loading-org">{ORG.name} workspace</div>
            {s.phase === 'error' ? (
              <div className="err-text">Could not start: {s.error}</div>
            ) : (
              <>
                <div className="loading-bar"><span /></div>
                <div className="loading-step">{s.loadingStep}…</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bottom tab bar, only displayed on phones (see styles.css). */
function MobileNav() {
  const s = useStore();
  const tab = (id: AppState['mobileTab'], label: string, icon: React.ReactNode) => (
    <button className={s.mobileTab === id && !s.modal ? 'on' : ''} onClick={() => store.set({ mobileTab: id, modal: null })} aria-current={s.mobileTab === id}>
      <span className="mnav-pill">{icon}</span>
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="mobile-nav" aria-label="Sections">
      {tab('globe', 'Globe', <TabGlobe size={22} />)}
      {tab('alerts', 'Alerts', <TabAlerts size={22} />)}
      {tab('fleet', 'Fleet', <TabFleet size={22} />)}
      <button className={s.modal === 'sources' ? 'on' : ''} onClick={() => store.set({ modal: 'sources' })}>
        <span className="mnav-pill"><TabData size={22} /></span>
        <span>Data</span>
      </button>
    </nav>
  );
}
