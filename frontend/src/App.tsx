import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, setStoredToken, getStoredToken } from './api';
import { User, WorkItem, Stats } from './types';
import { RoleSwitcher } from './components/RoleSwitcher';
import { KpiHeader } from './components/KpiHeader';
import { WorkItemList } from './components/WorkItemList';
import { WorkItemDetailModal } from './components/WorkItemDetailModal';
import { CreateItemModal } from './components/CreateItemModal';
import { Terminal, Plus, RefreshCw, AlertCircle, CheckCircle, Info } from 'lucide-react';

export const App: React.FC = () => {
  const queryClient = useQueryClient();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<'all' | 'assigned_to_me' | 'unassigned_urgent' | 'awaiting_approval'>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulatedItems, setAccumulatedItems] = useState<WorkItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. Initial login as Lead Ops by default
  const loginUser = async (email: string) => {
    try {
      const res = await apiRequest<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'password123' })
      });
      setStoredToken(res.token);
      setCurrentUser(res.user);
      setCursor(undefined);
      setAccumulatedItems([]);
      queryClient.invalidateQueries({ queryKey: ['workItems'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      showToast(`Logged in as ${res.user.name}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Login failed', 'error');
    }
  };

  useEffect(() => {
    loginUser('lead.ops@newtonite.internal');
  }, []);

  // 2. Fetch stats
  const { data: stats, isLoading: isStatsLoading } = useQuery<Stats>({
    queryKey: ['stats', currentUser?.id],
    queryFn: () => apiRequest<Stats>('/items/stats'),
    enabled: !!currentUser,
    refetchInterval: 10000
  });

  // 3. Fetch items with cursor pagination
  const { data: itemsPage, isLoading: isItemsLoading, isFetching: isItemsFetching } = useQuery<{
    items: WorkItem[];
    pagination: { nextCursor: string | null; hasNextPage: boolean; limit: number };
  }>({
    queryKey: ['workItems', currentUser?.id, activeView, statusFilter, priorityFilter, search, cursor],
    queryFn: () => {
      const q = new URLSearchParams();
      if (activeView !== 'all') q.set('view', activeView);
      if (statusFilter) q.set('status', statusFilter);
      if (priorityFilter) q.set('priority', priorityFilter);
      if (search.trim()) q.set('search', search.trim());
      if (cursor) q.set('cursor', cursor);
      q.set('limit', '25');

      return apiRequest(`/items?${q.toString()}`);
    },
    enabled: !!currentUser
  });

  // Accumulate cursor items
  useEffect(() => {
    if (itemsPage) {
      if (!cursor) {
        setAccumulatedItems(itemsPage.items);
      } else {
        setAccumulatedItems((prev) => {
          const ids = new Set(prev.map((i) => i.id));
          const newItems = itemsPage.items.filter((i) => !ids.has(i.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [itemsPage, cursor]);

  // Reset pagination on filter change
  const handleFilterChange = (setter: (v: any) => void) => (val: any) => {
    setter(val);
    setCursor(undefined);
  };

  const handleLoadMore = () => {
    if (itemsPage?.pagination.nextCursor) {
      setCursor(itemsPage.pagination.nextCursor);
    }
  };

  const handleRefresh = () => {
    setCursor(undefined);
    queryClient.invalidateQueries({ queryKey: ['workItems'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Toast Notification Banner */}
      {toast && (
        <div
          className={`fixed top-14 right-4 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md animate-in slide-in-from-top-4 duration-300 text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-600 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-600 text-rose-200'
              : 'bg-amber-950/90 border-amber-600 text-amber-200'
          }`}
        >
          {toast.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
          {toast.type === 'warning' && <Info className="w-4 h-4 text-amber-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Reviewer Quick Role Switcher Bar */}
      <RoleSwitcher
        currentUser={currentUser}
        onSwitchUser={loginUser}
        isLoading={isItemsFetching}
      />

      {/* Main Workspace Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-lg shadow-emerald-900/40 text-white">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">
                  Newtonite Operations Under Pressure
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                  v1.0-live
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Internal Operations Management Console • Cross-team operational work dispatch
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRefresh}
              disabled={isItemsFetching}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-all disabled:opacity-50"
              title="Refresh queue"
            >
              <RefreshCw className={`w-4 h-4 ${isItemsFetching ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            <button
              onClick={() => setIsCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-950/60 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Create Work Item</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Dashboard Container */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
        {/* Needs Attention KPI Cards */}
        <KpiHeader
          stats={stats}
          activeView={activeView}
          onSelectView={handleFilterChange(setActiveView)}
          isLoading={isStatsLoading}
        />

        {/* Filterable Work Items List with Cursor Pagination */}
        <WorkItemList
          items={accumulatedItems}
          isLoading={isItemsLoading}
          onSelectItem={setSelectedItem}
          onLoadMore={handleLoadMore}
          hasNextPage={!!itemsPage?.pagination.hasNextPage}
          search={search}
          onSearchChange={handleFilterChange(setSearch)}
          statusFilter={statusFilter}
          onStatusChange={handleFilterChange(setStatusFilter)}
          priorityFilter={priorityFilter}
          onPriorityChange={handleFilterChange(setPriorityFilter)}
        />
      </main>

      {/* Item Details & Action Modal */}
      {selectedItem && (
        <WorkItemDetailModal
          item={selectedItem}
          currentUser={currentUser}
          onClose={() => setSelectedItem(null)}
          onRefresh={handleRefresh}
          onShowToast={showToast}
        />
      )}

      {/* Create Item Modal */}
      {isCreateOpen && (
        <CreateItemModal
          currentUser={currentUser}
          onClose={() => setIsCreateOpen(false)}
          onRefresh={handleRefresh}
          onShowToast={showToast}
        />
      )}
    </div>
  );
};
