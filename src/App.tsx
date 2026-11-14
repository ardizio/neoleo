import { useEffect } from 'react';
import { store, useStore } from './state/store';
import { TopBar } from './ui/TopBar';
import { FleetPanel } from './ui/FleetPanel';
import { AlertsPanel } from './ui/AlertsPanel';
import { GlobeView } from './ui/GlobeView';
import { Modals } from './ui/Overlays';
import { LogoMark } from './ui/icons';
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
      <main className="layout">
        <FleetPanel />
        <GlobeView />
        <AlertsPanel />
      </main>
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
