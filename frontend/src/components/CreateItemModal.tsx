import React, { useState } from 'react';
import { User, WorkItemPriority, WorkItemType } from '../types';
import { apiRequest } from '../api';
import { X, Plus, ShieldCheck } from 'lucide-react';

interface CreateItemModalProps {
  currentUser: User | null;
  onClose: () => void;
  onRefresh: () => void;
  onShowToast: (msg: string, type?: 'success' | 'error' | 'warning') => void;
}

export const CreateItemModal: React.FC<CreateItemModalProps> = ({
  currentUser,
  onClose,
  onRefresh,
  onShowToast
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<WorkItemType>('TASK');
  const [priority, setPriority] = useState<WorkItemPriority>('MEDIUM');
  const [teamId, setTeamId] = useState(currentUser?.memberships[0]?.teamId || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generate an idempotency key tied to this modal session to prevent duplicate submissions on double-click
  const [idempotencyKey] = useState(`create-item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !teamId) {
      onShowToast('Title and Team are required', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest('/items', {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          type,
          priority,
          teamId
        })
      });

      onShowToast('Work item created with idempotency protection!', 'success');
      onRefresh();
      onClose();
    } catch (err: any) {
      onShowToast(err.message || 'Failed to create work item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-750 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Create Work Item</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Title *</label>
            <input
              type="text"
              required
              placeholder="e.g. Memory pressure on shard-04"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
            <textarea
              rows={3}
              placeholder="Detailed operational steps, symptoms, logs..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as WorkItemType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <option value="INCIDENT">🔥 Incident</option>
                <option value="CUSTOMER_ISSUE">💬 Customer Issue</option>
                <option value="PAYMENT">💳 Payment</option>
                <option value="COMPLIANCE">⚖️ Compliance</option>
                <option value="TASK">📋 Task</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as WorkItemPriority)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">🚨 Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Target Team *</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
            >
              {currentUser?.memberships.map((m) => (
                <option key={m.teamId} value={m.teamId}>
                  {m.teamName} ({m.role})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-950/60 p-2.5 rounded-xl border border-slate-850">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Guarded with <strong>Idempotency-Key</strong>. Retries or double-clicks will safely create only one item.</span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg transition-all active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
