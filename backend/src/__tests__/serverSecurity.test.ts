import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long!!';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/sgd_test';
  process.env.FRONTEND_URL = 'https://app.example.com';
  process.env.CORS_ORIGIN = 'https://app.example.com';

  const serverModule = await import('../server.js');
  app = serverModule.default;
});

describe('server security hardening', () => {
  it('applies security headers to health checks', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://app.example.com')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('allows the frontend origin and its www variant only', async () => {
    const allowed = await request(app)
      .get('/api/health')
      .set('Origin', 'https://www.app.example.com');
    const rejected = await request(app)
      .get('/api/health')
      .set('Origin', 'https://attacker.example.com');

    expect(allowed.headers['access-control-allow-origin']).toBe('https://www.app.example.com');
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('bypasses auth namespace rate limiting in the test environment', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app).get('/api/auth/unknown').set('X-Forwarded-For', '198.51.100.10')
      )
    );

    expect(responses.every((response) => response.status !== 429)).toBe(true);
  });

  it('rejects password reset bodies larger than 100kb', async () => {
    const response = await request(app)
      .post('/api/password-reset/request')
      .send({ email: 'invalid-email', padding: 'x'.repeat(110 * 1024) });

    expect(response.status).toBe(413);
  });
});
