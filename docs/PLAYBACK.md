# Playback

[Documentation](../README.md#documentation) · [Türkçe](PLAYBACK.tr.md)

CineDrive probes each video during a scan and stores its container, video codec, audio codec, dimensions, and duration. The player then creates a browser-specific playback plan.

## Video modes

| Mode     | Behaviour                                                                 |
| -------- | ------------------------------------------------------------------------- |
| `direct` | Streams the original file with HTTP Range support; nothing is re-encoded. |
| `audio`  | Copies the video and converts incompatible audio to AAC.                  |
| `hls`    | Generates HLS on demand; compatible tracks can be copied.                 |
| `full`   | Converts video and audio to H.264 and AAC for maximum compatibility.      |

Safari and Chromium can receive different plans for the same file. Quality can be left on automatic or selected explicitly. HLS concurrency and cache size are bounded, and least-recently-used streams are evicted when the quota is reached.

## HLS lifecycle and recovery

Leaving playback or replacing a seek window releases the previous FFmpeg work. A terminal recovery failure stops client transport; server-side idle cleanup, job limits, and cache limits bound abandoned sessions.

HLS recovery makes at most three application-level retries, delayed by 1, 2, and 4 seconds, with a 30-second deadline once recovery begins. A stall without playable buffered data is detected after 12 seconds. Recovery preserves the local stream position and the user's play/pause intent. The retry budget resets after 30 seconds of sustained playback, a source change, or an explicit manual retry.

When hls.js exposes HTTP 401/403 authorization failures, they are not retried automatically. Native browser media errors do not always expose an HTTP status. After recovery is exhausted, restore connectivity and select **Retry stream**. Direct video and music playback use separate recovery paths.

## Seeking

Direct streams use byte ranges. Compatibility streams can restart FFmpeg at the requested logical position. For HLS, seeking outside the current generated window creates a replacement window while keeping the absolute timeline visible to the user; the previous encoder is released promptly.

## Subtitles

CineDrive can:

- discover subtitles through OpenSubtitles;
- upload `.srt` or `.vtt` files;
- convert and cache supported text subtitles as WebVTT;
- adjust subtitle timing; and
- customise text size and background/shadow styling in the player.

Subtitle and media endpoints validate access through the signed-in user's libraries.

## Player controls

The video player includes keyboard shortcuts, fullscreen and cinema modes, Picture-in-Picture where the browser supports it, quality controls, resume playback, completed-state tracking, and automatic next-episode navigation.

## Music playback

Music playback has its own persistent queue and position, shuffle/repeat, gapless playback, configurable crossfade, ReplayGain loudness normalisation, and a five-band equaliser with presets. Sidecar `.lrc` files and LRCLIB results can be shown as synchronised or plain lyrics.

The authenticated client sync API supports ETag-aware library synchronisation, download manifests, track downloads, batched listening history, and playback-state synchronisation for mobile and offline clients.

## Browser coverage

Playwright exercises Chromium and WebKit. The suite verifies real playback advancement, seeking, resume after reload, HLS window replacement, interrupted-stream recovery, and FFmpeg cleanup. Playwright WebKit is useful Safari coverage, but it is not branded Safari or a physical iOS-device test.
