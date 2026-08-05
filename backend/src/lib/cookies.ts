import { Response } from 'express';
import crypto from 'crypto';
import { logger } from './logger.js';

const isProduction = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

if (isProduction && !process.env.COOKIE_DOMAIN) {
  logger.warn('COOKIE_DOMAIN não definido em produção. Cookies podem não funcionar entre subdomínios.');
}

const BASE_COOKIE = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
  domain: COOKIE_DOMAIN,
  path: '/',
};

if (isProduction && BASE_COOKIE.sameSite === 'none' && !BASE_COOKIE.secure) {
  logger.error('COOKIE SECURE ERROR: sameSite=none requer secure=true em produção');
}

export function setCsrfCookie(res: Response) {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', csrfToken, {
    ...BASE_COOKIE,
    httpOnly: false,
    maxAge: 24 * 60 * 60 * 1000,
  });
  return csrfToken;
}

export function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('token', accessToken, {
    ...BASE_COOKIE,
    path: '/api',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    ...BASE_COOKIE,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearTokenCookies(res: Response) {
  res.clearCookie('token', { ...BASE_COOKIE, path: '/api' });
  res.clearCookie('refresh_token', { ...BASE_COOKIE, path: '/api/auth' });
  res.clearCookie('csrf_token', { ...BASE_COOKIE, httpOnly: false });
}
