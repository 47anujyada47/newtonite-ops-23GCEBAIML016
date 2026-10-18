import React from 'react';
import { WorkItem, WorkItemPriority, WorkItemStatus, WorkItemType } from '../types';
import { AlertCircle, Clock, CheckCircle2, ChevronRight, User, Hash, Search, Filter } from 'lucide-react';

interface WorkItemListProps {
  items: WorkItem[];
  isLoading: boolean;
  onSelectItem: (item: WorkItem) => void;
  onLoadMore: () => void;
  hasNextPage: boolean;
  search: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusChange: (val: string) => void;
  priorityFilter: string;
  onPriorityChange: (val: string) => void;
}

const PRIORITY_BADGES: Record<WorkItemPriority, { label: string; class: string }> = {
  URGENT: { label: 'URGENT', class: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' },
  HIGH: { label: 'HIGH', class: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  MEDIUM: { label: 'MED', class: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  LOW: { label: 'LOW', class: 'bg-slate-700/50 text-slate-300 border-slate-600' }
};

const STATUS_BADGES: Record<WorkItemStatus, { label: string; class: string }> = {
  OPEN: { label: 'Open', class: 'bg-slate-800 text-slate-300 border-slate-700' },
  IN_PROGRESS: { label: 'In Progress', class: 'bg-blue-900/40 text-blue-300 border-blue-700' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', class: 'bg-amber-900/40 text-amber-300 border-amber-700' },
  RESOLVED: { label: 'Resolved', class: 'bg-emerald-900/40 text-emerald-300 border-emerald-700' },
  CLOSED: { label: 'Closed', class: 'bg-slate-900 text-slate-500 border-slate-800 line-through' }
};

const TYPE_ICONS: Record<WorkItemType, string> = {
  INCIDENT: '🔥 Incident',
  CUSTOMER_ISSUE: '💬 Issue',
  PAYMENT: '💳 Payment',
  COMPLIANCE: '⚖️ Compliance',
  TASK: '📋 Task'
};

export const WorkItemList: React.FC<WorkItemListProps> = ({
  items,
  isLoading,
  onSelectItem,
  onLoadMore,
  hasNextPage,
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange
}) => {
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
      {/* Search and Filters Bar */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search items by title or description..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label="Filter by Status"
            className="bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="AWAITING_APPROVAL">Awaiting Approval</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => onPriorityChange(e.target.value)}
            aria-label="Filter by Priority"
            className="bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">All Priorities</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </div>

      {/* Work Item Rows */}
      <div className="divide-y divide-slate-850">
        {items.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-base font-medium text-slate-400">No work items found matching criteria</p>
            <p className="text-xs text-slate-500 mt-1">Try relaxing filters or search terms</p>
          </div>
        ) : (
          items.map((item) => {
            const priorityBadge = PRIORITY_BADGES[item.priority] || PRIORITY_BADGES.MEDIUM;
            const statusBadge = STATUS_BADGES[item.status] || STATUS_BADGES.OPEN;

            return (
              <div
                key={item.id}
                onClick={() => onSelectItem(item)}
                className="p-4 hover:bg-slate-900/60 transition-colors cursor-pointer flex items-center justify-between gap-4 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-xs font-mono font-medium text-slate-400">
                      {TYPE_ICONS[item.type] || item.type}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border tracking-wider ${priorityBadge.class}`}>
                      {priorityBadge.label}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${statusBadge.class}`}>
                      {statusBadge.label}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                      v{item.version}
                    </span>
                    <span className="text-xs text-slate-500 truncate">
                      in <strong className="text-slate-400">{item.team?.name}</strong>
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-slate-100 group-hover:text-emerald-400 transition-colors truncate">
                    {item.title}
                  </h3>

                  {item.description && (
                    <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{item.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0 text-xs">
                  {item.assignee ? (
                    <div className="flex items-center gap-1.5 text-slate-300 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-850">
                      <User className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-medium truncate max-w-[120px]">{item.assignee.name}</span>
                    </div>
                  ) : (
                    <div className="px-2.5 py-1 rounded-lg border border-dashed border-amber-600/60 bg-amber-950/20 text-amber-300 font-medium">
                      Unassigned
                    </div>
                  )}

                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Footer */}
      {hasNextPage && (
        <div className="p-4 border-t border-slate-800 text-center bg-slate-900/30">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="px-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 hover:border-slate-600 transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {isLoading ? 'Loading More Items...' : 'Load More Work Items (Next Cursor Page) ↓'}
          </button>
        </div>
      )}
    </div>
  );
};
