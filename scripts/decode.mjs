import zlib from 'node:zlib';

/** 只处理 8bit、非隔行的 PNG（RGBA / RGB / 灰度），足够读本项目的产物与截图。 */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8;
  let w = 0;
  let h = 0;
  let colorType = 6;
  const idat = [];
  let bitDepth = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced png unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bit depth ' + bitDepth + ' unsupported');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('color type ' + colorType + ' unsupported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8ClampedArray(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) cur[i] = raw[p + i];
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch;
      const t = (y * w + x) * 4;
      out[t] = cur[s];
      out[t + 1] = ch >= 3 ? cur[s + 1] : cur[s];
      out[t + 2] = ch >= 3 ? cur[s + 2] : cur[s];
      out[t + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { w, h, d: out };
}
