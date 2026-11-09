/** Structural guard only; it does not claim entropy/pixel decoding. */
export function screenJpegDimensions(data: Uint8Array): { readonly width: number; readonly height: number } {
  if (data.length < 4 || data.length > 262144 || data[0] !== 255 || data[1] !== 216) throw new TypeError('Invalid screen image');
  let offset = 2, scanned = false;
  let dimensions: { width: number; height: number } | null = null;
  while (offset < data.length) {
    if (data[offset] !== 255) throw new TypeError('Invalid marker');
    while (offset < data.length && data[offset] === 255) offset++;
    if (offset >= data.length) throw new TypeError('Invalid marker');
    const marker = data[offset++]!;
    if (marker === 217) {
      if (offset !== data.length || !scanned || !dimensions) throw new TypeError('Invalid image ending');
      return dimensions;
    }
    if (![192, 196, 219, 221, 224, 218].includes(marker) || offset + 2 > data.length) throw new TypeError('Unsupported marker');
    const size = data[offset]! * 256 + data[offset + 1]!, end = offset + size;
    if (size < 2 || end > data.length) throw new TypeError('Invalid segment');
    const p = data.subarray(offset + 2, end); offset = end;
    if (marker === 224 && (p.length !== 14 || p[0] !== 74 || p[1] !== 70 || p[2] !== 73 || p[3] !== 70 || p[4] !== 0 || p[5] !== 1 || p[6]! > 2 || p[7]! > 2 || p[12] !== 0 || p[13] !== 0)) throw new TypeError('Unsupported metadata');
    if (marker === 192) {
      if (dimensions || p.length < 6 || p[0] !== 8 || ![1, 3].includes(p[5]!) || p.length !== 6 + 3 * p[5]!) throw new TypeError('Invalid dimensions');
      const height = p[1]! * 256 + p[2]!, width = p[3]! * 256 + p[4]!;
      if (width < 32 || width > 1024 || height < 32 || height > 1024) throw new TypeError('Invalid dimensions');
      dimensions = { width, height };
    }
    if (marker === 218) {
      if (!dimensions || scanned) throw new TypeError('Unsupported scan');
      scanned = true;
      while (offset < data.length) {
        if (data[offset] !== 255) { offset++; continue; }
        let next = offset + 1;
        while (next < data.length && data[next] === 255) next++;
        if (next >= data.length) throw new TypeError('Invalid scan');
        if (data[next] === 0 || (data[next]! >= 208 && data[next]! <= 215)) { offset = next + 1; continue; }
        break;
      }
    }
  }
  throw new TypeError('Missing image ending');
}
