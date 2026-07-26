import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserResponse } from '../types.js';
import { get } from '../database.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserResponse;
    }
  }
}

export interface AuthRequest extends Request {
  user?: UserResponse;
}

const cleanupBlacklist = async () => {
  try {
    const { run } = await import('../database.js');
    await run('DELETE FROM token_blacklist WHERE expires_at < NOW()');
  } catch { /* non-critical cleanup */ }
};

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as UserResponse;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const blacklisted = await get('SELECT id FROM token_blacklist WHERE token_hash = $1', [tokenHash]);
    if (blacklisted) {
      return res.status(401).json({ error: 'Sessão encerrada. Faça login novamente.' });
    }

    req.user = decoded;
    cleanupBlacklist();
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido ou expirado' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }

    next();
  };
};

export const requirePermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    if (req.user.role === 'admin') {
      return next();
    }
    try {
      const result = await get<{ granted: boolean }>(
        `SELECT up.granted FROM user_permissions up
         JOIN permissions p ON p.id = up.permission_id
         WHERE up.user_id = $1 AND p.key = $2 AND up.granted = TRUE`,
        [req.user.id, permissionKey]
      );
      if (!result) {
        return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para executar esta ação.' });
      }
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
  };
};

export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as UserResponse;
      req.user = decoded;
    } catch (error) {
      // Token invalid, continue without user
    }
  }

  next();
};