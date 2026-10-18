import React, { useState } from 'react';
import { User, Shield, UserCheck, Eye, KeyRound } from 'lucide-react';
import { User as UserType } from '../types';

interface RoleSwitcherProps {
  currentUser: UserType | null;
  onSwitchUser: (email: string) => Promise<void>;
  isLoading: boolean;
}

const DEMO_ACCOUNTS = [
  { email: 'admin@newtonite.internal', role: 'ADMIN', label: 'Global Admin', team: 'All Teams', icon: Shield, badgeColor: 'bg-purple-900/60 text-purple-300 border-purple-700' },
  { email: 'lead.ops@newtonite.internal', role: 'LEAD', label: 'Sarah (Ops Lead)', team: 'Core Ops', icon: UserCheck, badgeColor: 'bg-emerald-900/60 text-emerald-300 border-emerald-700' },
  { email: 'member.ops@newtonite.internal', role: 'MEMBER', label: 'Gordon (Ops Member)', team: 'Core Ops', icon: User, badgeColor: 'bg-blue-900/60 text-blue-300 border-blue-700' },
  { email: 'viewer.ops@newtonite.internal', role: 'VIEWER', label: 'Eli (Ops Viewer)', team: 'Core Ops', icon: Eye, badgeColor: 'bg-slate-800 text-slate-300 border-slate-700' },
  { email: 'lead.payments@newtonite.internal', role: 'LEAD', label: 'Rachel (Payments Lead)', team: 'Payments', icon: UserCheck, badgeColor: 'bg-amber-900/60 text-amber-300 border-amber-700' }
];

export const RoleSwitcher: React.FC<RoleSwitcherProps> = ({ currentUser, onSwitchUser, isLoading }) => {
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);

  const handleSelect = async (email: string) => {
    setSwitchingEmail(email);
    try {
      await onSwitchUser(email);
    } finally {
      setSwitchingEmail(null);
    }
  };

  return (
    <div className="bg-slate-950/80 border-b border-slate-800 px-4 py-2.5 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          <KeyRound className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-slate-300">Quick Role Switcher (For Reviewer):</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {DEMO_ACCOUNTS.map((acc) => {
            const isCurrent = currentUser?.email === acc.email;
            const Icon = acc.icon;
            return (
              <button
                key={acc.email}
                onClick={() => handleSelect(acc.email)}
                disabled={isLoading || isCurrent}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-all ${
                  isCurrent
                    ? `${acc.badgeColor} ring-2 ring-emerald-500/50 shadow-sm cursor-default`
                    : 'bg-slate-900/80 border-slate-750 text-slate-400 hover:text-slate-100 hover:border-slate-600 hover:bg-slate-850'
                } ${switchingEmail === acc.email ? 'opacity-50 animate-pulse' : ''}`}
                title={`Switch to ${acc.email} (Password: password123)`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{acc.label}</span>
                <span className="text-[10px] opacity-75 font-mono">[{acc.team}]</span>
              </button>
            );
          })}
        </div>

        {currentUser && (
          <div className="flex items-center gap-2 pl-3 border-l border-slate-800">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300">
              Active: <strong className="text-white font-semibold">{currentUser.name}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
