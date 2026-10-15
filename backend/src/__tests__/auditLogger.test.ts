import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLogger } from '../middleware/auditLogger.js';

function createRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/demands',
    url: '/api/demands',
    ip: '192.0.2.10',
    headers: {},
    params: {},
    body: {},
    ...overrides,
  } as Request;
}

function createResponse(statusCode = 200): EventEmitter & { statusCode: number } {
  const response = new EventEmitter() as EventEmitter & { statusCode: number };
  response.statusCode = statusCode;
  return response;
}

describe('auditLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs mutable requests after the response finishes with recursive masking', () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = createRequest({
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' },
      params: { id: '123' },
      body: {
        email: 'user@domain.com',
        note: 'secret',
        nested: [{ phone: '11987654321' }],
      },
      user: { id: 42 } as Request['user'],
    });
    const res = createResponse(201);

    auditLogger(req, res as unknown as Response, vi.fn());
    res.emit('finish');

    expect(output).toHaveBeenCalledTimes(1);
    const rawLine = output.mock.calls[0][0];
    const line = typeof rawLine === 'string' ? rawLine : Buffer.from(rawLine).toString('utf8');
    expect(line).toMatch(/\n$/);

    const record = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      userId: 42,
      action: 'POST /api/demands',
      ip: '203.0.113.10',
      statusCode: 201,
      payloadMasked: {
        params: { id: '1*3' },
        body: {
          email: 'u***r@domain.com',
          note: 's****t',
          nested: [{ phone: '1*********1' }],
        },
      },
    });
    expect(record.timestamp).toEqual(expect.any(String));
    expect(new Date(record.timestamp as string).toISOString()).toBe(record.timestamp);
  });

  it('uses anonymous and req.ip when authentication and forwarded IP are absent', () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = createRequest({ method: 'DELETE', originalUrl: '/api/demands/1' });
    const res = createResponse(403);

    auditLogger(req, res as unknown as Response, vi.fn());
    res.emit('finish');

    const rawLine = output.mock.calls[0][0];
    const line = typeof rawLine === 'string' ? rawLine : Buffer.from(rawLine).toString('utf8');
    const record = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      userId: 'anonymous',
      action: 'DELETE /api/demands/1',
      ip: '192.0.2.10',
      statusCode: 403,
    });
  });

  it('does not register response logging for safe methods', () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = createRequest({ method: 'GET' });
    const res = createResponse(200);

    auditLogger(req, res as unknown as Response, vi.fn());
    res.emit('finish');

    expect(output).not.toHaveBeenCalled();
  });
});
