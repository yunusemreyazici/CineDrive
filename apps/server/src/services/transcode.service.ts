import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'node:stream';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export class TranscodeService {
  /**
   * Creates a live audio-transcoded stream with instant startup.
   * -probesize 65536 & -analyzeduration 0 prevent FFmpeg from downloading hundreds of MBs just to probe headers.
   * Video track is copied as-is (-c:v copy) for 0% CPU video overhead.
   * Incompatible surround audio (AC3/EAC3/DTS) is converted to stereo AAC (-c:a aac -ac 2).
   */
  public createTranscodedStream(inputStream: Readable, onAbort?: (killFn: () => void) => void): { stream: Readable; kill: () => void } {
    const outputStream = new PassThrough();

    const command = ffmpeg(inputStream)
      .inputOptions([
        '-probesize', '65536',
        '-analyzeduration', '0',
      ])
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        '-ac 2',
        '-f mp4',
        '-movflags frag_keyframe+empty_moov+default_base_moof',
      ])
      .on('error', (err: Error) => {
        if (!err.message.includes('Output stream closed') && !err.message.includes('Output pipe closed') && !err.message.includes('SIGKILL')) {
          console.error('[TranscodeService] FFmpeg streaming error:', err.message);
        }
        outputStream.destroy(err);
      });

    const kill = () => {
      try {
        command.kill('SIGKILL');
      } catch {
        // ignore kill errors
      }
    };

    if (onAbort) {
      onAbort(kill);
    }

    command.pipe(outputStream, { end: true });

    return { stream: outputStream, kill };
  }
}
