// The importer's throughput target (epic R6, NFR-006: 1,000 tales within 30
// minutes), run by `nx run api:import-scale`. It is not part of `api:test`.
//
// It serves the fake Storyly server's Scale shop (apps/fake-storyly,
// fixtures/scale-profile.json): 1,000 stories with images and videos of
// realistic sizes, API latency, media latency and bandwidth, and occasional
// 429 and 500 replies. Then it runs a real import into a `_test` database, as
// the worker does, and a second import of the same app (a re-run).
//
// Time scaling: every delay of the profile is multiplied by SCALE_FACTOR (0.1
// by default) and the bandwidth divided by it, so the run takes minutes rather
// than half an hour. Retry-After waits and the importer's backoff are not
// scaled. The measured time is the database and CPU work plus the scaled
// network time, so measured / SCALE_FACTOR is an upper bound of the time at
// the profile's real latency. The target fails when that bound passes 30
// minutes (scaled by SCALE_TALES / 1,000 when fewer tales are asked for).
//
// Environment: TEST_DATABASE_URL (must end in _test), SCALE_FACTOR, SCALE_TALES
// (a multiple of the profile's stories per instance), SCALE_FAILURES=0 (no
// 429/500 replies), SCALE_MEDIA_CONCURRENCY, SCALE_MEDIA_PER_HOST,
// SCALE_LIST_READ_AHEAD (the importer's concurrency; its defaults otherwise),
// SCALE_MAX_RSS_MB (peak memory allowed, 1024 by default).
//
// Disk: the copied media (about 1.2 GB for 1,000 tales) goes to a folder named
// taleart-scale-media-* in the OS temp folder. The target checks first that the
// disk there has twice that free, removes the folder when it ends (also on
// SIGINT or SIGTERM), and removes such folders older than a day that an
// earlier, killed run left. Where the temp folder is a tmpfs (memory), the
// media counts against memory: point TMPDIR at a disk folder then.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statfsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ImportJob } from '@taleart/contract';
import { createProject, createUser } from '@taleart/server-access';
import {
  claimNextJob,
  createImportJob,
  encryptToken,
  getImportJob,
  runImportJob,
  type ImportRunOptions,
} from '@taleart/server-importer';
import { LocalDiskStorage } from '@taleart/server-storage';
import { parse as parseConnectionString } from 'pg-connection-string';
import type { Pool } from 'pg';
import { createPool, migrate } from './db';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'] ?? 'postgres://taleart:taleart@localhost:5432/taleart_test';
const parsed = parseConnectionString(testDatabaseUrl);
if (!parsed.database?.endsWith('_test') || (parsed['db'] !== undefined && !String(parsed['db']).endsWith('_test'))) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
}

const TARGET_MS = 30 * 60_000;
const number = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(value) ? value : fallback;
};
const factor = number('SCALE_FACTOR', 0.1);
const tales = number('SCALE_TALES', 1000);
const failures = process.env['SCALE_FAILURES'] !== '0';
const maxRssMb = number('SCALE_MAX_RSS_MB', 1024);
const optional = (name: string): number | undefined =>
  process.env[name] === undefined ? undefined : number(name, Number.NaN);
const concurrency = {
  media: optional('SCALE_MEDIA_CONCURRENCY'),
  mediaPerHost: optional('SCALE_MEDIA_PER_HOST'),
  listReadAhead: optional('SCALE_LIST_READ_AHEAD'),
};
// The threshold of the measured run: the 30-minute target at the scaled latency, for the tales asked for.
const thresholdMs = TARGET_MS * factor * (tales / 1000);

const fakeStorylyModule = join(__dirname, '../../fake-storyly/src/fake-storyly.mjs');
const FAKE_STORYLY_TOKEN = 'fake-storyly-token';
interface ScaleStats {
  apiRequests: number;
  mediaRequests: number;
  injected: Record<string, number>;
  mediaBytes: number;
  maxMediaOpen: number;
}
interface FakeStoryly {
  url: string;
  port: number;
  control: {
    reset(): void;
    useScale(options: Record<string, unknown>): { appId: string; tales: number; mediaBytes: number };
    stats: ScaleStats;
    scale: { profile: { storiesPerGroup: number; groupsPerInstance: number } } | null;
  };
  close(): Promise<void>;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const MEDIA_DIR_PREFIX = 'taleart-scale-media-';
const DAY_MS = 24 * 60 * 60_000;
let mediaDir = '';

// Media folders an earlier run left (killed before it could clean up), older than a day.
function removeStaleMediaDirs(): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(MEDIA_DIR_PREFIX)) continue;
    const path = join(tmpdir(), name);
    try {
      if (Date.now() - statSync(path).mtimeMs > DAY_MS) rmSync(path, { recursive: true, force: true });
    } catch {
      // Gone meanwhile, or not ours to remove.
    }
  }
}

// Interrupted: the media goes, then the process ends as the signal asked.
function removeOnSignal(signal: NodeJS.Signals): void {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
  process.kill(process.pid, signal);
}

describe('import throughput (epic R6)', () => {
  let pool: Pool;
  let fake: FakeStoryly;
  let peakRss = 0;
  let sampler: ReturnType<typeof setInterval>;

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    await pool.query(
      'TRUNCATE import_records, import_media, import_links, import_jobs, site_keys, tale_group_tags, tags, tale_fonts, project_fonts, tale_media, project_media, tales, zone_tale_groups, tale_groups, frames, project_themes, zones, invitations, project_members, projects, auth_challenges, sessions, passkeys, users',
    );
    const { startFakeStoryly } = (await import(pathToFileURL(fakeStorylyModule).href)) as {
      startFakeStoryly(): Promise<FakeStoryly>;
    };
    fake = await startFakeStoryly();
    removeStaleMediaDirs();
    mediaDir = mkdtempSync(join(tmpdir(), MEDIA_DIR_PREFIX));
    process.once('SIGINT', removeOnSignal);
    process.once('SIGTERM', removeOnSignal);
    sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 100);
  });

  afterAll(async () => {
    clearInterval(sampler);
    await fake?.close();
    await pool?.end();
    if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
    process.off('SIGINT', removeOnSignal);
    process.off('SIGTERM', removeOnSignal);
  });

  it(
    `imports ${tales} tales with media within the scaled 30-minute target`,
    async () => {
      fake.control.reset();
      // The profile's shape (200 stories per instance), with as many instances as the tales asked for need.
      const instances = Math.max(1, Math.round(tales / 200));
      const { appId, tales: served, mediaBytes } = fake.control.useScale({ factor, failures, instances });
      expect(served).toBe(tales);
      // The copies need room: fail clearly before writing rather than filling the disk.
      const disk = statfsSync(mediaDir);
      const free = disk.bavail * disk.bsize;
      if (free < 2 * mediaBytes) {
        throw new Error(
          `The temp folder has ${Math.round(free / 1024 / 1024)} MB free; the scale run needs ` +
            `${Math.round((2 * mediaBytes) / 1024 / 1024)} MB (twice its media). Point TMPDIR elsewhere.`,
        );
      }

      const user = await createUser(pool, { name: 'Scale Admin', email: 'scale@example.com', role: 'admin' });
      const project = await createProject(pool, { name: 'Scale' });
      const tokenKey = randomBytes(32);
      const options: ImportRunOptions = {
        tokenKey,
        storylyApiUrl: fake.url,
        storage: new LocalDiskStorage(mediaDir),
        mediaPolicy: { allowedAddresses: [`127.0.0.1:${fake.port}`] },
        ...(Object.values(concurrency).some((v) => v !== undefined) ? { concurrency } : {}),
      };

      // Runs one import of the app to its end, as the worker does, and times it.
      const runOnce = async (): Promise<{ job: ImportJob; ms: number }> => {
        await createImportJob(pool, {
          projectId: project.id,
          createdBy: user.id,
          sourceAppId: appId,
          tokenCiphertext: encryptToken(FAKE_STORYLY_TOKEN, tokenKey),
        });
        const started = performance.now();
        const claimed = await claimNextJob(pool, 'scale-worker');
        if (!claimed) throw new Error('No job to claim');
        await runImportJob(pool, claimed, options);
        const ms = performance.now() - started;
        const job = await getImportJob(pool, project.id, claimed.id);
        if (!job) throw new Error('The job is gone');
        return { job, ms };
      };

      const first = await runOnce();
      const firstStats = { ...fake.control.stats, injected: { ...fake.control.stats.injected } };
      expect(first.job.error).toBeNull();
      expect(first.job.status).toBe('done');
      const report = first.job.report;
      expect(report?.tales).toEqual({ source: tales, imported: tales, skipped: 0 });
      expect(report?.media).toEqual({ source: tales, imported: tales, skipped: 0 });
      expect(report?.zones.imported).toBe(instances);
      // The report's elapsed time: set, and the measured time give or take the rounding and the claim.
      const elapsed = report?.elapsedSeconds;
      expect(elapsed).toEqual(expect.any(Number));
      expect(elapsed).toBeGreaterThanOrEqual(Math.floor(first.ms / 1000) - 1);
      expect(elapsed).toBeLessThanOrEqual(Math.ceil(first.ms / 1000) + 1);

      const counts = async () => {
        const { rows } = await pool.query<{ tales: string; groups: string; links: string; media: string }>(
          `SELECT (SELECT count(*) FROM tales) AS tales, (SELECT count(*) FROM tale_groups) AS groups,
             (SELECT count(*) FROM import_links) AS links, (SELECT count(*) FROM import_media) AS media`,
        );
        return rows[0];
      };
      const afterFirst = await counts();

      // A re-run: nothing created twice, no media downloaded again.
      const mediaBefore = fake.control.stats.mediaRequests;
      const second = await runOnce();
      expect(second.job.status).toBe('done');
      expect(await counts()).toEqual(afterFirst);
      expect(fake.control.stats.mediaRequests).toBe(mediaBefore);

      const bound = first.ms / factor;
      const result = {
        tales,
        factor,
        failures,
        concurrency,
        firstRun: seconds(first.ms),
        threshold: seconds(thresholdMs),
        extrapolatedUpperBound: `${(bound / 60_000).toFixed(1)} min (target 30 min)`,
        reportElapsedSeconds: elapsed,
        reRun: seconds(second.ms),
        apiRequests: firstStats.apiRequests,
        mediaRequests: firstStats.mediaRequests,
        injectedFailures: firstStats.injected,
        mediaMegabytes: Math.round(firstStats.mediaBytes / 1024 / 1024),
        maxMediaOpenAtOnce: firstStats.maxMediaOpen,
        peakRssMb: Math.round(peakRss / 1024 / 1024),
      };
      console.log(`IMPORT SCALE RESULT ${JSON.stringify(result, null, 2)}`);
      expect(first.ms).toBeLessThan(thresholdMs);
      expect(peakRss / 1024 / 1024).toBeLessThan(maxRssMb);
    },
    Math.max(thresholdMs * 3, 120_000),
  );
});
