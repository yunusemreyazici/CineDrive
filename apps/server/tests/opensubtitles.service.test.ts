import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenSubtitlesService } from '../src/services/opensubtitles.service';

describe('OpenSubtitlesService', () => {
  const service = new OpenSubtitlesService();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes search parameters and returns every unique file ordered by downloads', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'subtitle-low',
              attributes: {
                language: 'tr',
                release: 'Release A',
                download_count: 10,
                files: [
                  { file_id: 101, file_name: 'a.srt' },
                  { file_id: 102, file_name: 'a-forced.srt' },
                ],
              },
            },
            {
              id: 'subtitle-high',
              attributes: {
                language: 'en',
                release: 'Release B',
                download_count: 50,
                files: [{ file_id: 201, file_name: 'b.srt' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await service.searchSubtitles(
      'Taboo.2017',
      1,
      2,
      [' TR ', 'en', 'invalid-language'],
      'test-key',
    );

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get('query')).toBe('Taboo');
    expect(requestedUrl.searchParams.get('languages')).toBe('tr,en');
    expect(requestedUrl.searchParams.get('season_number')).toBe('1');
    expect(requestedUrl.searchParams.get('episode_number')).toBe('2');
    expect(result.results.map((item) => item.fileId)).toEqual([201, 101, 102]);
  });

  it('rejects an invalid file id before calling OpenSubtitles', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(
      service.downloadAndConvertSubtitle('not-a-number', 'test-key'),
    ).rejects.toThrow('INVALID_SUBTITLE_FILE_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads by fileId and converts SRT content to WebVTT', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ link: 'https://download.example/subtitle.srt' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('1\n00:00:01,000 --> 00:00:02,000\nMerhaba', {
          status: 200,
        }),
      );

    const result = await service.downloadAndConvertSubtitle(123, 'test-key');

    const downloadRequest = fetchMock.mock.calls[0];
    expect(JSON.parse(String(downloadRequest?.[1]?.body))).toEqual({ file_id: 123 });
    expect(result).toContain('WEBVTT');
    expect(result).toContain('00:00:01.000 --> 00:00:02.000');
  });

  it('rejects oversized subtitle downloads', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ link: 'https://download.example/huge.srt' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response('oversized', {
          status: 200,
          headers: { 'Content-Length': String(6 * 1024 * 1024) },
        }),
      );

    await expect(
      service.downloadAndConvertSubtitle(123, 'test-key'),
    ).rejects.toThrow('SUBTITLE_FILE_TOO_LARGE');
  });
});
