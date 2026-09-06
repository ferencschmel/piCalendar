import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@picalendar/shared';
import { config } from './config/index.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createApiRouter } from './routes/index.js';

export function createServer(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind nginx on the Pi, so client IPs arrive via X-Forwarded-For.
  app.set('trust proxy', 'loopback');

  app.use(
    helmet({
      // The SPA is served from this same origin; the default CSP would block
      // its own bundle, and there are no third-party assets to allow.
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
            },
          }
        : false,
    }),
  );
  app.use(cors({ origin: config.corsOrigins.length > 0 ? config.corsOrigins : false }));
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      // Health and agenda polling would otherwise dominate the log.
      autoLogging: {
        ignore: (req) => req.url?.startsWith(`${API_PREFIX}/health`) === true,
      },
    }),
  );

  app.use(API_PREFIX, createApiRouter());

  if (config.static.enabled && fs.existsSync(config.static.dir)) {
    app.use(
      express.static(config.static.dir, {
        // Vite fingerprints asset filenames, so they can be cached hard; the
        // entry HTML must not be, or the kiosk browser pins an old bundle.
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );

    // Client-side routing: anything that is not an API call renders the SPA.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.static.dir, 'index.html'));
    });
    logger.info({ dir: config.static.dir }, 'serving frontend build');
  } else if (config.static.enabled) {
    logger.warn({ dir: config.static.dir }, 'static dir missing; API-only mode');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
