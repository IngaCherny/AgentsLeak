import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '../ErrorBoundary';
import { CommandPalette } from '../common/CommandPalette';

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen bg-[#F8F9FB] dark:bg-[#0A0A0A]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar onOpenSearch={() => setPaletteOpen(true)} />
        <main className="flex-1 overflow-auto p-8 bg-[#F8F9FB] dark:bg-[#0A0A0A] bg-dots">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

export default Shell;
