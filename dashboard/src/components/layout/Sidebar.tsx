import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Layers,
  AlertTriangle,
  GitBranch,
  Shield,
  BarChart3,
  Radio,
  Sun,
  Moon,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

const monitorItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/live', icon: Radio, label: 'Live Feed' },
  { to: '/sessions', icon: Layers, label: 'Sessions' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts' },
];

const analyzeItems: NavItem[] = [
  { to: '/policies', icon: Shield, label: 'Policies' },
  { to: '/graph', icon: GitBranch, label: 'Graph' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

function NavItemLink({ to, icon: Icon, label }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2 text-sm font-mono rounded-lg transition-all duration-200',
          isActive
            ? 'bg-alert-red/10 text-alert-red font-bold shadow-[0_1px_4px_rgba(217,4,41,0.12)] dark:shadow-[0_1px_6px_rgba(232,71,92,0.15)]'
            : 'opacity-40 hover:opacity-100 hover:bg-white/60 hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:hover:bg-white/[0.05] dark:hover:shadow-[0_1px_3px_rgba(0,0,0,0.2)]'
        )
      }
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const [dark, setDark] = useState(() => {
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [dark]);

  return (
    <aside className="w-60 flex flex-col glass relative z-10">
      {/* Logo — Centered Shield Mark */}
      <div className="flex flex-col items-center text-center pt-6 pb-5 px-5 relative">
        {/* Dark mode toggle — top right */}
        <button
          onClick={() => setDark(!dark)}
          className="absolute top-4 right-4 p-1.5 rounded-full opacity-30 hover:opacity-100 hover:text-alert-red hover:bg-white/60 hover:shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:hover:bg-white/[0.06] transition-all"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        {/* Shield icon */}
        <div
          className="w-11 h-11 bg-carbon dark:bg-white rounded-[10px] flex items-center justify-center mb-3 relative overflow-hidden"
          style={{ boxShadow: '0 2px 8px rgba(26,26,26,0.15), 0 0 0 1px rgba(255,255,255,0.1) inset' }}
        >
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-alert-red" style={{ boxShadow: '0 -2px 8px var(--alert-red)' }} />
          <ShieldCheck className="w-5 h-5 text-white dark:text-carbon" strokeWidth={2.5} />
        </div>
        {/* Wordmark */}
        <div className="flex items-center gap-1.5">
          <span className="text-[17px] font-display font-extrabold tracking-[0.08em] text-carbon dark:text-white uppercase">AGENTS</span>
          <span className="w-1 h-1 rounded-full bg-alert-red flex-shrink-0" />
          <span className="text-[17px] font-display font-extrabold tracking-[0.08em] text-alert-red uppercase">LEAK</span>
        </div>
        {/* Tagline */}
        <p className="text-[9px] font-mono uppercase tracking-[0.14em] opacity-40 mt-1.5">AI Agent Security</p>
        {/* Divider */}
        <div className="w-16 mt-5 flex flex-col gap-px">
          <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(26,26,26,0.12), transparent)' }} />
          <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)' }} />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-4">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] opacity-25 px-3 mb-1">Monitor</p>
          {monitorItems.map((item) => (
            <NavItemLink key={item.to} {...item} />
          ))}
        </div>
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] opacity-25 px-3 mb-1">Analyze</p>
          {analyzeItems.map((item) => (
            <NavItemLink key={item.to} {...item} />
          ))}
        </div>
      </nav>

      {/* Version */}
      <div className="p-4 flex justify-center">
        <p className="text-[9px] font-mono opacity-15">v0.1.0</p>
      </div>
    </aside>
  );
}

export default Sidebar;
