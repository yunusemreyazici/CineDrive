const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16_LE_BOM = [0xff, 0xfe] as const;
const UTF16_BE_BOM = [0xfe, 0xff] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function decodeUtf16Be(bytes: Uint8Array): string {
  const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let index = 0; index < swapped.length; index += 2) {
    swapped[index] = bytes[index + 1]!;
    swapped[index + 1] = bytes[index]!;
  }
  return new TextDecoder('utf-16le').decode(swapped);
}

/**
 * Subtitle archives frequently contain legacy Turkish SRT files encoded as
 * Windows-1254. Decode from the original bytes so invalid UTF-8 is not replaced
 * with irreversible U+FFFD characters before conversion to WebVTT.
 */
export function decodeSubtitleBytes(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (startsWith(bytes, UTF8_BOM)) {
    return new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length));
  }
  if (startsWith(bytes, UTF16_LE_BOM)) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(UTF16_LE_BOM.length));
  }
  if (startsWith(bytes, UTF16_BE_BOM)) {
    return decodeUtf16Be(bytes.subarray(UTF16_BE_BOM.length));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1254').decode(bytes);
  }
}
