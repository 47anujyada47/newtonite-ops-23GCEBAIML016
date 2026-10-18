import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import {
  WorkItemService,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  BadRequestError
} from '../services/workItemService';
import { AuthenticatedRequest, AuthUser } from '../types';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

const getAuthUser = (req: Request): AuthUser => {
  return (req as AuthenticatedRequest).user!;
};

// Error response helper
const handleError = (res: Response, error: any) => {
  if (error instanceof ConflictError) {
    return res.status(409).json({ error: error.message, latestItem: error.latestItem });
  }
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ error: error.message });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof BadRequestError) {
    return res.status(400).json({ error: error.message });
  }

  console.error('Unhandled route error:', error);
  return res.status(500).json({ error: 'Internal server error', details: error.message });
};

// 1. Dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await WorkItemService.getStats(getAuthUser(req));
    return res.json(stats);
  } catch (err) {
    return handleError(res, err);
  }
});

// 2. List work items with server-side filters, search, and cursor pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const { teamId, status, priority, assigneeId, view, search, cursor, limit } = req.query;

    const data = await WorkItemService.listItems(getAuthUser(req), {
      teamId: teamId as string | undefined,
      status: status as any,
      priority: priority as any,
      assigneeId: assigneeId as string | undefined,
      view: view as any,
      search: search as string | undefined,
      cursor: cursor as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined
    });

    return res.json(data);
  } catch (err) {
    return handleError(res, err);
  }
});

// 3. Create a work item (Supports Idempotency-Key header)
router.post('/', idempotencyMiddleware, async (req: Request, res: Response) => {
  try {
    const { title, description, type, priority, teamId, assigneeId, dueDate } = req.body;

    if (!title || !type || !priority || !teamId) {
      return res.status(400).json({ error: 'Missing required fields: title, type, priority, and teamId are required.' });
    }

    const item = await WorkItemService.createItem(getAuthUser(req), {
      title,
      description,
      type,
      priority,
      teamId,
      assigneeId,
      dueDate
    });

    return res.status(201).json(item);
  } catch (err) {
    return handleError(res, err);
  }
});

// 4. Get single item details (with activity timeline and comments)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await WorkItemService.getItem(getAuthUser(req), req.params.id);
    return res.json(item);
  } catch (err) {
    return handleError(res, err);
  }
});

// 5. Update work item (CRITICAL BEHAVIOR: Optimistic Locking with version check)
router.patch('/:id', idempotencyMiddleware, async (req: Request, res: Response) => {
  try {
    const { version, title, description, priority, assigneeId, dueDate } = req.body;

    if (version === undefined || typeof version !== 'number') {
      return res.status(400).json({
        error: "Missing required 'version' number field for optimistic concurrency control."
      });
    }

    const updated = await WorkItemService.updateItem(getAuthUser(req), req.params.id, {
      version,
      title,
      description,
      priority,
      assigneeId,
      dueDate
    });

    return res.json(updated);
  } catch (err) {
    return handleError(res, err);
  }
});

// 6. Concurrency-Safe Atomic Claim (CRITICAL BEHAVIOR 1)
router.post('/:id/claim', idempotencyMiddleware, async (req: Request, res: Response) => {
  try {
    const claimed = await WorkItemService.claimItem(getAuthUser(req), req.params.id);
    return res.json({ message: 'Item claimed successfully', item: claimed });
  } catch (err) {
    return handleError(res, err);
  }
});

// 7. Workflow State Transition with Lead Approval Gate (CRITICAL BEHAVIOR 3 & 4)
router.post('/:id/transition', idempotencyMiddleware, async (req: Request, res: Response) => {
  try {
    const { status, version } = req.body;

    if (!status || version === undefined) {
      return res.status(400).json({
        error: "Both 'status' and 'version' are required for workflow transitions."
      });
    }

    const transitioned = await WorkItemService.transitionItem(getAuthUser(req), req.params.id, {
      status,
      version
    });

    return res.json({ message: `Item successfully transitioned to ${status}`, item: transitioned });
  } catch (err) {
    return handleError(res, err);
  }
});

// 8. Add comment
router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const { body } = req.body;
    const comment = await WorkItemService.addComment(getAuthUser(req), req.params.id, body);
    return res.status(201).json(comment);
  } catch (err) {
    return handleError(res, err);
  }
});

// 9. Activity history timeline
router.get('/:id/activity', async (req: Request, res: Response) => {
  try {
    const item = await WorkItemService.getItem(getAuthUser(req), req.params.id);
    return res.json({ activity: item.activity });
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;
