/**
 * Fase F2.2 — Rate Limit Institucional.
 *
 * Política de rate limiting do SGD, padronizada e mensurável:
 *
 * Tipos de cliente:
 * - anonymous     → limite por IP (padrão, mais restritivo);
 * - authenticated → limite por usuário (mais flexível);
 * - admin         → limite superior (operações administrativas).
 *
 * Headers de resposta (sempre presentes):
 *   X-RateLimit-Limit      — máximo de requisições na janela;
 *   X-RateLimit-Remaining  — requisições restantes na janela;
 *   X-RateLimit-Reset      — epoch (segundos) quando a janela reinicia.
 *
 * Observabilidade: todo bloqueio (HTTP 429) é registrado em healthStatus
 * (rateLimit.blockedRequests / lastBlockedAt).
 *
 * Compatibilidade: rotas que já usavam express-rate-limit continuam usando;
 * este módulo provê o padrão institucional para novas políticas.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit, { type Options } from 'express-rate-limit';
import { recordRateLimitBlock } from '../lib/healthStatus.js';

/* ------------------------------------------------------------------ */
/* Configuração institucional                                          */
/* ------------------------------------------------------------------ */

export interface RateLimitPolicy {
  windowMs?: number;
  /** Limite para usuários anônimos (por IP). */
  anonymousMax?: number;
  /** Limite para usuários autenticados (por usuário). */
  authenticatedMax?: number;
  /** Limite superior para administradores. */
  adminMax?: number;
  message?: unknown;
}

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const DEFAULT_POLICY: Required<RateLimitPolicy> = {
  windowMs: envInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  anonymousMax: envInt('RATE_LIMIT_ANONYMOUS_MAX', 120),
  authenticatedMax: envInt('RATE_LIMIT_AUTHENTICATED_MAX', 600),
  adminMax: envInt('RATE_LIMIT_ADMIN_MAX', 2000),
  message: { error: 'Muitas requisições. Por favor, tente novamente mais tarde.' },
};

/** Roles considerados administradores para fins de rate limit. */
const ADMIN_ROLES = new Set(['admin', 'administrador']);

function isAdmin(user: any): boolean {
  return !!user && ADMIN_ROLES.has(user.role);
}

/**
 * Extrai o payload do JWT (sem verificação de assinatura) apenas para fins de
 * rate limiting. O middleware roda ANTES do authenticateToken; a segurança da
 * sessão é garantida pelo verify no próprio authenticateToken. Um token
 * forjado só afetaria o próprio bucket de rate limit (sem privilégio extra).
 */
function decodeUser(req: Request): any {
  const user = (req as any).user;
  if (user && typeof user.id !== 'undefined') return user;
  const token =
    req.cookies?.token ||
    (typeof req.headers?.authorization === 'string' ? req.headers.authorization.split(' ')[1] : undefined);
  if (!token) return null;
  try {
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object' && 'id' in decoded) return decoded;
  } catch {
    /* token não decodificável — tratado como anônimo */
  }
  return null;
}

/**
 * Key generator institucional:
 * - autenticado → `user:<id>` (limite por usuário);
 * - admin       → `admin:<id>` (limite superior);
 * - anônimo     → `ip:<ip>` (limite por endereço).
 */
export function institutionalKeyGenerator(req: Request): string {
  const user = decodeUser(req);
  if (user && typeof user.id !== 'undefined') {
    if (isAdmin(user)) return `admin:${user.id}`;
    return `user:${user.id}`;
  }
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/** Registra o bloqueio no healthStatus e mantém o corpo padronizado. */
function institutionalHandler(req: Request, res: Response): void {
  recordRateLimitBlock();
  const policy = (req as any).rateLimitPolicy as Required<RateLimitPolicy> | undefined;
  const body = policy?.message ?? DEFAULT_POLICY.message;
  const retryAfter = Math.ceil((policy?.windowMs ?? DEFAULT_POLICY.windowMs) / 1000);
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json(body);
}

/**
 * Cria um limiter institucional com limite dinâmico conforme o usuário.
 * Deve ser montado DEPOIS do authenticateToken (para conhecer req.user).
 */
export function createInstitutionalRateLimit(policy: RateLimitPolicy = {}) {
  const p: Required<RateLimitPolicy> = { ...DEFAULT_POLICY, ...policy };

  return rateLimit({
    windowMs: p.windowMs,
    limit: (req: Request) => {
      const user = (req as any).user;
      if (isAdmin(user)) return p.adminMax;
      if (user) return p.authenticatedMax;
      return p.anonymousMax;
    },
    keyGenerator: institutionalKeyGenerator,
    standardHeaders: false,
    legacyHeaders: true,
    handler: institutionalHandler,
    message: p.message,
  });
}

/**
 * Handler de bloqueio para limiters existentes (express-rate-limit).
 * Usado como `handler` para registrar bloqueios e enviar headers padrão.
 */
export function rateLimitBlockHandler(req: Request, res: Response): void {
  recordRateLimitBlock();

  const current = (req as any).rateLimit;
  if (current) {
    res.setHeader('X-RateLimit-Limit', String(current.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, current.remaining)));
    res.setHeader('X-RateLimit-Reset', String(current.resetTime ? Math.ceil(current.resetTime.getTime() / 1000) : 0));
  }

  if (req.headers['retry-after'] == null) {
    res.setHeader('Retry-After', '5');
  }

  res.status(429).json({
    error: 'Muitas requisições. Por favor, tente novamente mais tarde.',
  });
}

/**
 * Middleware de auditoria de rate limit: adiciona headers X-RateLimit-* à
 * resposta de limiters existentes (auth/webhook) sem alterar sua política.
 */
export function rateLimitHeaders(req: Request, res: Response, next: NextFunction): void {
  const current = (req as any).rateLimit;
  if (current) {
    res.setHeader('X-RateLimit-Limit', String(current.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, current.remaining)));
    res.setHeader('X-RateLimit-Reset', String(current.resetTime ? Math.ceil(current.resetTime.getTime() / 1000) : 0));
  }
  next();
}

export function getRateLimitPolicy(): Required<RateLimitPolicy> {
  return { ...DEFAULT_POLICY };
}

export type { Options };
