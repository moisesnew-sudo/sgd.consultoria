import { Response } from 'express';
import crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

export function setCsrfCookie(res: Response) {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
  return csrfToken;
}

export function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearTokenCookies(res: Response) {
  res.clearCookie('token', { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax', path: '/api' });
  res.clearCookie('refresh_token', { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax', path: '/api/auth' });
  res.clearCookie('csrf_token', { httpOnly: false, secure: isProduction, sameSite: isProduction ? 'none' : 'lax', path: '/' });
}
