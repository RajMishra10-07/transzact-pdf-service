import pino from 'pino';
import { env } from '../config/env.js';

export function sanitizeUrl(urlStr: string): string {
  if (!urlStr || typeof urlStr !== 'string') return urlStr;
  return urlStr.replace(
    /([?&][^=]*(?:token|apikey|api-key|x-api-key|secret|password|signature)[^=]*=)[^&#]*/gi,
    '$1[REDACTED]'
  );
}

export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    log(object: Record<string, unknown>) {
      if (typeof object.path === 'string') {
        object.path = sanitizeUrl(object.path);
      }
      if (typeof object.url === 'string') {
        object.url = sanitizeUrl(object.url);
      }
      return object;
    },
  },
  redact: {
    paths: [
      // Authorization headers & direct fields
      'authorization',
      'headers.authorization',
      'req.headers.authorization',
      '*.authorization',
      '*["authorization"]',
      // API keys
      '["x-api-key"]',
      'headers["x-api-key"]',
      'req.headers["x-api-key"]',
      '*["x-api-key"]',
      'apiKey',
      'headers.apiKey',
      'req.headers.apiKey',
      '*.apiKey',
      'api_key',
      '*.api_key',
      // Passwords & secrets
      'password',
      '*.password',
      'secret',
      '*.secret',
      // Tokens (JWT, bearer, verification, query tokens)
      'token',
      '*.token',
      'req.query.token',
      'query.token',
      'req.query.apiKey',
      'query.apiKey',
      'req.query["x-api-key"]',
      'query["x-api-key"]',
      'req.query.signature',
      'query.signature',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      // Domain sensitive fields
      'invoiceData.bankDetails.accountNumber',
      'bankDetails.accountNumber',
      '*.accountNumber',
      'customerGstin',
      '*.customerGstin',
    ],
    remove: false,
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export const createChildLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};
