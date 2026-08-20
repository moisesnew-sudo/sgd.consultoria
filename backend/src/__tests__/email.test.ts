import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendPasswordResetEmail, isEmailConfigured, resetEmailConfig } from '../lib/email.js';

describe('Email Service', () => {
  beforeEach(() => {
    resetEmailConfig();
    vi.stubEnv('EMAIL_ENABLED', 'true');
    vi.stubEnv('SMTP_HOST', 'smtp.test.com');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', 'test@test.com');
    vi.stubEnv('SMTP_PASS', 'testpass');
    vi.stubEnv('SMTP_FROM', 'Test <test@test.com>');
  });

  afterEach(() => {
    resetEmailConfig();
    vi.unstubAllEnvs();
  });

  it('should return configured=true when all env vars present', () => {
    expect(isEmailConfigured()).toBe(true);
  });

  it('should return configured=false when EMAIL_ENABLED=false', () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    expect(isEmailConfigured()).toBe(false);
  });

  it('should return configured=false when SMTP_HOST missing', () => {
    vi.stubEnv('SMTP_HOST', '');
    expect(isEmailConfigured()).toBe(false);
  });

  it('should return configured=false when SMTP_USER missing', () => {
    vi.stubEnv('SMTP_USER', '');
    expect(isEmailConfigured()).toBe(false);
  });

  it('should return configured=false when SMTP_PASS missing', () => {
    vi.stubEnv('SMTP_PASS', '');
    expect(isEmailConfigured()).toBe(false);
  });

  it('sendPasswordResetEmail should return disabled when EMAIL_ENABLED=false', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    const result = await sendPasswordResetEmail({
      email: 'test@test.com',
      token: 'testtoken123',
      frontendUrl: 'https://test.com',
      expiresMinutes: 30,
    });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('disabled');
  });

  it('sendPasswordResetEmail should return error when not configured', async () => {
    vi.stubEnv('SMTP_HOST', '');
    const result = await sendPasswordResetEmail({
      email: 'test@test.com',
      token: 'testtoken123',
      frontendUrl: 'https://test.com',
      expiresMinutes: 30,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });
});