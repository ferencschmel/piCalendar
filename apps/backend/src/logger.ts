import pino from 'pino';
import { config } from './config/index.js';

/**
 * Pretty output in development only — on the Pi this writes newline JSON to
 * stdout, which systemd/journald captures without extra formatting cost.
 */
export const logger = pino({
  level: config.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

export type Logger = typeof logger;
