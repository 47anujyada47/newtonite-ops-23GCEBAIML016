import { Request } from 'express';
import { Role, WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  memberships: {
    teamId: string;
    teamName: string;
    role: Role;
  }[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface CreateWorkItemInput {
  title: string;
  description?: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  teamId: string;
  assigneeId?: string;
  dueDate?: string;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
  version: number;
}

export interface TransitionWorkItemInput {
  status: WorkItemStatus;
  version: number;
}
