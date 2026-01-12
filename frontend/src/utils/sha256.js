function rightRotate32(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function toUtf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }

  // 兼容极少数没有 TextEncoder 的环境：用 encodeURIComponent 转 UTF-8 字节
  const utf8 = unescape(encodeURIComponent(String(text)));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i += 1) {
    bytes[i] = utf8.charCodeAt(i);
  }
  return bytes;
}

function sha256HexFallback(text) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const H = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];

  const message = toUtf8Bytes(text);
  const l = message.length;
  const bitLen = l * 8;

  // padding: 0x80 + 0x00... + 64-bit length (big-endian)
  const withOne = l + 1;
  const padLen = (64 - ((withOne + 8) % 64)) % 64;
  const totalLen = withOne + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(message);
  padded[l] = 0x80;

  const bitLenHi = Math.floor(bitLen / 0x100000000);
  const bitLenLo = bitLen >>> 0;
  padded[totalLen - 8] = (bitLenHi >>> 24) & 0xff;
  padded[totalLen - 7] = (bitLenHi >>> 16) & 0xff;
  padded[totalLen - 6] = (bitLenHi >>> 8) & 0xff;
  padded[totalLen - 5] = bitLenHi & 0xff;
  padded[totalLen - 4] = (bitLenLo >>> 24) & 0xff;
  padded[totalLen - 3] = (bitLenLo >>> 16) & 0xff;
  padded[totalLen - 2] = (bitLenLo >>> 8) & 0xff;
  padded[totalLen - 1] = bitLenLo & 0xff;

  const w = new Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      const o = i + j * 4;
      w[j] = (
        (padded[o] << 24)
        | (padded[o + 1] << 16)
        | (padded[o + 2] << 8)
        | padded[o + 3]
      ) >>> 0;
    }

    for (let j = 16; j < 64; j += 1) {
      const s0 = rightRotate32(w[j - 15], 7) ^ rightRotate32(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate32(w[j - 2], 17) ^ rightRotate32(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let j = 0; j < 64; j += 1) {
      const S1 = rightRotate32(e, 6) ^ rightRotate32(e, 11) ^ rightRotate32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rightRotate32(a, 2) ^ rightRotate32(a, 13) ^ rightRotate32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return bytesToHex(out);
}

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const data = toUtf8Bytes(text);
    const digest = await subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(digest));
  }

  // 兼容：某些浏览器/非安全上下文没有 crypto.subtle（但我们仍希望能登录）
  return sha256HexFallback(text);
}

