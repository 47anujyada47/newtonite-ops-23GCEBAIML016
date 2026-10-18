import React from 'react';
import { UserCheck, AlertTriangle, Clock, Layers } from 'lucide-react';
import { Stats } from '../types';

interface KpiHeaderProps {
  stats: Stats | undefined;
  activeView: string;
  onSelectView: (view: any) => void;
  isLoading: boolean;
}

export const KpiHeader: React.FC<KpiHeaderProps> = ({ stats, activeView, onSelectView, isLoading }) => {
  const cards = [
    {
      id: 'assigned_to_me',
      title: 'Assigned To Me',
      count: stats?.assignedToMe ?? 0,
      icon: UserCheck,
      color: 'border-blue-500/40 hover:border-blue-500 bg-blue-950/20 text-blue-400',
      activeColor: 'ring-2 ring-blue-500 border-blue-500 bg-blue-950/40 text-blue-300'
    },
    {
      id: 'unassigned_urgent',
      title: 'Unassigned Urgent',
      count: stats?.unassignedUrgent ?? 0,
      icon: AlertTriangle,
      color: 'border-rose-500/40 hover:border-rose-500 bg-rose-950/20 text-rose-400',
      activeColor: 'ring-2 ring-rose-500 border-rose-500 bg-rose-950/40 text-rose-300'
    },
    {
      id: 'awaiting_approval',
      title: 'Awaiting My Approval',
      count: stats?.awaitingMyApproval ?? 0,
      icon: Clock,
      color: 'border-amber-500/40 hover:border-amber-500 bg-amber-950/20 text-amber-400',
      activeColor: 'ring-2 ring-amber-500 border-amber-500 bg-amber-950/40 text-amber-300'
    },
    {
      id: 'all',
      title: 'Total Active Queue',
      count: stats?.totalOpen ?? 0,
      icon: Layers,
      color: 'border-slate-700/60 hover:border-slate-600 bg-slate-900/40 text-slate-300',
      activeColor: 'ring-2 ring-emerald-500 border-emerald-500 bg-slate-800/80 text-emerald-300'
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeView === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onSelectView(c.id)}
            className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden group shadow-lg ${
              isActive ? c.activeColor : c.color
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{c.title}</span>
              <Icon className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-white">
              {isLoading ? '...' : c.count.toLocaleString()}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {isActive ? '● Currently viewing' : 'Click to filter queue →'}
            </div>
          </button>
        );
      })}
    </div>
  );
};
