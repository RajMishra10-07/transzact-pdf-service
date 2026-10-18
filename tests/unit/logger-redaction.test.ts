import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { sanitizeUrl, logger } from '../../src/utils/logger.js';

describe('Logger Redaction & URL Sanitization', () => {
  it('sanitizeUrl should redact sensitive query parameters', () => {
    expect(sanitizeUrl('/api/v1/auth/me?token=secret-jwt-token')).toBe(
      '/api/v1/auth/me?token=[REDACTED]'
    );
    expect(sanitizeUrl('/api/v1/documents/INV-001/verify?apiKey=secret-api-key&tenantId=tenant-1')).toBe(
      '/api/v1/documents/INV-001/verify?apiKey=[REDACTED]&tenantId=tenant-1'
    );
    expect(sanitizeUrl('/api/v1/documents/INV-001/verify?x-api-key=secret-key')).toBe(
      '/api/v1/documents/INV-001/verify?x-api-key=[REDACTED]'
    );
    expect(sanitizeUrl('/api/v1/documents/INV-001/verify?token=abc&signature=def&expires=123')).toBe(
      '/api/v1/documents/INV-001/verify?token=[REDACTED]&signature=[REDACTED]&expires=123'
    );
    expect(sanitizeUrl('/health')).toBe('/health');
  });

  it('Pino redaction rules should redact authorization header, x-api-key, and tokens across various payload shapes', () => {
    // Create a capturing stream for pino
    let output = '';
    const destination = {
      write: (msg: string) => {
        output += msg;
      },
    };

    const testLogger = pino(
      {
        redact: {
          paths: [
            // Authorization header
            'authorization',
            'headers.authorization',
            'req.headers.authorization',
            '*.authorization',
            '*["authorization"]',
            // x-api-key header and property
            '["x-api-key"]',
            'headers["x-api-key"]',
            'req.headers["x-api-key"]',
            '*["x-api-key"]',
            'apiKey',
            'headers.apiKey',
            'req.headers.apiKey',
            '*.apiKey',
            // Tokens
            'token',
            '*.token',
            'req.query.token',
            'query.token',
            'password',
            '*.password',
            'secret',
            '*.secret',
          ],
          censor: '[REDACTED]',
        },
      },
      destination
    );

    testLogger.info({
      authorization: 'Bearer raw-secret',
      'x-api-key': 'raw-api-key',
      token: 'raw-token',
      headers: {
        authorization: 'Bearer header-secret',
        'x-api-key': 'header-api-key',
      },
      req: {
        headers: {
          authorization: 'Bearer req-header-secret',
          'x-api-key': 'req-header-api-key',
        },
        query: {
          token: 'query-token',
        },
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.authorization).toBe('[REDACTED]');
    expect(parsed['x-api-key']).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.headers.authorization).toBe('[REDACTED]');
    expect(parsed.headers['x-api-key']).toBe('[REDACTED]');
    expect(parsed.req.headers.authorization).toBe('[REDACTED]');
    expect(parsed.req.headers['x-api-key']).toBe('[REDACTED]');
    expect(parsed.req.query.token).toBe('[REDACTED]');
  });

  it('requestLoggerMiddleware should redact token and apiKey query parameters when logging completed HTTP requests', async () => {
    const { vi } = await import('vitest');
    const { app } = await import('../../src/app.js');
    const request = (await import('supertest')).default;

    const infoSpy = vi.spyOn(logger, 'info');

    await request(app).get('/api/v1/auth/me?token=super-secret-jwt-token-value');

    const logCall = infoSpy.mock.calls.find((call) => call[1] === 'HTTP request completed');
    expect(logCall).toBeDefined();
    if (logCall) {
      const logData = logCall[0] as { path?: string };
      expect(logData.path).toBe('/api/v1/auth/me?token=[REDACTED]');
      expect(logData.path).not.toContain('super-secret-jwt-token-value');
    }

    infoSpy.mockRestore();
  });
});
