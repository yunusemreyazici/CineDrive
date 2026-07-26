// Browsers commonly request `bytes=N-`. Forwarding that request unchanged makes
// Google Drive send the entire remainder of a multi-GB file until the browser
// eventually closes the connection. A bounded window keeps prefetch/probing
// traffic predictable while retaining normal HTML5 seek support.
export const MAX_STREAM_CHUNK_BYTES = 8 * 1024 * 1024;

export type RangeResolution =
  /** No Range header was sent. */
  | { kind: 'none' }
  /** Multi-range (comma separated) requests are not supported. */
  | { kind: 'multi' }
  /** Syntactically invalid Range header. */
  | { kind: 'invalid' }
  /** Syntactically valid but not satisfiable for this resource size. */
  | { kind: 'unsatisfiable'; size: number }
  /** A suffix range that can only be resolved by the upstream (size unknown). */
  | { kind: 'passthrough'; header: string }
  /** A fully resolved, bounded byte range. */
  | { kind: 'range'; start: number; end: number; header: string };

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/**
 * Resolves a client Range header into an absolute, bounded byte window.
 *
 * `fileSize` may be null when the resource length is not known ahead of time.
 * In that case a suffix range (`bytes=-500`) is passed through to the upstream
 * verbatim rather than being silently reinterpreted as `bytes=0-500`.
 */
export const resolveRangeRequest = (
  rangeHeader: string | undefined,
  fileSize: number | null,
): RangeResolution => {
  if (!rangeHeader) return { kind: 'none' };
  if (rangeHeader.includes(',')) return { kind: 'multi' };

  const match = RANGE_PATTERN.exec(rangeHeader.trim());
  if (!match) return { kind: 'invalid' };

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  // `bytes=-` names neither a position nor a suffix length.
  if (!startText && !endText) return { kind: 'invalid' };

  const hasSize = fileSize !== null && Number.isSafeInteger(fileSize) && fileSize > 0;

  // Suffix range: the final N bytes of the resource.
  if (!startText) {
    const suffixLength = Number.parseInt(endText, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'invalid' };
    if (!hasSize) return { kind: 'passthrough', header: `bytes=-${suffixLength}` };

    const start = Math.max(0, fileSize - suffixLength);
    return {
      kind: 'range',
      start,
      end: fileSize - 1,
      header: `bytes=${start}-${fileSize - 1}`,
    };
  }

  const start = Number.parseInt(startText, 10);
  if (!Number.isSafeInteger(start)) return { kind: 'invalid' };
  if (hasSize && start >= fileSize) return { kind: 'unsatisfiable', size: fileSize };

  let end: number;
  if (endText) {
    end = Number.parseInt(endText, 10);
    if (!Number.isSafeInteger(end)) return { kind: 'invalid' };
    if (end < start) return { kind: 'unsatisfiable', size: hasSize ? fileSize : 0 };
  } else {
    end = start + MAX_STREAM_CHUNK_BYTES - 1;
  }

  // A 206 response may legally be narrower than the requested window, which is
  // what keeps `bytes=0-<huge>` from turning into a full-file download.
  end = Math.min(end, start + MAX_STREAM_CHUNK_BYTES - 1);
  if (hasSize) end = Math.min(end, fileSize - 1);

  return { kind: 'range', start, end, header: `bytes=${start}-${end}` };
};
