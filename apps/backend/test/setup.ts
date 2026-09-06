// Runs before the config module is imported by any test, so the singleton picks
// up a throwaway database and never starts the background poller.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picalendar-test-'));

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(dir, 'test.sqlite');
process.env.DISPLAY_TIMEZONE = 'Europe/Budapest';
process.env.SYNC_ENABLED = 'false';
process.env.SERVE_STATIC = 'false';
process.env.LOG_LEVEL = 'fatal';
