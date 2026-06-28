// Pull embedded cover art out of an MP3's ID3v2 tag (APIC frame). Returns an image Blob or null.
// Handles ID3v2.2 (PIC), v2.3 and v2.4 (APIC); non-ID3 files (wav/flac/m4a) just return null.
export async function readAlbumArt(file: Blob): Promise<Blob | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null; // "ID3"
    const ver = head[3];                                                       // 2 | 3 | 4
    const synch = (a: number, b: number, c: number, d: number) => (a << 21) | (b << 14) | (c << 7) | d;
    const tagSize = synch(head[6], head[7], head[8], head[9]);                 // header size is always synchsafe
    const buf = new Uint8Array(await file.slice(0, 10 + tagSize).arrayBuffer());
    const end = Math.min(10 + tagSize, buf.length);
    const latin = (s: number, e: number) => { let o = ''; for (let i = s; i < e; i++) o += String.fromCharCode(buf[i]); return o; };

    let pos = 10;
    if (head[5] & 0x40) {                                                      // skip an extended header if present
      const e = pos;
      const extSize = ver === 4 ? synch(buf[e], buf[e + 1], buf[e + 2], buf[e + 3]) : (((buf[e] << 24) | (buf[e + 1] << 16) | (buf[e + 2] << 8) | buf[e + 3]) >>> 0);
      pos += ver === 4 ? extSize : extSize + 4;
    }

    while (pos + (ver === 2 ? 6 : 10) <= end) {
      let id: string, size: number, fhdr: number;
      if (ver === 2) {                                                         // v2.2: 3-char id, 3-byte size
        id = latin(pos, pos + 3); size = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5]; fhdr = 6;
      } else {                                                                 // v2.3 plain 32-bit, v2.4 synchsafe
        id = latin(pos, pos + 4);
        const s = pos + 4;
        size = ver === 4 ? synch(buf[s], buf[s + 1], buf[s + 2], buf[s + 3]) : (((buf[s] << 24) | (buf[s + 1] << 16) | (buf[s + 2] << 8) | buf[s + 3]) >>> 0);
        fhdr = 10;
      }
      if (size <= 0 || !/^[A-Z0-9]/.test(id)) break;                           // end of frames / padding
      const dataStart = pos + fhdr;

      if (id === 'APIC' || id === 'PIC') {
        let p = dataStart;
        const enc = buf[p++];                                                  // text-encoding byte
        let mime: string;
        if (id === 'PIC') { mime = latin(p, p + 3).toLowerCase(); p += 3; }    // v2.2 uses a 3-char format code
        else { const m = p; while (p < end && buf[p] !== 0) p++; mime = latin(m, p).toLowerCase(); p++; }
        p++;                                                                   // picture-type byte
        if (enc === 1 || enc === 2) { while (p + 1 < end && !(buf[p] === 0 && buf[p + 1] === 0)) p += 2; p += 2; } // UTF-16 desc -> double null
        else { while (p < end && buf[p] !== 0) p++; p++; }                     // latin/utf8 desc -> single null
        const imgEnd = dataStart + size;
        if (imgEnd > p && imgEnd <= buf.length) {
          const type = mime.includes('png') ? 'image/png' : 'image/jpeg';
          return new Blob([buf.slice(p, imgEnd)], { type });
        }
        return null;
      }
      pos = dataStart + size;
    }
    return null;
  } catch { return null; }
}
