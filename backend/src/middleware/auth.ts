import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserResponse } from '../types.js';
import { get, run } from '../database.js';
import { logger } from '../lib/logger.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (JWT_SECRET ? `${JWT_SECRET}_refresh` : null);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET inválido ou não configurado. Deve ter pelo menos 32 caracteres.');
}

declare global {
  namespace Express {
    interface Request {
      user?: UserResponse;
      refreshTokenId?: number;
      refreshFamily?: string;
    }
  }
}

export interface AuthRequest extends Request {
  user?: UserResponse;
}

const BLACKLIST_CLEANUP_INTERVAL = 15 * 60 * 1000;
let lastBlacklistCleanup = 0;

const cleanupBlacklist = async () => {
  const now = Date.now();
  if (now - lastBlacklistCleanup < BLACKLIST_CLEANUP_INTERVAL) {
    return;
  }
  lastBlacklistCleanup = now;
  try {
    await run('DELETE FROM token_blacklist WHERE expires_at < NOW()');
  } catch { }
};

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as UserResponse;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const blacklisted = await get('SELECT id FROM token_blacklist WHERE token_hash = $1', [tokenHash]);
    if (blacklisted) {
      return res.status(401).json({ error: 'Sessão encerrada. Faça login novamente.' });
    }
    req.user = decoded;
    cleanupBlacklist();
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
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
    if (req.user.role === 'admin' || req.user.role === 'administrador') {
      return next();
    }
    if (req.user.permissions && req.user.permissions.length > 0) {
      if (req.user.permissions.includes(permissionKey)) {
        return next();
      }
      return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para executar esta ação.' });
    }
    try {
      const result = await get<{ granted: boolean }>(
        `SELECT TRUE as granted FROM (
          SELECT up.granted FROM user_permissions up
          JOIN permissions p ON p.id = up.permission_id
          WHERE up.user_id = $1 AND p.key = $2 AND up.granted = TRUE
          UNION
          SELECT TRUE FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role = (SELECT role FROM users WHERE id = $1) AND p.key = $2
        ) sub`,
        [req.user.id, permissionKey]
      );
      if (!result) {
        return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para executar esta ação.' });
      }
      next();
    } catch (error) {
      logger.error('Permission check error', { error: error instanceof Error ? error.message : error });
      return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
  };
};

export function signAccessToken(user: { id: number; email: string; name: string; role: string }, permissions?: string[]): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, ...(permissions ? { permissions } : {}) },
    JWT_SECRET!,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

export function signRefreshToken(userId: number, family: string): string {
  const payload = { userId, family, type: 'refresh' };
  if (!REFRESH_SECRET) {
    throw new Error('Refresh secret não configurado');
  }
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d`
  });
}

export const authenticateRefreshToken = async (req: Request, res: Response, next: NextFunction) => {
  const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token não fornecido' });
  }
  try {
    if (!REFRESH_SECRET) {
      throw new Error('Refresh secret não configurado');
    }
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { userId: number; family: string };
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const stored = await get<{ id: number; revoked: boolean; user_id: number; family: string; replaced_by: string | null }>(
      'SELECT id, revoked, user_id, family, replaced_by FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    if (!stored || stored.revoked) {
      if (stored?.replaced_by) {
        const replacement = await get<{ id: number }>('SELECT id FROM refresh_tokens WHERE token_hash = $1', [stored.replaced_by]);
        if (!replacement) {
          await run('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND family = $2', [decoded.userId, decoded.family]);
        }
      }
      return res.status(401).json({ error: 'Refresh token inválido ou revogado' });
    }
    const user = await get<{ id: number; email: string; name: string; role: string }>(
      'SELECT id, email, name, role FROM users WHERE id = $1 AND active = TRUE AND deleted_at IS NULL',
      [stored.user_id]
    );
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado ou inativo' });
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role as UserResponse['role'] };
    req.refreshTokenId = stored.id;
    req.refreshFamily = stored.family;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
  }
};
