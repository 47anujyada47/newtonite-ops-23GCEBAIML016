import jwt from 'jsonwebtoken';
import { prisma } from '../src/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-newtonite-operations-under-pressure-2026';

export const getAuthTokenForUser = async (email: string): Promise<{ token: string; user: any }> => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { include: { team: true } } }
  });

  if (!user) {
    throw new Error(`User with email ${email} not found`);
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
  return { token, user };
};
