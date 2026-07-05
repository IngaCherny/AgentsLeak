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
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  live?: boolean;
}

const monitorItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/live', icon: Radio, label: 'Live Feed', live: true },
  { to: '/sessions', icon: Layers, label: 'Sessions' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts' },
];

const analyzeItems: NavItem[] = [
  { to: '/policies', icon: Shield, label: 'Policies' },
  { to: '/graph', icon: GitBranch, label: 'Graph' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

function NavItemLink({ to, icon: Icon, label, live }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors duration-150',
          isActive
            ? 'bg-alert-red/[0.07] text-alert-red font-semibold before:content-[""] before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-[3px] before:bg-alert-red before:rounded-r-sm'
            : 'font-medium text-carbon/55 dark:text-white/45 hover:text-carbon dark:hover:text-white hover:bg-carbon/[0.04] dark:hover:bg-white/[0.05]'
        )
      }
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {live && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-carbon/60 dark:bg-white/50 animate-pulse-slow" />
      )}
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
    <aside className="w-60 flex flex-col bg-white dark:bg-[#0C0C0C] border-r border-carbon/[0.07] dark:border-white/[0.07] relative z-10">
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 relative">
        {/* Dark mode toggle */}
        <button
          onClick={() => setDark(!dark)}
          className="absolute top-5 right-4 p-1.5 rounded-md text-carbon/35 dark:text-white/35 hover:text-alert-red dark:hover:text-alert-red transition-colors"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {/* Wordmark */}
        <div className="flex items-center gap-1.5">
          <span className="text-[17px] font-display font-bold tracking-[0.07em] text-carbon dark:text-white uppercase">AGENTS</span>
          <span className="w-[5px] h-[5px] rounded-full bg-alert-red flex-shrink-0" />
          <span className="text-[17px] font-display font-bold tracking-[0.07em] text-alert-red uppercase">LEAK</span>
        </div>
        <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-carbon/35 dark:text-white/30 mt-1.5">
          Runtime Agent Security
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-5">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-carbon/30 dark:text-white/25 px-3 mb-1.5">Monitor</p>
          {monitorItems.map((item) => (
            <NavItemLink key={item.to} {...item} />
          ))}
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-carbon/30 dark:text-white/25 px-3 mb-1.5">Analyze</p>
          {analyzeItems.map((item) => (
            <NavItemLink key={item.to} {...item} />
          ))}
        </div>
      </nav>

      {/* Version */}
      <div className="px-5 py-3.5">
        <p className="text-[10px] font-mono text-carbon/25 dark:text-white/20">v0.1.0</p>
      </div>
    </aside>
  );
}

export default Sidebar;
