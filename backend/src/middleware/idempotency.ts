import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../types';

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!['POST', 'PATCH', 'PUT'].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    return next();
  }

  const user = (req as AuthenticatedRequest).user;
  const userId = user?.id || 'anonymous';
  const path = req.originalUrl || req.url;
  const requestBodyStr = JSON.stringify(req.body || {});
  const requestHash = crypto.createHash('sha256').update(requestBodyStr).digest('hex');

  try {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey }
    });

    if (existing) {
      if (existing.userId !== userId || existing.path !== path) {
        return res.status(409).json({
          error: 'Idempotency key collision with different user or route'
        });
      }

      res.setHeader('X-Cache', 'HIT-IDEMPOTENT');
      return res.status(existing.statusCode).json(JSON.parse(existing.responseBody));
    }

    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      res.json = originalJson;

      if (res.statusCode < 500) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        prisma.idempotencyKey
          .create({
            data: {
              key: idempotencyKey,
              userId,
              path,
              requestHash,
              statusCode: res.statusCode,
              responseBody: JSON.stringify(body),
              expiresAt
            }
          })
          .catch((err) => {
            console.error('Failed to store idempotency key:', err);
          });
      }

      return originalJson(body);
    };

    next();
  } catch (error) {
    console.error('Idempotency middleware error:', error);
    next();
  }
};
