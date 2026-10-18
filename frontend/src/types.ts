export type Role = 'VIEWER' | 'MEMBER' | 'LEAD' | 'ADMIN';

export type WorkItemType = 'INCIDENT' | 'CUSTOMER_ISSUE' | 'PAYMENT' | 'COMPLIANCE' | 'TASK';

export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type WorkItemStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'RESOLVED' | 'CLOSED';

export interface User {
  id: string;
  name: string;
  email: string;
  memberships: {
    teamId: string;
    teamName: string;
    role: Role;
  }[];
}

export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  type: WorkItemType;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  version: number;
  teamId: string;
  createdById: string;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  team: { id: string; name: string };
  assignee: { id: string; name: string; email: string } | null;
  createdBy: { id: string; name: string; email: string };
  _count?: { comments: number; activity: number };
  comments?: Comment[];
  activity?: ActivityEvent[];
}

export interface ActivityEvent {
  id: string;
  workItemId: string;
  actorId: string;
  action: string;
  details: string;
  createdAt: string;
  actor: { id: string; name: string; email: string };
}

export interface Comment {
  id: string;
  workItemId: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; email: string };
}

export interface Stats {
  assignedToMe: number;
  unassignedUrgent: number;
  awaitingMyApproval: number;
  totalOpen: number;
}
