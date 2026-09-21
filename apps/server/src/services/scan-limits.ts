/**
 * A scan must fail and remain recoverable before an unexpectedly large source
 * can exhaust the server by building an in-memory catalogue.
 */
export const MAX_SCAN_FILE_COUNT = 100_000;
export const SCAN_FILE_LIMIT_EXCEEDED = 'SCAN_FILE_LIMIT_EXCEEDED';
export const MAX_SCAN_FOLDER_COUNT = 100_000;
export const SCAN_FOLDER_LIMIT_EXCEEDED = 'SCAN_FOLDER_LIMIT_EXCEEDED';
