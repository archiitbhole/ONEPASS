/* ONEPASS — dependency-free QR encoder (byte mode, versions 1..10).
   Returns a square boolean matrix; true = dark module. */
const SHIM = {};
(function (root) {
  'use strict';

  // --- EC level -> [formatBits, ecCodewordsPerBlock[v1..v10], blocks[v1..v10]] ---
  var ECC = {
    L: { fmt: 1, ec: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blk: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
    M: { fmt: 0, ec: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blk: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
    Q: { fmt: 3, ec: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24], blk: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8] },
    H: { fmt: 2, ec: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28], blk: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8] }
  };

  // --- GF(256) tables, primitive polynomial 0x11D ---
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenerator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= gmul(poly[i], EXP[d]);
        next[i + 1] ^= poly[i];
      }
      poly = next;
    }
    // built low-to-high; return high-to-low so poly[0] is the leading 1
    return poly.reverse();
  }

  function rsRemainder(data, degree) {
    var gen = rsGenerator(degree);
    var rem = new Array(degree).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift(); rem.push(0);
      for (var j = 0; j < degree; j++) rem[j] ^= gmul(gen[j + 1], factor);
    }
    return rem;
  }

  // --- alignment pattern centres ---
  function alignPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var out = [6];
    for (var pos = ver * 4 + 10; out.length < numAlign; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  // --- reserve function-pattern modules; returns {fn, size} ---
  function functionMap(ver) {
    var size = ver * 4 + 17;
    var fn = [];
    for (var i = 0; i < size; i++) fn.push(new Array(size).fill(false));
    function block(r, c, h, w) {
      for (var i = 0; i < h; i++) for (var j = 0; j < w; j++) {
        var rr = r + i, cc = c + j;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size) fn[rr][cc] = true;
      }
    }
    // finders + separators (8x8 corners)
    block(0, 0, 8, 8); block(0, size - 8, 8, 8); block(size - 8, 0, 8, 8);
    // timing
    for (var k = 0; k < size; k++) { fn[6][k] = true; fn[k][6] = true; }
    // alignment
    var ap = alignPositions(ver);
    for (var a = 0; a < ap.length; a++) for (var b = 0; b < ap.length; b++) {
      var skip = (a === 0 && b === 0) || (a === 0 && b === ap.length - 1) || (a === ap.length - 1 && b === 0);
      if (!skip) block(ap[a] - 2, ap[b] - 2, 5, 5);
    }
    // format info areas
    block(8, 0, 1, 9); block(0, 8, 9, 1);
    block(size - 8, 8, 8, 1); block(8, size - 8, 1, 8);
    // version info (v>=7)
    if (ver >= 7) { block(size - 11, 0, 3, 6); block(0, size - 11, 6, 3); }
    return { fn: fn, size: size };
  }

  function capacityCodewords(ver) {
    var m = functionMap(ver), free = 0;
    for (var r = 0; r < m.size; r++) for (var c = 0; c < m.size; c++) if (!m.fn[r][c]) free++;
    return Math.floor(free / 8);
  }

  function utf8Bytes(str) {
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function encode(text, level) {
    var ecc = ECC[level || 'M'];
    var bytes = utf8Bytes(text);

    // pick smallest version that fits
    var ver = 0, total = 0, dataCw = 0;
    for (var v = 1; v <= 10; v++) {
      var t = capacityCodewords(v);
      var d = t - ecc.blk[v - 1] * ecc.ec[v - 1];
      var lenBits = v < 10 ? 8 : 16;
      var need = Math.ceil((4 + lenBits + bytes.length * 8) / 8);
      if (need <= d) { ver = v; total = t; dataCw = d; break; }
    }
    if (!ver) throw new Error('QR payload too long for version 10');

    // --- bit stream ---
    var bits = [];
    function push(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    push(4, 4);                                   // byte mode
    push(bytes.length, ver < 10 ? 8 : 16);        // char count
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var cap = dataCw * 8;
    for (var t2 = 0; t2 < 4 && bits.length < cap; t2++) bits.push(0);   // terminator
    while (bits.length % 8 !== 0) bits.push(0);
    var pads = [0xec, 0x11], p = 0;
    while (bits.length < cap) { push(pads[p], 8); p ^= 1; }

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var q = 0; q < 8; q++) byte = (byte << 1) | bits[b + q];
      data.push(byte);
    }

    // --- split into blocks, RS-encode, interleave ---
    var numBlocks = ecc.blk[ver - 1], ecLen = ecc.ec[ver - 1];
    var shortLen = Math.floor(dataCw / numBlocks);
    var numLong = dataCw % numBlocks;            // blocks that get one extra data codeword
    var dataBlocks = [], ecBlocks = [], off = 0;
    for (var bi = 0; bi < numBlocks; bi++) {
      var len = shortLen + (bi >= numBlocks - numLong ? 1 : 0);
      var blk = data.slice(off, off + len); off += len;
      dataBlocks.push(blk);
      ecBlocks.push(rsRemainder(blk, ecLen));
    }
    var interleaved = [];
    var maxData = shortLen + (numLong > 0 ? 1 : 0);
    for (var c2 = 0; c2 < maxData; c2++)
      for (var bj = 0; bj < numBlocks; bj++)
        if (c2 < dataBlocks[bj].length) interleaved.push(dataBlocks[bj][c2]);
    for (var c3 = 0; c3 < ecLen; c3++)
      for (var bk = 0; bk < numBlocks; bk++) interleaved.push(ecBlocks[bk][c3]);

    // --- draw ---
    var map = functionMap(ver), size = map.size, fn = map.fn;
    var mod = [];
    for (var r0 = 0; r0 < size; r0++) mod.push(new Array(size).fill(false));

    // timing first — the finder patterns legitimately overwrite its ends
    for (var k2 = 0; k2 < size; k2++) { var on = (k2 % 2 === 0); mod[6][k2] = on; mod[k2][6] = on; }

    function finder(r, c) {
      for (var i = -1; i <= 7; i++) for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var d = Math.max(Math.abs(i - 3), Math.abs(j - 3));
        mod[rr][cc] = (d !== 2 && d !== 4);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    var ap2 = alignPositions(ver);
    for (var a2 = 0; a2 < ap2.length; a2++) for (var b2 = 0; b2 < ap2.length; b2++) {
      var skip = (a2 === 0 && b2 === 0) || (a2 === 0 && b2 === ap2.length - 1) || (a2 === ap2.length - 1 && b2 === 0);
      if (skip) continue;
      for (var i2 = -2; i2 <= 2; i2++) for (var j2 = -2; j2 <= 2; j2++)
        mod[ap2[a2] + i2][ap2[b2] + j2] = Math.max(Math.abs(i2), Math.abs(j2)) !== 1;
    }

    mod[size - 8][8] = true; // dark module

    if (ver >= 7) {
      var rem = ver;
      for (var vi = 0; vi < 12; vi++) rem = ((rem << 1) ^ ((rem >>> 11) * 0x1f25)) & 0x1fff;
      var vbits = (ver << 12) | rem;
      for (var vb = 0; vb < 18; vb++) {
        var bit = ((vbits >>> vb) & 1) === 1;
        var rr2 = Math.floor(vb / 3), cc2 = size - 11 + (vb % 3);
        mod[rr2][cc2] = bit; mod[cc2][rr2] = bit;
      }
    }

    // data placement, zigzag from bottom-right
    var idx = 0, bitPos = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var cx = right - jj;
          var upward = ((right + 1) & 2) === 0;
          var ry = upward ? size - 1 - vert : vert;
          if (fn[ry][cx]) continue;
          var val = false;
          if (idx < interleaved.length) val = ((interleaved[idx] >>> (7 - bitPos)) & 1) === 1;
          mod[ry][cx] = val;
          bitPos++; if (bitPos === 8) { bitPos = 0; idx++; }
        }
      }
    }

    function maskFn(m, i, j) {
      switch (m) {
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
        case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
        default: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
      }
    }

    function applyFormat(grid, mask) {
      var d = (ecc.fmt << 3) | mask, rem2 = d;
      for (var fi = 0; fi < 10; fi++) rem2 = ((rem2 << 1) ^ ((rem2 >>> 9) * 0x537)) & 0x3ff;
      var fbits = (((d << 10) | rem2) ^ 0x5412) & 0x7fff;
      function bitAt(n) { return ((fbits >>> n) & 1) === 1; }
      // first copy: down the left of the top-right finder, then left along row 8
      for (var i3 = 0; i3 <= 5; i3++) grid[i3][8] = bitAt(i3);
      grid[7][8] = bitAt(6); grid[8][8] = bitAt(7); grid[8][7] = bitAt(8);
      for (var i4 = 9; i4 < 15; i4++) grid[8][14 - i4] = bitAt(i4);
      // second copy: right along row 8, then up column 8 from the bottom
      for (var i5 = 0; i5 < 8; i5++) grid[8][size - 1 - i5] = bitAt(i5);
      for (var i6 = 8; i6 < 15; i6++) grid[size - 15 + i6][8] = bitAt(i6);
      grid[size - 8][8] = true;
    }

    function penalty(g) {
      var score = 0, i, j, run, last;
      // rule 1: runs of 5+
      for (i = 0; i < size; i++) {
        run = 1; last = g[i][0];
        for (j = 1; j < size; j++) {
          if (g[i][j] === last) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
          else { last = g[i][j]; run = 1; }
        }
        run = 1; last = g[0][i];
        for (j = 1; j < size; j++) {
          if (g[j][i] === last) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
          else { last = g[j][i]; run = 1; }
        }
      }
      // rule 2: 2x2 blocks
      for (i = 0; i < size - 1; i++) for (j = 0; j < size - 1; j++) {
        var c0 = g[i][j];
        if (c0 === g[i][j + 1] && c0 === g[i + 1][j] && c0 === g[i + 1][j + 1]) score += 3;
      }
      // rule 3: 11-module window matching 10111010000 or 00001011101
      var n3 = 0;
      for (i = 0; i < size; i++) {
        var wCol = 0, wRow = 0;
        for (j = 0; j < size; j++) {
          wCol = ((wCol << 1) & 0x7ff) | (g[i][j] ? 1 : 0);
          if (j >= 10 && (wCol === 0x5d0 || wCol === 0x05d)) n3++;
          wRow = ((wRow << 1) & 0x7ff) | (g[j][i] ? 1 : 0);
          if (j >= 10 && (wRow === 0x5d0 || wRow === 0x05d)) n3++;
        }
      }
      score += n3 * 40;
      // rule 4: deviation of dark-module ratio from 50%
      var dark = 0;
      for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (g[i][j]) dark++;
      score += Math.abs(Math.ceil((dark * 100 / (size * size)) / 5) - 10) * 10;
      return score;
    }

    var best = null, bestScore = Infinity;
    for (var m2 = 0; m2 < 8; m2++) {
      var g2 = mod.map(function (row) { return row.slice(); });
      for (var r3 = 0; r3 < size; r3++) for (var c4 = 0; c4 < size; c4++)
        if (!fn[r3][c4] && maskFn(m2, r3, c4)) g2[r3][c4] = !g2[r3][c4];
      applyFormat(g2, m2);
      var s2 = penalty(g2);
      if (s2 < bestScore) { bestScore = s2; best = g2; }
    }
    return best;
  }

  root.ONEPASS_QR = { encode: encode };
})(SHIM);

export const encode = SHIM.ONEPASS_QR.encode;
export default SHIM.ONEPASS_QR;
