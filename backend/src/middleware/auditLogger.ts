import type { NextFunction, Request, Response } from 'express';
import { maskEmail, maskText } from '../utils/mask.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    return key?.toLowerCase().includes('email') || EMAIL_PATTERN.test(value)
      ? maskEmail(value)
      : maskText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, maskValue(entryValue, entryKey)])
    );
  }

  return value;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim() || req.ip || 'unknown';
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim() || req.ip || 'unknown';
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function auditLogger(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  res.on('finish', () => {
    const record = {
      timestamp: new Date().toISOString(),
      userId: req.user?.id ?? 'anonymous',
      action: `${req.method} ${req.originalUrl || req.url}`,
      ip: getClientIp(req),
      statusCode: res.statusCode,
      payloadMasked: {
        params: maskValue(req.params),
        body: maskValue(req.body),
      },
    };

    process.stdout.write(`${JSON.stringify(record)}\n`);
  });

  next();
}
