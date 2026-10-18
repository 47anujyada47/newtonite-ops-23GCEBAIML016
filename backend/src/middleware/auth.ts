import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { AuthenticatedRequest, AuthUser } from '../types';
import { Role } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-newtonite-operations-under-pressure-2026';

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing. Please provide Authorization: Bearer <token>' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        memberships: {
          include: { team: true }
        }
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User associated with token no longer exists' });
    }

    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
      name: user.name,
      memberships: user.memberships.map((m) => ({
        teamId: m.teamId,
        teamName: m.team.name,
        role: m.role
      }))
    };

    next();
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid or expired authentication token', details: err.message });
  }
};

const ROLE_WEIGHT: Record<Role, number> = {
  VIEWER: 1,
  MEMBER: 2,
  LEAD: 3,
  ADMIN: 4
};

export const checkTeamPermission = (
  user: AuthUser,
  teamId: string,
  minRole: Role = Role.VIEWER
): boolean => {
  const hasGlobalAdmin = user.memberships.some((m) => m.role === Role.ADMIN);
  if (hasGlobalAdmin) return true;

  const membership = user.memberships.find((m) => m.teamId === teamId);
  if (!membership) return false;

  return ROLE_WEIGHT[membership.role] >= ROLE_WEIGHT[minRole];
};

export const requireTeamRole = (minRole: Role = Role.VIEWER) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const teamId = (req.params.teamId || req.body.teamId || req.query.teamId) as string;
    if (!teamId) {
      return res.status(400).json({ error: 'teamId is required for this permission check' });
    }

    const allowed = checkTeamPermission(user, teamId, minRole);
    if (!allowed) {
      return res.status(403).json({
        error: `Forbidden: You do not have permission for team ${teamId}. Required role: ${minRole}`
      });
    }

    next();
  };
};
