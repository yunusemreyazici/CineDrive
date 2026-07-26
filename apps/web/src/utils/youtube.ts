/**
 * Trailer URLs arrive from several metadata providers in different shapes —
 * full watch URLs, short youtu.be links, embed paths, or a bare video id.
 */
export function extractYoutubeId(url?: string | null): string | null {
  if (!url) return null;

  // Handle standard raw 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) {
    return url.trim();
  }

  // Handle standard URL formats
  const regExp = /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);

  return match && match[1] && match[1].length === 11 ? match[1] : null;
}
