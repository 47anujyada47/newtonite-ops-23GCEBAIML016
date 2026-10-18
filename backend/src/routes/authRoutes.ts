import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-newtonite-operations-under-pressure-2026';

// Login route
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          include: { team: true }
        }
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: user.memberships.map((m) => ({
          teamId: m.teamId,
          teamName: m.team.name,
          role: m.role
        }))
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Current User Profile
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  return res.json({ user: req.user });
});

// Demo accounts endpoint for reviewer convenience
router.get('/demo-users', async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    take: 10,
    orderBy: { email: 'asc' },
    select: {
      id: true,
      email: true,
      name: true,
      memberships: {
        select: {
          team: { select: { id: true, name: true } },
          role: true
        }
      }
    }
  });

  return res.json({
    defaultPassword: 'password123',
    users
  });
});

export default router;
