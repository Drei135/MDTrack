import React from 'react';
import { HardDrive, ListTodo, ClipboardList, Users } from 'lucide-react';

const TABS = [
  { id: 'drive', label: 'Files', icon: HardDrive },
  { id: 'org', label: 'Org Chart', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'mom', label: 'Minutes', icon: ClipboardList }
];

/**
 * Fixed bottom tab bar sized for thumb reach on Android phones: large
 * (56px+) tap targets, safe-area padding for gesture-nav devices, and a
 * persistent active-state indicator.
 */
export default function BottomNav({ active, onChange }) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] active:bg-slate-900"
          >
            <Icon size={20} className={isActive ? 'text-accent-400' : 'text-slate-500'} />
            <span className={`text-[10px] ${isActive ? 'text-accent-400 font-medium' : 'text-slate-500'}`}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
