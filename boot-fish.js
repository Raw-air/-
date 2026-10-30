// RAWAIR 開機畫面背景：ASCII 3D 錦鯉 (近的一條繞 8 字、遠處一條反方向游)
// 同 donut.c：取樣魚的曲面 → 透視投影 → z-buffer → 亮度換字元，從字元圖集貼到 canvas
// RawairFish.start(canvas, { reduced, text }) → { stop() }；reduced 只畫一張；text = #rb-term，字底下的魚壓暗
// 整片背景鋪滿暗暗的 ASCII 水紋 (水面折射的光網 + 斜斜的光束)，魚在水紋裡面游
(function () {
  var M = Math, sin = M.sin, cos = M.cos, sqrt = M.sqrt, max = M.max, min = M.min, ceil = M.ceil, round = M.round, rnd = M.random, PI = M.PI;
  var RAMP = '.,-~:;=+*oxO#%@', NC = 8, TAU = PI * 2, SN = new Float32Array(512), i;
  // 暗/中/亮：身、斑 (Logo 綠)、鰭、眼、泡泡、浮游、遠處的魚、背景水紋
  var PAL = [[[8, 34, 48], [22, 94, 106], [68, 146, 140]], [[8, 40, 28], [26, 120, 80], [64, 180, 128]],
    [[6, 28, 48], [18, 78, 108], [52, 124, 152]], [[30, 64, 60], [90, 176, 154], [150, 255, 222]],
    [[6, 30, 44], [34, 100, 120], [100, 178, 190]], [[5, 16, 24], [14, 40, 52], [32, 70, 84]],
    [[4, 16, 32], [14, 52, 88], [40, 100, 140]], [[3, 18, 24], [8, 46, 56], [28, 96, 112]]];
  for (i = 0; i < 512; i++) SN[i] = sin(i / 512 * TAU);
  var LX = -0.35, LY = 0.55, LZ = -0.76, KW = 6.5;   // 光從鏡頭左上來
  var BGF = 7, SK = 512 / TAU;   // 背景水紋用第 8 組顏色；SK：弧度 → 正弦表索引
  function sn(x) { return SN[(x * SK) & 511]; }

  function prof(u) {   // 魚身半高：圓頭、收到尾柄 (尾柄留粗才接得上尾鰭)
    if (u < 0.3) { var a = (0.3 - u) / 0.32; return 0.18 * sqrt(1 - a * a); }
    var t = (u - 0.3) / 0.7;
    return 0.18 * (0.32 + 0.68 * (1 - t * t * (3 - 2 * t)));
  }
  function amp(u) { return 0.012 + 0.075 * u * u; }   // 擺幅：頭穩、尾巴甩
  function rgb(p, k) {
    var A = p[k < 0.5 ? 0 : 1], B = p[k < 0.5 ? 1 : 2], q = k < 0.5 ? k * 2 : k * 2 - 1, s = 'rgb(';
    for (var j = 0; j < 3; j++) s += round(A[j] + (B[j] - A[j]) * q) + (j < 2 ? ',' : ')');
    return s;
  }

  function start(cv, opts) {
    opts = opts || {};
    var st = window.__bootFishStats = { frames: 0, avgMs: 0, maxMs: 0, cols: 0, rows: 0, running: false };
    if (!cv || !cv.getContext) return { stop: function () {} };
    var txt = opts.text, red = !!opts.reduced, ctx, W, H, IW, IH, DPR, cw, ch, cwd, chd, cols, rows, F, PX, PY, CT, ST, atlas;
    var zb, kb, gb, rb, mk, om, sh, wb, wn = 0, nd = 0, tfs = 13, padT = 10, padL = 12, adv = 0.6, ff = 'monospace', MX = 0, MY = 0, MZ = 0;
    var raf = 0, alive = true, dirty = true, last = 0, t = 0, sum = 0, ema = 3, qual = 1, lastMask = -1e9, puff = 0.6, wt = 0, bend = 0, chk = 0, mo = null, remask = true, T0 = performance.now();
    // 兩條魚：[錨點 x, y (px), 深度, 左右幅度, 前後幅度, 角速度, 起始相位, 鏡像, 擺尾速度, 上下幅度]
    var FA = [[], []], BD = [0, 0], C = [0, 0, 0], P0 = [0, 0, 0], P1 = [0, 0, 0], P2 = [0, 0, 0];
    var fx, fy, fz, ux, uy, uz, rx, ry, rz, izN, VX, VY, VZ, HX, HY, HZ, fB, fS, fF;
    var NB = 18, bx = new Float32Array(NB), by = new Float32Array(NB), bz = new Float32Array(NB), bs = new Float32Array(NB), bp = new Float32Array(NB);
    var NS = 70, sx = new Float32Array(NS), sy = new Float32Array(NS), sz = new Float32Array(NS);

    function layout() {
      dirty = false;
      ctx = ctx || cv.getContext('2d');
      IW = window.innerWidth; IH = window.innerHeight; DPR = window.devicePixelRatio || 1;
      W = cv.clientWidth || IW; H = cv.clientHeight || IH;
      var wide = W > H, dpr = min(DPR, 2, sqrt(9e6 / (W * H))), n, k, L, rs;
      // 格子取整數裝置像素才銳利：桌機約 120 欄、手機約 56 欄
      cwd = max(5, round(W * dpr / (wide ? max(70, min(128, W / 12)) : max(45, min(66, W / 7))))); chd = round(cwd * 1.8);
      cols = ceil(W * dpr / cwd); rows = ceil(H * dpr / chd); cw = cwd / dpr; ch = chd / dpr;
      cv.width = round(W * dpr); cv.height = round(H * dpr);
      n = cols * rows;
      if (!zb || zb.length < n) { zb = new Float32Array(n); kb = new Uint8Array(n); gb = new Uint8Array(n); rb = new Uint8Array(n); mk = new Uint8Array(n); om = new Uint8Array(n); sh = new Int16Array(n); wb = new Int16Array(n); }
      for (k = 0; k < n; k++) sh[k] = -1;   // 畫布改尺寸會清空，全部重畫
      wn = 0;
      atlas = null;
      // 字型、字級、留白 (#rb-term 繼承 #rawair-boot；只讀樣式不讀位置)
      try { rs = getComputedStyle(cv.parentNode); ff = rs.fontFamily || ff; tfs = parseFloat(rs.fontSize) || 13; padT = parseFloat(rs.paddingTop) || 0; padL = parseFloat(rs.paddingLeft) || 0; } catch (_) {}
      // 桌機字在左 → 魚留在右半邊；手機字在上 → 魚放大、擺在進度條下面
      if (wide) {
        CT = cos(0.45); ST = sin(0.45); L = min(0.23 * W, 0.4 * H);
        FA[0] = [0.767 * W, 0.58 * H, 5, 0.4, 0.088, 0.48, 1.9, 1, 9, 0.1]; FA[1] = [0.84 * W, 0.25 * H, 10, 0.6, 0.13, 0.3, 2.3, -1, 6.5, 0.1];
      } else {
        CT = cos(0.55); ST = sin(0.55); L = 0.56 * W;
        FA[0] = [0.5 * W, 0.6 * H, 5, 0.18, 0.045, 0.48, 1.9, 1, 9, 0.06]; FA[1] = [0.58 * W, 0.87 * H, 10, 0.4, 0.09, 0.3, 2.3, -1, 6.5, 0.06];
      }
      F = L * 5;
      if (!st.cols) { for (k = 0; k < NS; k++) { sx[k] = rnd(); sy[k] = rnd(); sz[k] = 2 + rnd() * 7; } for (k = 0; k < NB; k += 2) bub(k, rnd() * H); }
      st.cols = cols; st.rows = rows;
    }

    // 字元圖集：每列一色、整串一次寫 (字寬剛好一格)；錯開再寫一次當粗體 (真粗體第一次載入慢)
    function glyphs() {
      var a, k, y, o = cwd / 22;
      atlas = document.createElement('canvas'); atlas.width = cwd * RAMP.length; atlas.height = chd * NC * PAL.length;
      a = atlas.getContext('2d');
      a.font = '100px ' + ff; adv = a.measureText('M').width / 100 || 0.6;
      a.font = (cwd / adv).toFixed(2) + 'px ' + ff;
      a.textBaseline = 'middle';
      for (k = 0; k < NC * PAL.length; k++) { a.fillStyle = rgb(PAL[k >> 3], (k & 7) / 7); y = k * chd + chd / 2; a.fillText(RAMP, 0, y); a.fillText(RAMP, o, y); }
    }

    // 8 字形路徑：兩頭都朝鏡頭轉身且轉得快，不會正對魚尾；中間側身慢慢游
    function path(a, tt, o) {
      var s = a[6] + a[5] * tt, p = s - 0.3 * sin(2 * s);
      o[0] = a[7] * a[3] * sin(p);
      o[1] = 0.06 * sin(s * 1.3) + a[9] * sin(p);   // 往一邊游微微上浮、回來下沉
      o[2] = a[4] * sin(2 * p);
    }
    function pose(k) {
      var a = FA[k];
      PX = a[0]; PY = a[1]; wt = t * a[8] + k * 2; bend = BD[k];
      fB = k ? 6 : 0; fS = k ? 6 : 1; fF = k ? 6 : 2;
      path(a, t - 0.06, P0); path(a, t, P1); path(a, t + 0.06, P2);
      var vx = P2[0] - P0[0], vy = (P2[1] - P0[1]) * 0.5, vz = P2[2] - P0[2];   // 俯仰減半
      var ax = P2[0] - 2 * P1[0] + P0[0], az = P2[2] - 2 * P1[2] + P0[2];
      var h2 = vx * vx + vz * vz, il = 1 / sqrt(h2 + vy * vy), rl = 1 / sqrt(h2);
      var f0x = vx * il, f0y = vy * il, f0z = vz * il, r0x = -vz * rl, r0z = vx * rl;   // 右 = 前 × 上
      var u0x = -r0z * f0y, u0y = r0z * f0x - r0x * f0z, u0z = r0x * f0y;
      // 曲率：轉彎時身體往內彎、往內側傾
      var kc = max(-1, min(1, 4 * (ax * r0x + az * r0z) / (h2 + vy * vy)));
      bend = BD[k] = red ? kc * 0.07 : bend + (kc * 0.07 - bend) * 0.15;
      var roll = max(-0.45, min(0.45, -kc * 0.5)), cr = cos(roll), sr = sin(roll);
      var r1y = u0y * sr, r1z = r0z * cr + u0z * sr, u1y = u0y * cr, u1z = u0z * cr - r0z * sr;
      // 世界 → 鏡頭 (往下俯)
      rx = r0x * cr + u0x * sr; ry = r1y * CT + r1z * ST; rz = r1z * CT - r1y * ST;
      ux = u0x * cr - r0x * sr; uy = u1y * CT + u1z * ST; uz = u1z * CT - u1y * ST;
      fx = f0x; fy = f0y * CT + f0z * ST; fz = f0z * CT - f0y * ST;
      P1[2] += 0.4 * sin(t * 0.3 + a[6]);   // 慢慢游近游遠 (不算進朝向)
      C[0] = P1[0]; C[1] = P1[1] * CT + P1[2] * ST; C[2] = a[2] + P1[2] * CT - P1[1] * ST;
      var vl = 1 / sqrt(C[0] * C[0] + C[1] * C[1] + C[2] * C[2]);
      VX = -C[0] * vl; VY = -C[1] * vl; VZ = -C[2] * vl;   // 視線與 Blinn 半向量
      HX = LX + VX; HY = LY + VY; HZ = LZ + VZ; vl = 1 / sqrt(HX * HX + HY * HY + HZ * HZ);
      HX *= vl; HY *= vl; HZ *= vl;
      izN = 1 / max(0.8, C[2] - 0.75);
    }

    function put(px, py, iz, g, row, force) {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      var kk = ((py / ch) | 0) * cols + ((px / cw) | 0);
      if (force === 1 && rb[kk] >> 3 === 3 && zb[kk]) return;   // 微粒不蓋住眼睛
      if (iz > zb[kk] * force) { zb[kk] = iz; kb[kk] = 0; gb[kk] = g; rb[kk] = row; }
    }
    // 魚身一點 (區域座標 + 法向量) → 螢幕格 → z-buffer；two = 雙面的鰭 (2 = 背鰭)
    function plot(lx, ly, lz, nx, ny, nz, fam, two, gain) {
      var Z = C[2] + fz * lx + uz * ly + rz * lz;
      if (Z < 0.4) return;
      var iz = 1 / Z, px = PX + (C[0] + fx * lx + ux * ly + rx * lz) * F * iz, py = PY - (C[1] + fy * lx + uy * ly + ry * lz) * F * iz;
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      var kk = ((py / ch) | 0) * cols + ((px / cw) | 0);
      if (iz <= zb[kk] || (two && kb[kk] && iz < zb[kk] * 1.04)) return;   // 鰭半透明：貼著身體就讓身體透出來
      var NX = fx * nx + ux * ny + rx * nz, NY = fy * nx + uy * ny + ry * nz, NZ = fz * nx + uz * ny + rz * nz;
      var nv = NX * VX + NY * VY + NZ * VZ, d, l, s, r, g, c;
      if (nv < 0) { if (!two) return; NX = -NX; NY = -NY; NZ = -NZ; nv = -nv; }
      if (two > 1 && nv < 0.3) return;   // 從上面看背鰭只是一條線，不畫
      d = NX * LX + NY * LY + NZ * LZ;
      if (two) l = (0.28 + 0.5 * (d < 0 ? -d : d)) * gain * (nv > 0.4 ? 1 : 0.4 + nv * 1.5);   // 側對鏡頭時變淡
      else {
        s = NX * HX + NY * HY + NZ * HZ; r = 1 - nv;
        s = s > 0 ? s * s : 0; s *= s; s *= s; s *= s; r *= r; r *= r;
        l = 0.1 + 0.78 * (d > 0 ? d : 0) + 0.4 * s + 0.2 * r;   // Lambert + 高光 + 邊光
      }
      s = (iz - 0.1) * 8; g = round(l * 14);   // 越近越亮
      c = round((l * 0.8 + 0.12) * (0.6 + 0.4 * (s < 0 ? 0 : s > 1 ? 1 : s)) * 7);
      zb[kk] = iz; kb[kk] = !two; gb[kk] = g < 0 ? 0 : g > 14 ? 14 : g; rb[kk] = fam * NC + (c < 0 ? 0 : c > 7 ? 7 : c);
    }

    function fish(k) {
      // 取樣間距跟著投影大小 (近密遠疏)；淡入的前幾幀與慢的手機 (qual) 疏一點
      var step = (red ? 0.75 : max(0.75 * qual, 1.8 - max(t * 2.6, st.frames * 0.15))) * cw / (F * izN);
      var i, j, n, m, u, h, w, x, zw, dz, il, sfx, sfz, c, s, kk, A, ph, q, yc, dh, p1, p2, nx, ny, nz, nl, sd, b, e, R;
      // 魚身：沿脊椎一圈圈橢圓截面，身體波由頭往尾傳
      n = max(24, min(240, ceil(1.15 / step)));
      for (i = 0; i <= n; i++) {
        u = M.pow(i / n, 1.3); h = prof(u); w = h * 0.74;
        dh = (prof(min(1, u + 0.01)) - prof(max(0, u - 0.01))) * 50;
        dh = dh > 4 ? 4 : dh < -4 ? -4 : dh;
        x = 0.7 - u; A = amp(u); ph = KW * u - wt;
        zw = A * sin(ph) + bend * u * u;
        dz = 0.15 * u * sin(ph) + A * KW * cos(ph) + 2 * bend * u;
        il = 1 / sqrt(1 + dz * dz); sfx = dz * il; sfz = il;
        yc = 0.012 * sin(PI * u);
        p1 = sin(u * 11 + 2) * 0.6 + sin(u * 4.3) * 0.8; p2 = sin(u * 7) * 0.5;   // 錦鯉斑紋
        m = max(10, min(200, ceil(TAU * (h + w) * 0.5 / step)));
        for (j = 0; j < m; j++) {
          kk = (j * 512 / m) | 0; c = SN[(kk + 128) & 511]; s = SN[kk];
          nx = sfx * c * h; ny = s * w; nz = sfz * c * h; nl = 1 / sqrt(nx * nx + ny * ny + nz * nz + 1e-9);
          nx = nx * nl + il * dh; ny *= nl; nz = nz * nl - dz * il * dh;
          nl = 1 / sqrt(nx * nx + ny * ny + nz * nz);
          q = p1 + c * p2 + s * 0.5;
          plot(x + sfx * w * c, yc + h * s, zw + sfz * w * c, nx * nl, ny * nl, nz * nl,
            (q > 0.55 && s > -0.35) || (u < 0.13 && u > 0.04 && s > 0.2) ? fS : fB, 0, 1);
        }
      }
      // 背鰭：長而低，前端立起
      n = max(8, ceil(0.48 / step));
      for (i = 0; i <= n; i++) {
        q = i / n; u = 0.3 + 0.48 * q; R = 0.095 * min(1, q / 0.12) * (1 - 0.6 * q); e = 0.02 * sin(wt * 0.7 - u * 5);
        h = prof(u) * 0.97 + 0.012 * sin(PI * u); zw = amp(u) * sin(KW * u - wt) + bend * u * u;
        m = max(2, ceil(R / step));
        for (j = 1; j <= m; j++) { q = j / m; plot(0.7 - u - q * 0.06, h + q * R, zw + q * e, 0, 0, 1, fF, 2, 0.85); }
      }
      // 尾鰭：跟著身體波甩，叉尾、兩葉微微兜起；根部跟尾柄一樣粗
      n = max(8, ceil(0.42 / step)); m = max(8, ceil(0.55 / step));
      for (j = 0; j <= m; j++) {
        b = j / m * 2 - 1; e = b < 0 ? -b : b; R = 0.24 + 0.2 * e; s = 0.8 + 0.2 * cos(b * 19);
        for (i = 0; i <= n; i++) {
          q = i / n; u = 1 + q * R; A = amp(u); ph = KW * u - wt - q * 0.6; c = cos(ph);
          dz = A * KW * c; il = 1 / sqrt(1 + dz * dz);
          plot(-0.3 - q * R, b * (0.055 + 0.22 * q * (1.25 - 0.25 * q)), A * sin(ph) + bend * u * u - 0.06 * q * e * c, dz * il, 0, -il, fF, 1, s * (1.15 - 0.3 * q));
        }
      }
      // 胸鰭：鰓後左右一片圓扇往外後張開，慢慢划水
      h = prof(0.25); w = h * 0.74; zw = amp(0.25) * sin(KW * 0.25 - wt) + bend * 0.0625;
      n = max(4, ceil(0.17 / step)); m = max(6, ceil(0.3 / step));
      for (sd = -1; sd <= 1; sd += 2) {
        e = -0.4 + 0.3 * sin(wt * 0.45 + sd); nx = -0.2 * sd - 0.3 * sd * e; ny = 0.85 * sd; nz = -0.85 * e;
        nl = 1 / sqrt(nx * nx + ny * ny + nz * nz); nx *= nl; ny *= nl; nz *= nl;
        for (j = 0; j <= m; j++) {
          q = j / m; A = 0.1 + 1.25 * q; c = cos(A); s = sin(A); R = 0.17 * (0.65 + 0.35 * sin(PI * q));
          for (i = 1; i <= n; i++) {
            q = i / n * R;
            plot(0.46 - 0.92 * c * q, -0.5 * h + (-0.22 * c + e * s) * q, zw + sd * (0.8 * w + (0.32 * c + s) * q), nx, ny, nz, fF, 1, 0.95 - 0.25 * i / n);
          }
        }
      }
      // 眼睛：朝鏡頭那側才畫，夠大畫成 o@o
      h = prof(0.1); w = h * 0.74; zw = amp(0.1) * sin(KW * 0.1 - wt);
      var ey = 0.004 + 0.3 * h, fv = fx * VX + fy * VY + fz * VZ, uv = ux * VX + uy * VY + uz * VZ, rv = rx * VX + ry * VY + rz * VZ, X, Y, Z, iz, row = 3 * NC + (k ? 3 : 7);
      for (sd = -1; sd <= 1; sd += 2) {
        if (fv * 0.35 + uv * 0.3 + rv * sd * 0.89 < 0.1) continue;
        e = zw + sd * w * 0.98; Z = C[2] + fz * 0.6 + uz * ey + rz * e;
        if (Z < 0.4) continue;
        iz = 1 / Z; X = PX + (C[0] + fx * 0.6 + ux * ey + rx * e) * F * iz; Y = PY - (C[1] + fy * 0.6 + uy * ey + ry * e) * F * iz;
        if (0.03 * F * iz > cw * 0.55) { put(X, Y, iz, 14, row, 0.97); put(X - cw, Y, iz, 9, row, 0.97); put(X + cw, Y, iz, 9, row, 0.97); }
        else put(X, Y, iz, 9, row, 0.97);
      }
      if (!k) { MZ = C[2] + fz * 0.74; MX = PX + (C[0] + fx * 0.74) * F / MZ; MY = PY - (C[1] + fy * 0.74) * F / MZ; }
    }

    function bub(i, y) { bz[i] = 1.8 + rnd() * 6; bx[i] = rnd() * W; by[i] = y; bs[i] = 0.008 + rnd() * 0.03; bp[i] = rnd() * 6; }
    function lev(z) { var c = round((1.2 - z / 9) * 7); return c < 0 ? 0 : c > 7 ? 7 : c; }
    function particles(dt) {
      var i, j, z, kz;
      for (i = 0; i < NS; i++) {   // 浮游往下飄，近快遠慢
        z = sz[i]; sy[i] += dt * 0.04 / z; sx[i] += dt * 0.004 * sin(t * 0.3 + i);
        if (sy[i] > 1.02) { sy[i] = -0.02; sx[i] = rnd(); }
        put(sx[i] * W, sy[i] * H, 1 / z, z < 3.5 ? 4 : 0, 5 * NC + lev(z), 1);
      }
      puff -= dt;   // 泡泡：魚嘴偶爾吐一串，其餘從底下冒
      for (i = 0; i < NB; i++) {
        if (!bz[i]) {
          if (puff < 0 && i % 3 === 0 && MZ > 0.5) {
            for (j = i; j < i + 3 && j < NB; j++) { bz[j] = MZ; bx[j] = MX + (rnd() - 0.5) * cw; by[j] = MY - (j - i) * ch * 1.3; bs[j] = 0.012 + rnd() * 0.012; bp[j] = rnd() * 6; }
            puff = 1.2 + rnd() * 1.5;
          } else if (rnd() < dt * 0.12) bub(i, H + 8);
          continue;
        }
        z = bz[i]; by[i] -= dt * (0.12 + bs[i] * 5) * F / z; bx[i] += sin(t * 3 + bp[i]) * dt * 0.04 * F / z;
        if (by[i] < -10) { bz[i] = 0; continue; }
        kz = bs[i] * F / z / cw;
        put(bx[i], by[i], 1 / z, kz < 0.5 ? 0 : kz < 1.1 ? 9 : 11, 4 * NC + lev(z), 1);
      }
    }

    // 文字遮罩：照 boot-screen.css 行高 (1.35em、大字 1.15em、進度列上方 .35em) 往下算，不讀版面
    // 2 = 字底下 (魚壓很暗、不畫微粒)，1 = 行尾與下一行的半暗邊；om 留上一版給 recolor 比對
    function mask() {
      var n = cols * rows, y = padT, k, j, el, cl, fs, h, len, r1, c1, v, kids = om;
      remask = false; om = mk; mk = kids;
      for (k = 0; k < n; k++) mk[k] = 0;
      if (!txt) return;
      kids = txt.children;
      for (j = 0; j < kids.length; j++) {
        el = kids[j]; cl = el.className;
        if (cl === 'rb-art') { fs = parseFloat(el.style.fontSize) || tfs; h = 1.15 * fs; len = el.children.length * 0.6 * fs; }
        else { if (cl === 'rb-status') y += 0.35 * tfs; h = 1.35 * tfs; len = (el.textContent.replace(/\s+$/, '').length + (cl === 'rb-status')) * adv * tfs; }
        if (len) {
          r1 = ((y + h) / ch) | 0; c1 = min(cols - 1, ceil((padL + len) / cw));
          for (k = (y / ch) | 0; k <= r1 + 1 && k < rows; k++) for (v = 0; v <= c1 + 3 && v < cols; v++) {
            if (mk[k * cols + v] < 2) mk[k * cols + v] = k <= r1 && v <= c1 ? 2 : 1;
          }
        }
        y += h;
      }
    }
    // 背景水紋：兩組彎曲的波互相抵消的地方是亮線 (像泳池底的光網)，加上從左上斜下來的光束，越深越暗
    function water(c, r) {
      var X = c * cw, Y = r * ch, d = Y / H, v1, v2, l, g;
      v1 = sn(X * 0.019 + t * 0.8 + 1.7 * sn(Y * 0.012 + t * 0.35));
      v2 = sn(Y * 0.026 - t * 0.6 + 1.5 * sn(X * 0.015 - t * 0.45 + 1));
      l = 1 - (v1 + v2 < 0 ? -(v1 + v2) : v1 + v2) * 0.5; l = l * l * l;
      v1 = 0.5 + 0.5 * sn(X * 0.007 - Y * 0.0045 + t * 0.12);
      l = (0.12 + 0.6 * l + 0.3 * v1 * v1 * (1 - d)) * (1 - 0.45 * d);
      // 字元最多到「+」、顏色最多到中亮：水紋只當底，不能比魚搶眼
      g = round(l * 8); c = round(l * 6);
      return (g < 0 ? 0 : g > 7 ? 7 : g) * 64 + BGF * NC + (c > 5 ? 5 : c);
    }
    // 這格要顯示什麼 (字元 × 64 + 顏色列)，-1 = 空白；字底下的魚壓暗、水紋和微粒不畫
    function want(i, c, r) {
      var row, m = mk[i];
      if (zb[i]) {
        row = rb[i];
        if (!m) return gb[i] * 64 + row;
        if (row >> 3 !== 4 && row >> 3 !== 5) return gb[i] * 64 + ((row & 0xf8) | ((row & 7) >> m));
      }
      if (m > 1) return -1;
      row = wb[i];
      return m ? (row & ~7) | ((row & 7) >> 1) : row;
    }
    // 只重畫跟上一幀不一樣的格子
    // 水紋算好存起來，約每 3 幀才更新一次 (慢的手機更久)；魚和字照常每幀
    function compose(fresh) {
      var i = 0, r, c, w;
      if (fresh && --wn <= 0) {
        wn = ema > 8 ? 6 : 3;
        for (r = 0; r < rows; r++) for (c = 0; c < cols; c++, i++) wb[i] = water(c, r);
        i = 0;
      } else if (wn <= 0) {
        wn = 1; for (r = 0; r < rows; r++) for (c = 0; c < cols; c++, i++) wb[i] = water(c, r);
        i = 0;
      }
      for (r = 0, nd = 0; r < rows; r++) for (c = 0; c < cols; c++, i++) {
        w = want(i, c, r);
        if (w === sh[i]) continue;
        ctx.clearRect(c * cwd, r * chd, cwd, chd);
        if (w >= 0) ctx.drawImage(atlas, (w >> 6) * cwd, (w & 63) * chd, cwd, chd, c * cwd, r * chd, cwd, chd);
        sh[i] = w; nd++;
      }
      st.drawn = nd;
    }
    function recolor() { mask(); compose(); }   // 只有字變了：遮罩變了的格子會自己重畫
    function render(dt) {
      for (var i = 0, n = cols * rows; i < n; i++) zb[i] = 0;
      pose(1); fish(1); pose(0); fish(0); particles(dt);
    }

    function gone(now) {   // 開機畫面被拿掉，或被 20 秒的 CSS 保險藏起來
      if (!document.documentElement.contains(cv)) return true;
      if (now - T0 < 19500 || ++chk % 15) return false;
      try { return getComputedStyle(cv).visibility === 'hidden'; } catch (_) { return false; }
    }
    function acc(a) {   // 統計：每段工作都算進平均與最大值
      var ms = performance.now() - a;
      sum += ms; if (ms > st.maxMs) st.maxMs = +ms.toFixed(3);
      if (st.frames) st.avgMs = +(sum / st.frames).toFixed(3);
      return ms;
    }
    function guard(fn) {   // 魚只是裝飾：任何一幀出錯就安靜收掉、拿掉畫布，不丟錯誤、不拖住開機畫面
      return function (now) {
        try { fn(now); } catch (_) { stop(); if (cv.parentNode) cv.parentNode.removeChild(cv); }
      };
    }
    var loop = guard(frame), still = guard(stillFrame);
    function frame(now) {
      raf = 0;
      if (!alive) return;
      if (gone(now)) { stop(); return; }
      if (document.hidden) { last = 0; return; }   // 背景分頁不畫，切回來由 onVis 接上
      raf = requestAnimationFrame(loop);
      var a = performance.now(), dt, ms;
      if (dirty || !atlas) {   // 排版、圖集、第一幀分開做 (時間照算進統計)
        if (dirty) layout(); else glyphs();
        return acc(a);
      }
      if (last && now - last < max(30, ema * 5)) {   // 上限約 30 fps；慢的手機自動降幀 (畫一幀最多只佔 1/5 時間，留給資料載入)
        if (remask) { recolor(); acc(a); }   // 新印的字當幀壓暗
        return;
      }
      dt = last ? min(0.05, (now - last) / 1000) : 0.033; last = now; t += dt;
      if (remask || (!mo && now - lastMask > 140)) { lastMask = now; mask(); }
      render(dt); compose(1);
      st.frames++; ms = acc(a);
      if (st.frames > 3) ema += (ms - ema) * 0.1;
      qual = ema > 7 ? min(1.5, qual + 0.02) : ema < 4 ? max(1, qual - 0.01) : qual;   // 慢就疏一點，快了再變密
    }
    function stillFrame() {   // 減少動態：只畫一張，字變了再壓暗
      raf = 0;
      if (!alive) return;
      var a = performance.now();
      if (dirty) { layout(); glyphs(); t = opts.t != null ? opts.t : 0.9; render(0); mask(); compose(); }
      else recolor();
      a = +(performance.now() - a).toFixed(3); st.frames = 1;
      if (a > st.maxMs) st.avgMs = st.maxMs = a;
    }
    function later() { remask = true; if (red && alive && !raf) raf = requestAnimationFrame(still); }
    function onResize() {
      // tablet.js 開機時丟的假 resize：尺寸沒變就不重排
      if (window.innerWidth === IW && window.innerHeight === IH && (window.devicePixelRatio || 1) === DPR) return;
      dirty = true;
      if (red) later();
    }
    function onVis() { if (!document.hidden && alive && !raf) raf = requestAnimationFrame(loop); }
    function stop() {
      alive = false; st.running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (mo) mo.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    }

    // 這裡不做重活：第一個 rAF 只量尺寸 (頁面還小、便宜)，下一幀畫圖集，再下一幀才畫魚
    // 字一變就重算遮罩 (靜止模式只看增刪行，不跟著轉圈游標重畫)
    window.addEventListener('resize', onResize);
    if (txt && window.MutationObserver) { mo = new MutationObserver(later); mo.observe(txt, { childList: true, subtree: !red }); }
    if (!red) { st.running = true; document.addEventListener('visibilitychange', onVis); }
    raf = requestAnimationFrame(red ? still : loop);
    return { stop: stop };
  }

  window.RawairFish = { start: start };
})();
