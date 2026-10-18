import React, { useState } from 'react';
import { WorkItem, WorkItemStatus, User as UserType } from '../types';
import { apiRequest, ApiError } from '../api';
import { X, UserCheck, CheckCircle, ArrowRight, Clock, MessageSquare, History, AlertTriangle, ShieldAlert } from 'lucide-react';

interface WorkItemDetailModalProps {
  item: WorkItem;
  currentUser: UserType | null;
  onClose: () => void;
  onRefresh: () => void;
  onShowToast: (msg: string, type?: 'success' | 'error' | 'warning') => void;
}

export const WorkItemDetailModal: React.FC<WorkItemDetailModalProps> = ({
  item,
  currentUser,
  onClose,
  onRefresh,
  onShowToast
}) => {
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description || '');
  const [editPriority, setEditPriority] = useState(item.priority);

  // Check if current user is Lead or Admin for this item's team
  const isGlobalAdmin = currentUser?.memberships.some((m) => m.role === 'ADMIN');
  const userTeamMembership = currentUser?.memberships.find((m) => m.teamId === item.teamId);
  const isLead = isGlobalAdmin || userTeamMembership?.role === 'LEAD';

  // 1. Concurrency-Safe Atomic Claim Handler
  const handleClaim = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest(`/items/${item.id}/claim`, { method: 'POST' });
      onShowToast('Successfully claimed work item!', 'success');
      onRefresh();
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        onShowToast('CONCURRENCY CONFLICT: Another user claimed this item right before you!', 'error');
      } else {
        onShowToast(err.message || 'Failed to claim item', 'error');
      }
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2. Workflow Transition Handler
  const handleTransition = async (targetStatus: WorkItemStatus) => {
    setIsSubmitting(true);
    try {
      await apiRequest(`/items/${item.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status: targetStatus, version: item.version })
      });
      onShowToast(`Transitioned status to ${targetStatus}!`, 'success');
      onRefresh();
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        onShowToast('VERSION CONFLICT: Item was updated concurrently. Please reload.', 'warning');
      } else if (err instanceof ApiError && err.status === 403) {
        onShowToast('FORBIDDEN: Only team Leads can approve items to Resolved.', 'error');
      } else {
        onShowToast(err.message || 'Transition failed', 'error');
      }
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Optimistic Locking Edit Handler
  const handleSaveEdit = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest(`/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: item.version, // Required for optimistic lock
          title: editTitle,
          description: editDescription,
          priority: editPriority
        })
      });
      onShowToast('Work item updated successfully!', 'success');
      setIsEditing(false);
      onRefresh();
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        onShowToast('OPTIMISTIC LOCK CONFLICT: The item was modified by another user! Reloading fresh data...', 'error');
      } else {
        onShowToast(err.message || 'Failed to update item', 'error');
      }
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. Add Comment Handler
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    setIsSubmitting(true);
    try {
      await apiRequest(`/items/${item.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentText.trim() })
      });
      setCommentText('');
      onShowToast('Comment added to activity timeline.', 'success');
      onRefresh();
    } catch (err: any) {
      onShowToast(err.message || 'Failed to add comment', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-750 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-start justify-between bg-slate-950/40">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {item.type}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800">
                Status: {item.status}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                Lock Version: v{item.version}
              </span>
            </div>
            {!isEditing ? (
              <h2 className="text-lg font-bold text-slate-100">{item.title}</h2>
            ) : (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-base font-semibold text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Action Bar (Claim & Workflow Transitions) */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {item.assigneeId === null ? (
                <button
                  onClick={handleClaim}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg transition-all active:scale-95 disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Claim Item (Atomic Safe)</span>
                </button>
              ) : (
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>Assigned to: <strong className="text-white">{item.assignee?.name}</strong></span>
                </div>
              )}
            </div>

            {/* Workflow Pipeline Transitions */}
            <div className="flex items-center gap-2 flex-wrap">
              {item.status === 'OPEN' && (
                <button
                  onClick={() => handleTransition('IN_PROGRESS')}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-all"
                >
                  <span>Start Work →</span>
                </button>
              )}

              {item.status === 'IN_PROGRESS' && (
                <button
                  onClick={() => handleTransition('AWAITING_APPROVAL')}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-all"
                >
                  <span>Submit for Approval →</span>
                </button>
              )}

              {item.status === 'AWAITING_APPROVAL' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTransition('RESOLVED')}
                    disabled={isSubmitting || !isLead}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isLead
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    }`}
                    title={isLead ? 'Lead sign-off' : 'Only team Leads can approve'}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Approve & Resolve {isLead ? '(Lead Gate)' : '(Requires Lead)'}</span>
                  </button>
                  <button
                    onClick={() => handleTransition('IN_PROGRESS')}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 rounded-lg bg-rose-900/40 border border-rose-700 text-rose-300 text-xs font-medium hover:bg-rose-900/60"
                  >
                    Reject Back to Progress
                  </button>
                </div>
              )}

              {item.status === 'RESOLVED' && (
                <button
                  onClick={() => handleTransition('CLOSED')}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Close Item
                </button>
              )}
            </div>
          </div>

          {/* Description & Edit Block */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description & Metadata</h4>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-xs text-emerald-400 hover:underline font-medium"
                >
                  Edit Item (Optimistic Lock)
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSubmitting}
                    className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>

            {!isEditing ? (
              <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                {item.description || 'No description provided.'}
              </p>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Priority:</span>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as any)}
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Activity History Timeline (Append-Only Audit Log) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <History className="w-4 h-4 text-emerald-400" />
              <span>Audit Trail (Append-Only Activity History)</span>
            </div>

            <div className="border border-slate-800 rounded-xl bg-slate-950/30 p-4 space-y-3 max-h-48 overflow-y-auto">
              {item.activity && item.activity.length > 0 ? (
                item.activity.map((act) => (
                  <div key={act.id} className="text-xs flex items-start gap-2.5 border-b border-slate-850 pb-2 last:border-0 last:pb-0">
                    <Clock className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <span className="font-semibold text-slate-200">{act.actor?.name || 'System'}</span>
                      <span className="text-slate-400 font-mono mx-1.5">[{act.action}]</span>
                      <span className="text-slate-400">{act.details}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                      {new Date(act.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 text-center py-2">No activity events recorded yet</div>
              )}
            </div>
          </div>

          {/* Comments Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span>Discussion & Notes</span>
            </div>

            <div className="space-y-2">
              {item.comments && item.comments.length > 0 ? (
                item.comments.map((comm) => (
                  <div key={comm.id} className="p-3 rounded-xl bg-slate-950/50 border border-slate-850 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-slate-200">{comm.author?.name}</strong>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(comm.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-300">{comm.body}</p>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 italic">No comments yet.</div>
              )}

              <form onSubmit={handleAddComment} className="flex gap-2 pt-2">
                <input
                  type="text"
                  placeholder="Add a comment or operational update..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !commentText.trim()}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  Comment
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
