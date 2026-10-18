import { PrismaClient, WorkItemStatus, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthUser, CreateWorkItemInput, UpdateWorkItemInput, TransitionWorkItemInput } from '../types';
import { checkTeamPermission } from '../middleware/auth';

export class ConflictError extends Error {
  public latestItem?: any;
  constructor(message: string, latestItem?: any) {
    super(message);
    this.name = 'ConflictError';
    this.latestItem = latestItem;
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

// State Machine Transition Rules
const ALLOWED_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  OPEN: [WorkItemStatus.IN_PROGRESS],
  IN_PROGRESS: [WorkItemStatus.AWAITING_APPROVAL, WorkItemStatus.OPEN],
  AWAITING_APPROVAL: [WorkItemStatus.RESOLVED, WorkItemStatus.IN_PROGRESS],
  RESOLVED: [WorkItemStatus.CLOSED, WorkItemStatus.IN_PROGRESS],
  CLOSED: [WorkItemStatus.IN_PROGRESS]
};

export class WorkItemService {
  /**
   * List work items with server-side filters, search, and cursor-based pagination
   */
  static async listItems(
    user: AuthUser,
    params: {
      teamId?: string;
      status?: WorkItemStatus;
      priority?: any;
      assigneeId?: string;
      view?: 'all' | 'assigned_to_me' | 'unassigned_urgent' | 'awaiting_approval';
      search?: string;
      cursor?: string;
      limit?: number;
    }
  ) {
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const userTeamIds = user.memberships.map((m) => m.teamId);
    const isGlobalAdmin = user.memberships.some((m) => m.role === Role.ADMIN);

    // Multi-tenant security check: user can only query their teams unless Global Admin
    let targetTeamIds: string[] = [];
    if (params.teamId) {
      if (!isGlobalAdmin && !userTeamIds.includes(params.teamId)) {
        throw new ForbiddenError('Access denied: You are not a member of the requested team.');
      }
      targetTeamIds = [params.teamId];
    } else {
      targetTeamIds = isGlobalAdmin ? [] : userTeamIds;
    }

    const where: any = {};
    if (targetTeamIds.length > 0) {
      where.teamId = { in: targetTeamIds };
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.priority) {
      where.priority = params.priority;
    }

    if (params.assigneeId) {
      where.assigneeId = params.assigneeId;
    }

    // Special Filter Views
    if (params.view === 'assigned_to_me') {
      where.assigneeId = user.id;
    } else if (params.view === 'unassigned_urgent') {
      where.assigneeId = null;
      where.priority = { in: ['HIGH', 'URGENT'] };
      where.status = { notIn: ['RESOLVED', 'CLOSED'] };
    } else if (params.view === 'awaiting_approval') {
      where.status = WorkItemStatus.AWAITING_APPROVAL;
    }

    // Server-side text search (title & description)
    if (params.search && params.search.trim().length > 0) {
      const q = params.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } }
      ];
    }

    const items = await prisma.workItem.findMany({
      where,
      take: limit + 1,
      skip: params.cursor ? 1 : 0,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        team: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, activity: true } }
      }
    });

    const hasNextPage = items.length > limit;
    const results = hasNextPage ? items.slice(0, limit) : items;
    const nextCursor = hasNextPage ? results[results.length - 1].id : null;

    return {
      items: results,
      pagination: {
        nextCursor,
        hasNextPage,
        limit
      }
    };
  }

  /**
   * Get single work item details with full activity timeline and comments
   */
  static async getItem(user: AuthUser, itemId: string) {
    const item = await prisma.workItem.findUnique({
      where: { id: itemId },
      include: {
        team: true,
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true, email: true } } }
        },
        activity: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { id: true, name: true, email: true } } }
        }
      }
    });

    if (!item) {
      throw new NotFoundError(`Work item ${itemId} not found`);
    }

    // Authorization check
    const hasAccess = checkTeamPermission(user, item.teamId, Role.VIEWER);
    if (!hasAccess) {
      throw new ForbiddenError('Access denied: You do not belong to the team for this item.');
    }

    return item;
  }

  /**
   * Create a new work item with transactional activity log and outbox notification
   */
  static async createItem(user: AuthUser, data: CreateWorkItemInput) {
    // Permission check: requires at least MEMBER role in target team
    const hasPermission = checkTeamPermission(user, data.teamId, Role.MEMBER);
    if (!hasPermission) {
      throw new ForbiddenError('Permission denied: You must be at least a Member of this team to create items.');
    }

    return await prisma.$transaction(async (tx) => {
      const item = await tx.workItem.create({
        data: {
          title: data.title,
          description: data.description,
          type: data.type,
          priority: data.priority,
          status: WorkItemStatus.OPEN,
          version: 1,
          teamId: data.teamId,
          createdById: user.id,
          assigneeId: data.assigneeId || null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null
        },
        include: {
          team: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } }
        }
      });

      // Write Activity Event in the SAME transaction
      await tx.activityEvent.create({
        data: {
          workItemId: item.id,
          actorId: user.id,
          action: 'ITEM_CREATED',
          details: JSON.stringify({
            title: item.title,
            priority: item.priority,
            type: item.type,
            assigneeId: item.assigneeId
          })
        }
      });

      // Write Transactional Outbox Job in the SAME transaction
      if (item.assigneeId) {
        await tx.outboxJob.create({
          data: {
            jobType: 'NOTIFY_ASSIGNEE',
            payload: JSON.stringify({
              workItemId: item.id,
              recipientId: item.assigneeId,
              title: item.title,
              action: 'ASSIGNED'
            })
          }
        });
      }

      return item;
    });
  }

  /**
   * CRITICAL BEHAVIOR 1: Concurrency-Safe Atomic Claim
   * Uses conditional update (WHERE assigneeId IS NULL).
   * Guarantees that if 2 users fire parallel claims, exactly one wins with 200, second receives 409 Conflict.
   */
  static async claimItem(user: AuthUser, itemId: string) {
    const existing = await prisma.workItem.findUnique({
      where: { id: itemId },
      include: { team: true }
    });

    if (!existing) {
      throw new NotFoundError(`Work item ${itemId} not found`);
    }

    const hasPermission = checkTeamPermission(user, existing.teamId, Role.MEMBER);
    if (!hasPermission) {
      throw new ForbiddenError('Permission denied: You must be at least a Member of this team to claim items.');
    }

    if (existing.assigneeId !== null) {
      throw new ConflictError('This item has already been claimed by another user.', existing);
    }

    // Execute atomic update in a transaction
    return await prisma.$transaction(async (tx) => {
      // Raw conditional update guarantees row-level concurrency protection
      const updatedRows: any[] = await tx.$queryRaw`
        UPDATE "WorkItem"
        SET 
          "assigneeId" = ${user.id},
          "status" = CASE WHEN "status" = 'OPEN' THEN 'IN_PROGRESS'::"WorkItemStatus" ELSE "status" END,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${itemId} AND "assigneeId" IS NULL
        RETURNING *;
      `;

      if (updatedRows.length === 0) {
        // Race condition caught: another user claimed it between the read and write
        const currentItem = await tx.workItem.findUnique({ where: { id: itemId } });
        throw new ConflictError('This item was just claimed by another user.', currentItem);
      }

      const claimedItem = updatedRows[0];

      // Record Activity Event in the SAME transaction
      await tx.activityEvent.create({
        data: {
          workItemId: itemId,
          actorId: user.id,
          action: 'ITEM_CLAIMED',
          details: JSON.stringify({
            previousAssignee: null,
            newAssignee: user.name,
            newAssigneeId: user.id,
            status: claimedItem.status
          })
        }
      });

      // Write Outbox Job in the SAME transaction
      await tx.outboxJob.create({
        data: {
          jobType: 'NOTIFY_ASSIGNEE',
          payload: JSON.stringify({
            workItemId: itemId,
            recipientId: user.id,
            title: claimedItem.title,
            action: 'CLAIMED'
          })
        }
      });

      return claimedItem;
    });
  }

  /**
   * CRITICAL BEHAVIOR 2: Optimistic Locking / Stale Edits
   * Update checks that version matches. On mismatch, returns 409 Conflict with the fresh data.
   */
  static async updateItem(user: AuthUser, itemId: string, input: UpdateWorkItemInput) {
    const existing = await prisma.workItem.findUnique({ where: { id: itemId } });
    if (!existing) {
      throw new NotFoundError(`Work item ${itemId} not found`);
    }

    const hasPermission = checkTeamPermission(user, existing.teamId, Role.MEMBER);
    if (!hasPermission) {
      throw new ForbiddenError('Permission denied: You must be at least a Member of this team to edit items.');
    }

    // Optimistic concurrency check
    if (existing.version !== input.version) {
      throw new ConflictError(
        `Version conflict: Item was modified by another user (expected version ${input.version}, currently ${existing.version}).`,
        existing
      );
    }

    return await prisma.$transaction(async (tx) => {
      // Conditional update enforcing version match
      const updatedRows: any[] = await tx.$queryRaw`
        UPDATE "WorkItem"
        SET 
          "title" = COALESCE(${input.title}, "title"),
          "description" = COALESCE(${input.description}, "description"),
          "priority" = COALESCE(${input.priority}::"WorkItemPriority", "priority"),
          "assigneeId" = CASE WHEN ${input.assigneeId !== undefined} THEN ${input.assigneeId} ELSE "assigneeId" END,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${itemId} AND "version" = ${input.version}
        RETURNING *;
      `;

      if (updatedRows.length === 0) {
        const fresh = await tx.workItem.findUnique({ where: { id: itemId } });
        throw new ConflictError('Concurrent edit collision: Data has changed since you opened it.', fresh);
      }

      const updated = updatedRows[0];

      // Record Activity Event in the SAME transaction
      await tx.activityEvent.create({
        data: {
          workItemId: itemId,
          actorId: user.id,
          action: 'ITEM_UPDATED',
          details: JSON.stringify({
            previousVersion: input.version,
            newVersion: updated.version,
            changes: {
              title: input.title !== undefined ? input.title : undefined,
              priority: input.priority !== undefined ? input.priority : undefined,
              assigneeId: input.assigneeId !== undefined ? input.assigneeId : undefined
            }
          })
        }
      });

      return updated;
    });
  }

  /**
   * CRITICAL BEHAVIOR 3 & 4: Workflow State Machine & Lead Approval Gate
   * Strictly enforces allowed transitions.
   * Moving to RESOLVED requires LEAD or ADMIN role.
   */
  static async transitionItem(user: AuthUser, itemId: string, input: TransitionWorkItemInput) {
    const existing = await prisma.workItem.findUnique({ where: { id: itemId } });
    if (!existing) {
      throw new NotFoundError(`Work item ${itemId} not found`);
    }

    // Check allowed state transitions
    const validTargets = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!validTargets.includes(input.status)) {
      throw new BadRequestError(
        `Invalid workflow transition: Cannot transition from '${existing.status}' to '${input.status}'. Allowed: [${validTargets.join(', ')}]`
      );
    }

    // Role check: Transition to RESOLVED requires LEAD or ADMIN
    if (input.status === WorkItemStatus.RESOLVED) {
      const isLead = checkTeamPermission(user, existing.teamId, Role.LEAD);
      if (!isLead) {
        throw new ForbiddenError('Approval gate restricted: Only team Leads or Admins can approve and resolve work items.');
      }
    } else {
      const isMember = checkTeamPermission(user, existing.teamId, Role.MEMBER);
      if (!isMember) {
        throw new ForbiddenError('Permission denied: You must be at least a Member of this team to transition items.');
      }
    }

    // Optimistic locking version check
    if (existing.version !== input.version) {
      throw new ConflictError(
        `Status change conflict: Item was changed concurrently (current version is ${existing.version}).`,
        existing
      );
    }

    return await prisma.$transaction(async (tx) => {
      const updatedRows: any[] = await tx.$queryRaw`
        UPDATE "WorkItem"
        SET 
          "status" = ${input.status}::"WorkItemStatus",
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${itemId} AND "version" = ${input.version}
        RETURNING *;
      `;

      if (updatedRows.length === 0) {
        const fresh = await tx.workItem.findUnique({ where: { id: itemId } });
        throw new ConflictError('Concurrent state update rejected.', fresh);
      }

      const updated = updatedRows[0];

      // Record Activity Event in the SAME transaction
      await tx.activityEvent.create({
        data: {
          workItemId: itemId,
          actorId: user.id,
          action: 'STATUS_TRANSITION',
          details: JSON.stringify({
            from: existing.status,
            to: input.status,
            approvedByLead: input.status === WorkItemStatus.RESOLVED ? user.name : null
          })
        }
      });

      // Write Outbox Job in the SAME transaction
      await tx.outboxJob.create({
        data: {
          jobType: 'STATUS_NOTIFICATION',
          payload: JSON.stringify({
            workItemId: itemId,
            oldStatus: existing.status,
            newStatus: input.status,
            actor: user.name
          })
        }
      });

      return updated;
    });
  }

  /**
   * Add a comment to a work item
   */
  static async addComment(user: AuthUser, itemId: string, body: string) {
    if (!body || body.trim().length === 0) {
      throw new BadRequestError('Comment body cannot be empty.');
    }

    const item = await prisma.workItem.findUnique({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundError(`Work item ${itemId} not found`);
    }

    const hasAccess = checkTeamPermission(user, item.teamId, Role.VIEWER);
    if (!hasAccess) {
      throw new ForbiddenError('Access denied: You do not belong to the team for this item.');
    }

    return await prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          workItemId: itemId,
          authorId: user.id,
          body: body.trim()
        },
        include: { author: { select: { id: true, name: true, email: true } } }
      });

      await tx.activityEvent.create({
        data: {
          workItemId: itemId,
          actorId: user.id,
          action: 'COMMENT_ADDED',
          details: JSON.stringify({ commentId: comment.id, author: user.name })
        }
      });

      return comment;
    });
  }

  /**
   * Aggregate statistics for Dashboard "Needs Attention" widgets
   */
  static async getStats(user: AuthUser) {
    const userTeamIds = user.memberships.map((m) => m.teamId);
    const isGlobalAdmin = user.memberships.some((m) => m.role === Role.ADMIN);

    const teamFilter = isGlobalAdmin ? {} : { teamId: { in: userTeamIds } };

    const [assignedToMe, unassignedUrgent, awaitingMyApproval, totalOpen] = await Promise.all([
      // 1. Assigned to current user
      prisma.workItem.count({
        where: {
          ...teamFilter,
          assigneeId: user.id,
          status: { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CLOSED] }
        }
      }),
      // 2. Unassigned urgent items
      prisma.workItem.count({
        where: {
          ...teamFilter,
          assigneeId: null,
          priority: { in: ['HIGH', 'URGENT'] },
          status: { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CLOSED] }
        }
      }),
      // 3. Awaiting approval (items in user's lead teams)
      prisma.workItem.count({
        where: {
          ...teamFilter,
          status: WorkItemStatus.AWAITING_APPROVAL
        }
      }),
      // 4. Total active
      prisma.workItem.count({
        where: {
          ...teamFilter,
          status: { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CLOSED] }
        }
      })
    ]);

    return {
      assignedToMe,
      unassignedUrgent,
      awaitingMyApproval,
      totalOpen
    };
  }
}
