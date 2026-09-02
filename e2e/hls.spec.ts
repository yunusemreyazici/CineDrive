import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { HlsCacheStats } from '../apps/server/src/services/hls-types.js';
import { tr } from '../apps/web/src/i18n/tr.js';
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_HLS_MOVIE_ID,
  E2E_HLS_FILE_ID,
  E2E_HLS_CLIP_NAME,
  E2E_HLS_SECONDS,
  e2eRuntimeRoot,
} from './env.js';

const hlsPath = `/api/media/${E2E_HLS_FILE_ID}/hls/`;
const registryPath = path.join(e2eRuntimeRoot, 'data/hls_cache/.active-processes.json');

const mediaState = (page: Page) =>
  page.locator('video').evaluate((video: HTMLVideoElement) => ({
    duration: String(video.duration),
    currentTime: video.currentTime,
    paused: video.paused,
    seeking: video.seeking,
    error: video.error?.code ?? null,
    seekable: Array.from({ length: video.seekable.length }, (_, i) => ({
      start: video.seekable.start(i),
      end: video.seekable.end(i),
    })),
    buffered: Array.from({ length: video.buffered.length }, (_, i) => ({
      start: video.buffered.start(i),
      end: video.buffered.end(i),
    })),
  }));

const hlsStats = async (page: Page): Promise<HlsCacheStats> => {
  const response = await page.request.get('/api/insights/media-health');
  expect(response.status()).toBe(200);
  return (await response.json()).runtime.hls;
};

const processExists = (pid: number) => {
  try {
    // Signal 0 only checks existence; the test never terminates the encoder.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
};

const activeJob = async (page: Page, startSeconds: number) => {
  await expect
    .poll(async () => (await hlsStats(page)).jobs.map((job) => job.startSeconds))
    .toEqual([startSeconds]);
  const [job] = (await hlsStats(page)).jobs;
  if (!job?.pid) throw new Error('Expected a live FFmpeg PID, not just a scheduled HLS job');
  expect(job.mediaName).toBe(E2E_HLS_CLIP_NAME);
  expect(job.viewerCount).toBe(1);
  expect(processExists(job.pid)).toBe(true);
  expect(JSON.parse(fs.readFileSync(registryPath, 'utf8'))).toEqual([
    expect.objectContaining({ jobId: job.id, pid: job.pid, cacheKey: job.cacheKey }),
  ]);
  return { ...job, pid: job.pid };
};

const expectAdvancingVideo = async (page: Page) => {
  const video = page.locator('video');
  const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(before + 1);
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        seeking: element.seeking,
        error: element.error?.code ?? null,
      })),
    )
    .toEqual({ paused: false, seeking: false, error: null });
};

const waitForPlaylist = (page: Page, start: number) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `${hlsPath}index.m3u8` &&
      Number(url.searchParams.get('start')) === start &&
      response.status() === 200
    );
  });

const openHlsMovie = async (page: Page) => {
  await page.goto('/login');
  await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
  await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: tr.auth.signIn }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.delete(`/api/playback/${E2E_HLS_MOVIE_ID}`)).status()).toBe(200);
  const playlist = waitForPlaylist(page, 0);
  await page.goto(`/watch/${E2E_HLS_MOVIE_ID}`);
  const response = await playlist;
  expect(response.headers()['content-type']).toContain('application/vnd.apple.mpegurl');
  const manifest = await response.text();
  expect(manifest).toContain('#EXTM3U');
  expect(manifest).toContain('#EXT-X-MAP:URI="init.mp4?start=0"');
  expect(manifest).toMatch(/segment-\d{6}\.m4s\?start=0/);
  // This fixture must still be encoding: cleanup must not pass just because a
  // tiny source naturally finished before the user left the player.
  expect(manifest).not.toContain('#EXT-X-ENDLIST');

  const video = page.locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  if (await video.evaluate((element: HTMLVideoElement) => element.paused)) await video.click();
  await expectAdvancingVideo(page);
  return new URL(response.url());
};

const expectNoEncoders = async (page: Page, pids: number[]) => {
  // Shorter than the server's 45s idle reaper: only prompt lifecycle cleanup
  // should satisfy this check, not an eventual timeout or a completed fixture.
  await expect
    .poll(
      async () => {
        const stats = await hlsStats(page);
        return { active: stats.activeJobs, queued: stats.queuedJobs };
      },
      { timeout: 10_000 },
    )
    .toEqual({ active: 0, queued: 0 });
  await expect.poll(() => pids.filter(processExists), { timeout: 10_000 }).toEqual([]);
  await expect
    .poll(() => JSON.parse(fs.readFileSync(registryPath, 'utf8')), { timeout: 10_000 })
    .toEqual([]);
};

test.describe('CineDrive HLS', () => {
  // Real encoders need a first segment at each of three source windows. Keep
  // per-assertion bounds tight while allowing a slower CI host the full flow.
  test.setTimeout(60_000);

  test.afterEach(async ({ page }, testInfo) => {
    // Exercise normal pagehide cleanup even after a failed assertion, so the
    // next test/project cannot inherit this player's encoder or leases.
    const stats = await hlsStats(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      // Preserve diagnostics before navigation removes the failed player.
      await testInfo.attach('hls-state', {
        body: JSON.stringify(
          {
            stats,
            media: (await page.locator('video').count()) ? await mediaState(page) : null,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    }
    const pids = stats.jobs.flatMap((job) => (job.pid ? [job.pid] : []));
    await page.goto('/');
    await expectNoEncoders(page, pids);
  });

  test('plays real HLS manifests and media segments through the browser', async ({ page }) => {
    const assets: string[] = [];
    const directRequests: string[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith(hlsPath) && response.ok()) assets.push(url.pathname);
    });
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `/api/media/${E2E_HLS_FILE_ID}/stream`) {
        directRequests.push(request.url());
      }
    });
    await openHlsMovie(page);
    await expect.poll(() => assets.includes(`${hlsPath}init.mp4`)).toBe(true);
    await expect.poll(() => assets.some((asset) => /segment-\d{6}\.m4s$/.test(asset))).toBe(true);
    expect(directRequests).toEqual([]);
    expect((await activeJob(page, 0)).profile).toBe('video-copy-aac');
  });

  test('seeks outside the HLS window forward and backward and releases old encoders', async ({
    page,
  }) => {
    await openHlsMovie(page);
    let oldJob = await activeJob(page, 0);
    for (const target of [120, 15]) {
      const localTarget = target - oldJob.startSeconds;
      // Native HLS updates seekable ranges asynchronously. Wait for this test's
      // precondition instead of assuming advancing time means ranges are ready.
      // The actual seek below must still create a new server-side window.
      await expect
        .poll(
          async () => {
            const state = await mediaState(page);
            return {
              ...state,
              targetOutsideWindow: !state.seekable.some(
                (range) => localTarget >= range.start && localTarget <= range.end,
              ),
            };
          },
          { timeout: 10_000 },
        )
        .toMatchObject({ targetOutsideWindow: true });

      const playlist = waitForPlaylist(page, target);
      await page.locator('video').hover();
      const timeline = page.getByRole('slider', { name: tr.player.seekLabel });
      await expect(timeline).toHaveAttribute('aria-valuemax', String(E2E_HLS_SECONDS));
      const box = await timeline.boundingBox();
      expect(box).not.toBeNull();
      // Aim inside the second, avoiding floating point rounding just below it.
      await timeline.click({
        position: { x: (box!.width * (target + 0.5)) / E2E_HLS_SECONDS, y: box!.height / 2 },
      });
      await playlist;
      const nextJob = await activeJob(page, target);
      expect(nextJob.id).not.toBe(oldJob.id);
      expect(nextJob.profile).toBe('h264-aac');
      await expect.poll(() => processExists(oldJob.pid)).toBe(false);
      await expectAdvancingVideo(page);
      // HLS restarts the media element at local 0; the user sees absolute time.
      // Both must agree, so an optimistic slider update alone cannot pass.
      const localTime = await page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.currentTime);
      expect(localTime).toBeGreaterThan(0);
      expect(localTime).toBeLessThan(10);
      const absoluteTime = Number(await timeline.getAttribute('aria-valuenow'));
      expect(Math.abs(absoluteTime - (target + localTime))).toBeLessThanOrEqual(2);
      oldJob = nextJob;
    }
  });

  test('stops a live FFmpeg process when the user leaves the HLS player', async ({ page }) => {
    const playlistUrl = await openHlsMovie(page);
    const job = await activeJob(page, 0);
    const release = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `${hlsPath}release` &&
        url.searchParams.get('session') === playlistUrl.searchParams.get('session') &&
        url.searchParams.get('start') === '0' &&
        response.request().method() === 'POST'
      );
    });
    await page.locator('video').hover();
    await page.getByRole('button', { name: tr.player.goBack }).click();
    await expect(page).toHaveURL(new RegExp(`/media/${E2E_HLS_MOVIE_ID}$`));
    await expect(page.locator('video')).toHaveCount(0);
    const response = await release;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ stopped: true });
    await expectNoEncoders(page, [job.pid]);
  });
});
