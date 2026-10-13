// The sparse fleet, refined: a few long rows receding into haze behind the
// opening line, one balancer, one sharded database with its replicas. Pulses
// travel as soft comets at a constant pace on screen, easing only where they
// stop. Three structure languages, chosen with ?s=:
//   1  Cabinet rows (default): rows of separate upright cabinets.
//   2  Service districts: each row a distinct service with its own silhouette.
//   3  Skyline: blade-chassis towers and stacked shard columns, mirrored.
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

const root = document.documentElement;
const canvas = document.getElementById('bg3d');
const hero = document.getElementById('hero');
const heading = hero.querySelector('h1');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const debug = new URLSearchParams(location.search);
const S = ['1', '2', '3'].includes(debug.get('s')) ? Number(debug.get('s')) : 1;

const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (n) => Math.floor(Math.random() * n);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const pick = (list) => list[randInt(list.length)];

/* ---------- Renderer, camera, theme ---------- */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove();
  throw e;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
// Resolution steps down on slower GPUs (see adapt()).
const RATIOS = [1.75, 1.4, 1.1, 0.9].map((r) => Math.min(devicePixelRatio, r)).filter((r, i, a) => a.indexOf(r) === i);
let ratioStep = 0;
renderer.setPixelRatio(RATIOS[0]);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 260);

// Paper and ink with plum; three tones per solid (lightest top, front, side).
const PALETTES = {
  light: {
    bg: '#ebeae6', ink: '#141414', plum: '#9b4767', edgeCol: '#141414',
    top: '#f6f5f1', front: '#e1dfda', side: '#d1cfc9', shadow: '#2b2a26',
    edge: 0.3, groove: 0.16, tray: 0.26, shadowA: 0.12, led: 0.34, resp: 0.5, scrim: 0.9, glow: 0,
  },
  dark: {
    bg: '#151515', ink: '#ededea', plum: '#d08aa5', edgeCol: '#ededea',
    top: '#2a2a28', front: '#222221', side: '#1b1b1a', shadow: '#000000',
    edge: 0.16, groove: 0.12, tray: 0.22, shadowA: 0.5, led: 0.36, resp: 0.55, scrim: 0.92, glow: 1,
  },
};

const U = {
  uBg: { value: new THREE.Color() }, uInk: { value: new THREE.Color() }, uPlum: { value: new THREE.Color() }, uEdgeCol: { value: new THREE.Color() },
  uTop: { value: new THREE.Color() }, uFront: { value: new THREE.Color() }, uSide: { value: new THREE.Color() }, uShadow: { value: new THREE.Color() },
  uEdge: { value: 0.3 }, uGroove: { value: 0.16 }, uTray: { value: 0.2 }, uShadowA: { value: 0.15 }, uLed: { value: 0.4 }, uResp: { value: 0.5 },
  uScrimAmt: { value: 0.9 }, uEdgeCut: { value: 1 }, uSoftMax: { value: 4 }, uGlow: { value: 0 },
  uFogNear: { value: 18 }, uFogFar: { value: 80 },
  uTime: { value: 0 }, uDpr: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uPxScale: { value: 1000 }, uRefDepth: { value: 30 },
  // The text scrim in CSS px: one box per line (right edge, top, bottom), merged,
  // anchored to the left edge of the screen; on phones, one full-width band.
  uScrim: { value: new THREE.Vector4(-1e4, -1e4, -1e4, 0) },
  uLines: { value: Array.from({ length: 8 }, () => new THREE.Vector4(-1e4, -1e4, -1e4, 0)) }, uLineN: { value: 0 },
  uLightDir: { value: new THREE.Vector3(-0.5, 0.75, 0.42).normalize() },
  uSeam: { value: 0.12 }, uPorts: { value: 3 },
};

let dirty = true;
const glowMats = [];
function readTheme() {
  const dark = root.dataset.theme === 'dark';
  const p = PALETTES[dark ? 'dark' : 'light'];
  for (const k of ['bg', 'ink', 'plum', 'edgeCol', 'top', 'front', 'side', 'shadow']) U['u' + k[0].toUpperCase() + k.slice(1)].value.set(p[k]);
  U.uEdge.value = p.edge; U.uGroove.value = p.groove; U.uTray.value = p.tray; U.uShadowA.value = p.shadowA;
  U.uLed.value = p.led; U.uResp.value = p.resp; U.uGlow.value = p.glow;
  scrimBase = p.scrim;
  applyScrimStrength();
  // In the dark, plum light adds to what is under it, like a glow.
  for (const m of glowMats) { m.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending; m.needsUpdate = true; }
  renderer.setClearColor(U.uBg.value, 1);
  dirty = true;
}

// Shared by every fragment shader: distance fog into the page colour, and the
// scrim behind the opening line, a rounded rectangle anchored to the left edge
// of the screen. In its core, fills go almost to the page colour and edges,
// shadows and pulses vanish; across its feather edges return early and fills
// late, and edges soften as they fade.
const COMMON = /* glsl */ `
  uniform vec3 uBg, uInk, uPlum;
  uniform float uFogNear, uFogFar, uTime, uDpr, uScrimAmt, uEdgeCut, uSoftMax;
  uniform vec4 uScrim, uLines[8];
  uniform float uLineN;
  uniform vec2 uRes;
  float scrimT() {
    vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
    if (uScrim.w > 0.5) {
      float d = max(uScrim.y - p.y, p.y - uScrim.z);
      return clamp(d / 64.0, 0.0, 1.0);
    }
    float t = 1.0;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= uLineN) break;
      vec4 b = uLines[i];
      float r = 30.0, cy = (b.y + b.z) * 0.5, hy = (b.z - b.y) * 0.5;
      vec2 q = vec2(max(p.x - (b.x - r), 0.0), max(abs(p.y - cy) - (hy - r), 0.0));
      float d = length(q) - r;
      float w = mix(90.0, 170.0, q.x / max(length(q), 1e-3));
      t = min(t, d <= 0.0 ? 0.0 : clamp(d / w, 0.0, 1.0));
    }
    return t;
  }
  float scrimFill(float t) { return uScrimAmt * (1.0 - smoothstep(0.0, 1.0, t)); }
  float scrimEdge(float t) { return uEdgeCut * (1.0 - smoothstep(0.0, 0.45, t)); }
  float scrimSoft(float t) { return mix(uSoftMax, 1.0, smoothstep(0.0, 1.0, t)); }
  float fogOf(float depth) { return smoothstep(uFogNear, uFogFar, depth); }
  float aaLine(float px, float w, float soft) { return 1.0 - smoothstep(w - 0.5 * soft, w + 0.5 * soft, px); }
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
`;

/* ---------- The floor plan (fleet2's sparse fleet) ---------- */

// A few long double rows far apart; three lanes leave one balancer; one
// sharded database stands in the middle aisle with its replicas mirrored.
const AISLE = 7, K = 3, C = 1, M_MIN = -1, M_MAX = 1, POD_FIRST = -3, POD_LAST = 2;
const SEG_LEN = 29.7, SEG_GAP = 6, SEG_PITCH = SEG_LEN + SEG_GAP, FRONT = -3.4, SEGS = 3;
const Z_END = FRONT - SEGS * SEG_PITCH;
const Z_IN = 8, Z_GW = 2.6, LB_R = 0.66, G_OUT = 0.24, R_IN = 0.7, R_AISLE = 0.9, Z_TURN = -1.45;
const DRUM_R = 0.5, DRUM_H = 0.92, PLINTH = 0.05, DRUM_SP = 1.75, DB_OFF = 1.6;
const DB_REACH = DB_OFF - DRUM_R - 0.02;
const ROW_D = 0.74, POD_GAP = 0.06;
const aisleX = (m) => m * AISLE;
const podX = (pod) => pod * AISLE + AISLE / 2;
const segTop = (s) => FRONT - s * SEG_PITCH;

// The database: four shards; primaries on one side of the middle aisle, their
// replicas mirrored on the other, a rung between each pair.
const plaza = (() => {
  const z0 = segTop(0) - 3 * 0.53 - 0.15;
  const zs = [0, 1, 2, 3].map((i) => z0 - (i + 0.5) * DRUM_SP - 0.1);
  return { m: 0, x: 0, z0, zEnd: z0 - 4 * DRUM_SP - 0.25, zs, primary: zs.map(() => -1), down: zs.map(() => 0), parts: {}, replT: zs.map(() => rand(0.5, 3)) };
})();

/* ---------- Paths, measured on screen ---------- */

// The camera the screen lengths are measured with: the resting view, without
// drift or parallax, so the pace stays the same as the view moves gently.
const refCam = new THREE.PerspectiveCamera();
let layoutVersion = 0;
const _v = new THREE.Vector3();
class Path {
  constructor(points) {
    this.p = points;
    this.L = new Float32Array(points.length);
    for (let i = 1; i < points.length; i++) this.L[i] = this.L[i - 1] + points[i].distanceTo(points[i - 1]);
    this.len = this.L[points.length - 1];
    this.ver = -1;
  }
  at(s, out, tan) {
    const L = this.L;
    s = clamp(s, 0, this.len);
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= s) lo = mid; else hi = mid; }
    const a = this.p[lo], b = this.p[hi], d = L[hi] - L[lo];
    out.lerpVectors(a, b, d > 0 ? (s - L[lo]) / d : 0);
    if (tan) tan.subVectors(b, a).normalize();
    return out;
  }
  reversed() { return new Path(this.p.slice().reverse()); }
  // Cumulative length in screen pixels, sampled finely so perspective is exact.
  table() {
    if (this.ver === layoutVersion) return this;
    const n = Math.max(2, Math.ceil(this.len / 0.15) + 1);
    this.tw = new Float32Array(n); this.tp = new Float32Array(n);
    let px = 0, lx = 0, ly = 0;
    for (let i = 0; i < n; i++) {
      const s = (this.len * i) / (n - 1);
      this.at(s, _v).project(refCam);
      const x = (_v.x + 1) * 0.5 * innerWidth, y = (1 - _v.y) * 0.5 * innerHeight;
      if (i) px += Math.hypot(x - lx, y - ly);
      lx = x; ly = y; this.tw[i] = s; this.tp[i] = px;
    }
    this.plen = Math.max(px, 1e-3); this.ver = layoutVersion;
    return this;
  }
  // World arc length at a given screen length along the path.
  worldAt(px) {
    const tp = this.tp, tw = this.tw;
    if (px <= 0) return 0;
    if (px >= this.plen) return this.len;
    let lo = 0, hi = tp.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tp[mid] <= px) lo = mid; else hi = mid; }
    const d = tp[hi] - tp[lo];
    return tw[lo] + (d > 0 ? (px - tp[lo]) / d : 0) * (tw[hi] - tw[lo]);
  }
}

// Corners [[x, z], ...] joined by straight runs and circular fillets (radius per corner).
function route(corners, radii = [], y = 0) {
  const out = [new THREE.Vector3(corners[0][0], y, corners[0][1])];
  for (let i = 1; i < corners.length - 1; i++) {
    const [ax, az] = corners[i - 1], [cx, cz] = corners[i], [bx, bz] = corners[i + 1];
    let d1x = cx - ax, d1z = cz - az, d2x = bx - cx, d2z = bz - cz;
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    const turn = Math.acos(clamp(d1x * d2x + d1z * d2z, -1, 1));
    let r = radii[i - 1] ?? 0.4;
    if (turn < 1e-4 || r <= 0) { out.push(new THREE.Vector3(cx, y, cz)); continue; }
    let t = r * Math.tan(turn / 2);
    const lim = Math.min(l1, l2) * 0.98;
    if (t > lim) { t = lim; r = t / Math.tan(turn / 2); }
    const sgn = Math.sign(d1x * d2z - d1z * d2x);
    const p0x = cx - d1x * t, p0z = cz - d1z * t;
    const ox = p0x - d1z * sgn * r, oz = p0z + d1x * sgn * r;
    const a0 = Math.atan2(p0z - oz, p0x - ox);
    const steps = Math.max(6, Math.ceil(turn / (Math.PI / 40)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + sgn * turn * (k / steps);
      out.push(new THREE.Vector3(ox + Math.cos(a) * r, y, oz + Math.sin(a) * r));
    }
  }
  const last = corners[corners.length - 1];
  out.push(new THREE.Vector3(last[0], y, last[1]));
  return new Path(out);
}
// A lifted arc between two points, for replication in the skyline.
function arcPath(a, b, lift) {
  const pts = [], c = a.clone().add(b).multiplyScalar(0.5);
  c.y += lift;
  for (let i = 0; i <= 40; i++) {
    const u = i / 40, v = 1 - u;
    pts.push(new THREE.Vector3(v * v * a.x + 2 * v * u * c.x + u * u * b.x, v * v * a.y + 2 * v * u * c.y + u * u * b.y, v * v * a.z + 2 * v * u * c.z + u * u * b.z));
  }
  return new Path(pts);
}

// From the trunk through the balancer to the head of aisle m. The side lanes
// leave the balancer side by side and bend on concentric arcs.
function aisleHead(m, fromTrunk = true) {
  const k = m + C, ax = aisleX(m);
  const c = fromTrunk ? [[0, Z_IN]] : [];
  if (k === C) { if (!fromTrunk) c.push([0, -0.3]); return { c, r: [] }; }
  const ox = (k - C) * G_OUT, zt = Z_TURN;
  if (fromTrunk) c.push([0, 0.25]);
  c.push([ox, -0.3], [ox, zt], [ax, zt]);
  return { c, r: fromTrunk ? [0.2, 0.2, R_IN, R_AISLE] : [R_IN, R_AISLE] };
}
const pathCache = new Map();
function cachedPath(key, make) { let p = pathCache.get(key); if (!p) { p = make(); pathCache.set(key, p); } return p; }
// Trunk to a stop on lane m at depth z, and back.
const stopKey = (m, z) => `${m}|${z.toFixed(2)}`;
function inPath(m, z) {
  return cachedPath(`i${stopKey(m, z)}`, () => { const { c, r } = aisleHead(m); return route([...c, [aisleX(m), z]], r); });
}
const outPath = (m, z) => cachedPath(`o${stopKey(m, z)}`, () => inPath(m, z).reversed());
// Along a lane from one stop to another.
const lanePath = (m, z1, z2) => cachedPath(`l${m}|${z1.toFixed(2)}|${z2.toFixed(2)}`, () => route([[aisleX(m), z1], [aisleX(m), z2]]));

/* ---------- Solids, grouped into components you can point at ---------- */

// Box kinds: 0 cabinet, 1 plain, 2 gateway lintel, 3 cache slab, 4 cache cell,
// 5 queue trough, 6 queue block, 7 search card, 8 storage tier, 9 worker slab,
// 10 cable tray, 11 blade tower. Face: 1 / -1 for +x / -x fronts, 2 for +z.
const B = { pos: [], size: [], info: [] };
function addBox(x, y, z, sx, sy, sz, kind, face = 0, extra = 0) {
  B.pos.push(x, y, z); B.size.push(sx, sy, sz); B.info.push(kind, face, rand(1, 999), extra);
  return B.pos.length / 3 - 1;
}
// Cylinder kinds: 0 database drum, 1 balancer disc, 2 shard slice (a short drum in a column).
const Cy = { pos: [], size: [], info: [] };
function addCyl(x, y, z, r, h, kind) {
  Cy.pos.push(x, y, z); Cy.size.push(r, h); Cy.info.push(kind, rand(1, 999));
  return Cy.pos.length / 3 - 1;
}
const comps = [];
function component(kind, data = {}) {
  const c = { kind, boxes: [], cyls: [], hl: 0, act: 0, dim: 0, drained: 0, aabb: new THREE.Box3(), ...data };
  comps.push(c);
  return c;
}
function grow(c, x, y, z, sx, sy, sz) { c.aabb.expandByPoint(new THREE.Vector3(x - sx / 2, y, z - sz / 2)).expandByPoint(new THREE.Vector3(x + sx / 2, y + sy, z + sz / 2)); }
function partBox(c, x, y, z, sx, sy, sz, kind, face = 0, extra = 0) { const i = addBox(x, y, z, sx, sy, sz, kind, face, extra); c.boxes.push(i); grow(c, x, y, z, sx, sy, sz); return i; }
function partCyl(c, x, y, z, r, h, kind) { const i = addCyl(x, y, z, r, h, kind); c.cyls.push(i); grow(c, x, y, z, r * 2, h, r * 2); return i; }

// Places a request can stop: a unit facing a lane, at a depth along it.
const stops = [];        // { comp, m, z, part, kind }
const laned = (m) => m >= M_MIN && m <= M_MAX;
function stopFor(c, m, z, part, kind) { if (laned(m)) stops.push({ comp: c, m, z, part, kind }); }

// Lights (one per cabinet door, s1/s2) and the cabinets themselves.
const cabinets = [];
const CAB = { w: 0.5, d: ROW_D, h: 1.15, pitch: 0.55 };
// A group of cabinets in one row: separate units with gaps, a tray along their tops.
function cabinetGroup(pod, row, z0, n, label = 'compute') {
  const side = row ? -1 : 1, m = row ? pod + 1 : pod;
  const x = podX(pod) + (row ? 1 : -1) * (POD_GAP / 2 + CAB.d / 2);
  const c = component(label, { m, cabs: [] });
  for (let i = 0; i < n; i++) {
    const z = z0 - (i + 0.5) * CAB.pitch;
    const idx = partBox(c, x, 0, z, CAB.d, CAB.h, CAB.w, 0, -side);
    const cab = { idx, x, z, comp: c, act: 0, face: -side };
    cabinets.push(cab); c.cabs.push(cab);
    stopFor(c, m, z, cab, 'cab');
  }
  const len = n * CAB.pitch - 0.05;
  partBox(c, x + side * 0.2, CAB.h, z0 - len / 2 - 0.025, 0.22, 0.05, len, 10);
  return c;
}

const GROUP = 9, GROUP_GAP = 0.6, GROUP_LEN = GROUP * CAB.pitch + GROUP_GAP;
// Rows of cabinet groups filling depth from zA down to zB.
function cabinetRows(pod, zA, zB) {
  const n = Math.max(1, Math.floor((zA - zB + GROUP_GAP) / GROUP_LEN));
  for (const row of [0, 1]) for (let g = 0; g < n; g++) cabinetGroup(pod, row, zA - g * GROUP_LEN, GROUP);
}

/* Service districts (s = 2): each half of a row is one service. */
const services = { cache: [], search: [], queue: [], storage: [], workers: [] };
const units = (zA, zB, pitch) => { const n = Math.max(1, Math.floor((zA - zB) / pitch)), out = []; for (let k = 0; k < n; k++) out.push(zA - (k + 0.5) * ((zA - zB) / n)); return out; };
function cacheDistrict(pod, zA, zB) {
  const cx = podX(pod);
  for (const z of units(zA, zB, 4.4)) {
    const c = component('cache', { cells: [], warm: 0, pod });
    partBox(c, cx, 0, z, 1.42, 0.3, 2.4, 3);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 6; q++) {
      const x = cx - 0.71 + (r + 0.5) * (1.42 / 3), zz = z - 1.2 + (q + 0.5) * 0.4;
      c.cells.push({ act: 0, idx: partBox(c, x, 0.3, zz, 1.42 / 3 - 0.08, 0.07, 0.32, 4) });
    }
    services.cache.push(c);
    for (const m of [pod, pod + 1]) stopFor(c, m, z, null, 'cache');
  }
}
function searchDistrict(pod, zA, zB) {
  const cx = podX(pod);
  for (const z of units(zA, zB, 3.4)) {
    const c = component('search', { shards: [], pod });
    for (const dx of [-0.42, 0.42]) {
      partBox(c, cx + dx, 0, z, 0.62, 0.04, 0.82, 1);
      const cards = [];
      for (let q = 0; q < 4; q++) cards.push(partBox(c, cx + dx, 0.04, z + 0.27 - q * 0.18, 0.52, 0.7, 0.045, 7, 2));
      c.shards.push({ cards, act: 0 });
    }
    services.search.push(c);
    for (const m of [pod, pod + 1]) stopFor(c, m, z, null, 'search');
  }
}
function queueDistrict(pod, zA, zB) {
  const cx = podX(pod), len = (zA - zB) - 4.2, zc = zA - 0.4 - len / 2;
  const c = component('queue', { blocks: [], flush: 0, seq: 0, pod, z0: zc + len / 2, z1: zc - len / 2, troughs: [-0.42, 0, 0.42], x: cx });
  for (const t of c.troughs) {
    partBox(c, cx + t, 0, zc, 0.34, 0.04, len, 5);
    for (const w of [-0.17, 0.17]) partBox(c, cx + t + w, 0.04, zc, 0.035, 0.12, len, 1);
  }
  services.queue.push(c);
  for (const m of [pod, pod + 1]) stopFor(c, m, c.z0 - 0.3, null, 'queue');
  // Workers at the far end take messages off the queue.
  const w = component('workers', { slabs: [], pod });
  for (let r = 0; r < 4; r++) for (let q = 0; q < 3; q++) {
    const x = cx - 0.5 + q * 0.5, z = c.z1 - 1.0 - r * 0.62;
    w.slabs.push({ act: 0, x, z, idx: partBox(w, x, 0, z, 0.42, 0.09, 0.5, 9) });
  }
  services.workers.push(w);
  c.workers = w;
}
function storageDistrict(pod, zA, zB) {
  const cx = podX(pod);
  for (const z of units(zA, zB, 4.6)) {
    const c = component('storage', { tiers: [], pod });
    [[1.44, 0.42, 2.2, 0], [1.05, 0.36, 1.6, 0.42], [0.68, 0.3, 1.0, 0.78]].forEach(([w, h, d, y]) => c.tiers.push({ act: 0, idx: partBox(c, cx, y, z, w, h, d, 8) }));
    services.storage.push(c);
    for (const m of [pod, pod + 1]) stopFor(c, m, z, null, 'storage');
  }
}
const DISTRICTS = { compute: cabinetRows, cache: cacheDistrict, search: searchDistrict, queue: queueDistrict, storage: storageDistrict };
// Each segment of each row is split into districts: [service, share of the segment].
// The rows nearest the camera, right of the middle lane, carry the most variety.
const DISTRICT_PLAN = {
  '-3': [[['compute', 1]], [['compute', 1]], [['compute', 1]]],
  '-2': [[['compute', 0.5], ['queue', 0.5]], [['compute', 0.5], ['storage', 0.5]], [['compute', 1]]],
  '-1': [[['compute', 0.5], ['search', 0.5]], [['cache', 0.5], ['compute', 0.5]], [['compute', 1]]],
  '0': [[['compute', 0.3], ['cache', 0.33], ['search', 0.37]], [['storage', 0.5], ['compute', 0.5]], [['compute', 1]]],
  '1': [[['queue', 0.62], ['storage', 0.38]], [['compute', 0.5], ['cache', 0.5]], [['search', 0.5], ['compute', 0.5]]],
  '2': [[['storage', 0.5], ['compute', 0.5]], [['compute', 0.5], ['search', 0.5]], [['compute', 1]]],
};

/* Skyline (s = 3): blade-chassis towers with stacked nodes, in a calm rhythm. */
const towers = [];
function towerRow(pod, s) {
  const cx = podX(pod);
  for (let k = 0; k < 17; k++) {
    const z = segTop(s) - 0.9 - k * 1.75;
    const wave = 0.5 + 0.5 * Math.sin(k * 0.55 + pod * 1.7 + s * 2.3);
    const nodes = 7 + Math.round(wave * 5 + rand(0, 1.4));
    const h = nodes * 0.24 + 0.16;
    const c = component('tower', { pod, nodes, h, act: 0, node: 0 });
    c.idx = partBox(c, cx, 0, z, 1.3, h, 1.1, 11, 0, nodes);
    towers.push(c);
    for (const m of [pod, pod + 1]) stopFor(c, m, z, null, 'tower');
  }
}

// Fill the floor.
for (let pod = POD_FIRST; pod <= POD_LAST; pod++) for (let s = 0; s < SEGS; s++) {
  if (S === 3) { towerRow(pod, s); continue; }
  if (S === 1) { cabinetRows(pod, segTop(s), segTop(s) - SEG_LEN); continue; }
  let z = segTop(s);
  DISTRICT_PLAN[pod][s].forEach(([kind, share], n, all) => {
    const len = SEG_LEN * share, zA = z - (n ? 0.4 : 0), zB = z - len + (n < all.length - 1 ? 0.4 : 0);
    DISTRICTS[kind](pod, zA, zB);
    z -= len;
  });
}
const N_CABS = cabinets.length;

// The gateway: a portal over the trunk, with a row of lights on its lintel.
const gateway = component('gateway');
partBox(gateway, -0.56, 0, Z_GW, 0.2, 0.84, 0.5, 1);
partBox(gateway, 0.56, 0, Z_GW, 0.2, 0.84, 0.5, 1);
gateway.lintel = partBox(gateway, 0, 0.84, Z_GW, 1.32, 0.17, 0.5, 2);
// The balancer: a disc with a port per lane and spokes.
const balancer = component('balancer', { port: C, policy: 0, rr: 0, ring: 0, out: [0, 0, 0] });
balancer.idx = partCyl(balancer, 0, 0.0, 0, LB_R, 0.22, 1);
const POLICIES = ['round robin', 'least busy', 'all lanes'];

// The database: banded drums (s1, s2) or stacked shard columns (s3), primaries
// on one side of the aisle and replicas mirrored on the other.
const COLUMN = { slices: 6, sh: 0.3, gap: 0.07, r: 0.46 };
const colH = COLUMN.slices * (COLUMN.sh + COLUMN.gap);
for (const side of [-1, 1]) addBox(plaza.x + side * DB_OFF, 0, (plaza.z0 + plaza.zEnd) / 2, 1.25, PLINTH, plaza.z0 - plaza.zEnd - 0.1, 1);
for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
  const d = component('drum', { i, side, act: 0, dim: 0, role: plaza.primary[i] === side ? 1 : 0, x: plaza.x + side * DB_OFF, z: plaza.zs[i], slices: [] });
  if (S === 3) {
    for (let k = 0; k < COLUMN.slices; k++) d.slices.push(partCyl(d, d.x, PLINTH + k * (COLUMN.sh + COLUMN.gap), d.z, COLUMN.r, COLUMN.sh, 2));
    d.idx = d.slices[0];
  } else d.idx = partCyl(d, d.x, PLINTH, d.z, DRUM_R, DRUM_H, 0);
  plaza.parts[`${i}|${side}`] = d;
}
const drumTop = (d) => (S === 3 ? PLINTH + colH : PLINTH + DRUM_H);

const BOX_VERT = /* glsl */ `
  attribute vec3 iPos, iSize;
  attribute vec4 iInfo, iState;
  varying vec3 vN, vSize;
  varying vec2 vUv;
  varying float vDepth;
  varying vec4 vInfo, vState;
  void main() {
    // A drained cabinet settles a little; a hovered part lifts a little.
    vec3 size = iSize;
    if (iInfo.x < 0.5) size.y *= 1.0 - 0.22 * iState.y;
    vec3 p = position * size + iPos;
    p.y += iState.z * 0.07;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vN = normal; vUv = uv; vDepth = -mv.z; vInfo = iInfo; vState = iState; vSize = size;
  }`;
const BOX_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec3 uTop, uFront, uSide, uEdgeCol, uLightDir;
  uniform float uEdge, uGroove, uLed, uSeam;
  varying vec3 vN, vSize;
  varying vec2 vUv;
  varying float vDepth;
  varying vec4 vInfo, vState;
  float lines(float g, float soft) {
    float fg = max(fwidth(g), 1e-6);
    return aaLine(abs(fract(g + 0.5) - 0.5) / fg, 0.5, soft) * smoothstep(2.5, 5.0, 1.0 / fg);
  }
  float dots(vec2 uv, float n, float v0, float r, vec2 world) {
    float cell = fract(uv.x * n) - 0.5;
    vec2 q = vec2(cell * world.x / n, (uv.y - v0) * world.y);
    float d = length(q), fd = max(fwidth(d), 1e-6);
    return 1.0 - smoothstep(r - fd, r + fd, d);
  }
  void main() {
    float kind = vInfo.x, face = vInfo.y, seed = vInfo.z;
    float act = vState.x, dim = vState.y, hl = vState.z, node = vState.w;
    float st = scrimT(), soft = scrimSoft(st), edgeK = scrimEdge(st);
    vec3 n = vN;
    float isTop = step(0.5, n.y);
    float isFront = face > 1.5 ? step(0.5, n.z) : (abs(face) > 0.5 ? step(0.5, n.x * face) : 0.0);
    isFront *= 1.0 - isTop;
    float lam = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = isTop > 0.5 ? uTop : (isFront > 0.5 ? uFront : mix(uSide, uFront, smoothstep(0.3, 0.85, lam) * 0.6));
    vec2 fw = max(fwidth(vUv), vec2(1e-6));
    vec2 ed = min(vUv, 1.0 - vUv) / fw;
    float edge = aaLine(min(ed.x, ed.y), 0.5, soft) * smoothstep(1.5, 5.0, min(1.0 / fw.x, 1.0 / fw.y));
    float detail = 0.0, plumA = 0.0;

    if (kind < 0.5) {
      // A cabinet: an inset door with 1U grooves; it warms to plum while it serves.
      if (isFront > 0.5) {
        vec2 d = (vUv - 0.5) / vec2(0.4, 0.45);
        float inDoor = step(max(abs(d.x), abs(d.y)), 1.0);
        vec2 dd = (1.0 - abs(d)) * vec2(0.4, 0.45) / fw;
        float frame = aaLine(min(dd.x, dd.y), 0.5, soft) * inDoor;
        float grooves = lines((vUv.y - 0.05) / 0.9 * 11.0, soft) * inDoor * step(0.07, vUv.y) * step(vUv.y, 0.93);
        detail = max(frame * 0.9, grooves);
      }
      plumA = act * (isFront * 0.24 + isTop * 0.14);
    } else if (kind < 2.5 && kind > 1.5) {
      // The gateway lintel: lights across its face that flash as requests pass.
      float led = dots(vUv, 7.0, 0.5, 0.026, vec2(1.32, 0.17)) * step(0.5, n.z);
      col = mix(col, mix(uInk, uPlum, act), led * mix(uLed, 1.0, act));
      plumA = act * isTop * 0.25;
    } else if (kind < 4.5 && kind > 3.5) {
      // A cache cell: resident keys glow faintly when warm (carried in dim); a hit blinks.
      plumA = isTop * min(1.0, act * 0.85 + dim * 0.22);
      dim = 0.0;
    } else if (kind < 5.5 && kind > 4.5) {
      col = mix(uSide, uFront, 0.3);
    } else if (kind < 6.5 && kind > 5.5) {
      col = mix(uPlum, uTop, isTop > 0.5 ? 0.2 : 0.38);
      edge *= 0.35;
    } else if (kind < 7.5 && kind > 6.5) {
      // A search card: a few ruled postings on its face.
      if (isFront > 0.5) detail = lines(vUv.y * 5.0, soft) * step(0.15, vUv.x) * step(vUv.x, 0.85) * step(0.2, vUv.y) * step(vUv.y, 0.85);
      plumA = act * (0.25 + isFront * 0.3);
    } else if (kind < 8.5 && kind > 7.5) {
      plumA = act * (0.12 + isTop * 0.25);
    } else if (kind < 9.5 && kind > 8.5) {
      if (isTop > 0.5) detail = lines(vUv.y * 2.0, soft) * step(0.1, vUv.x) * step(vUv.x, 0.9);
      plumA = act * (0.2 + isTop * 0.45);
    } else if (kind < 10.5 && kind > 9.5) {
      // A cable tray: a ladder of rungs along its length.
      col = uSide;
      if (isTop > 0.5) detail = lines(vUv.y * vSize.z / 0.3, soft) * 0.8;
      edge *= 0.6;
    } else if (kind > 10.5) {
      // A blade chassis: a stack of nodes on every side, each with its own
      // light; the node serving a request glows plum.
      float nodes = vInfo.w;
      if (isTop < 0.5) {
        float v = (vUv.y * vSize.y - 0.08) / (vSize.y - 0.16);
        float slot = v * nodes, k = floor(slot), f = fract(slot);
        float inside = step(0.0, v) * step(v, 1.0) * step(0.06, vUv.x) * step(vUv.x, 0.94);
        detail = lines(slot, soft) * inside;
        float lw = vUv.x * (n.z > 0.5 ? vSize.x : vSize.z);
        vec2 q = vec2(lw - 0.12, (f - 0.5) * (vSize.y - 0.16) / nodes);
        float r = length(q), fr = max(fwidth(r), 1e-6);
        float led = (1.0 - smoothstep(0.03 - fr, 0.03 + fr, r)) * inside * smoothstep(0.8, 2.0, 0.06 / fr);
        float idle = step(0.62, hash(seed + k * 7.31));
        float lit = act * (1.0 - step(0.5, abs(k - node)));
        col = mix(col, mix(uInk, uPlum, lit), led * mix(idle * uLed, 1.0, lit));
        plumA = lit * inside * 0.35;
      } else {
        vec2 d = abs(vUv - 0.5) * 2.0;
        vec2 dd = (1.0 - d) * 0.5 / fw;
        detail = aaLine(min(dd.x, dd.y), 6.0, soft) * 0.6;
      }
    }
    float fog = fogOf(vDepth);
    col = mix(col, uInk, detail * uGroove * (1.0 - dim) * (1.0 - edgeK));
    col = mix(col, uPlum, plumA);
    col = mix(col, uBg, dim * 0.72);
    vec3 ec = mix(uEdgeCol, uPlum, hl * 0.9);
    col = mix(col, ec, edge * mix(uEdge, max(uEdge, 0.55), hl) * (1.0 - dim * 0.5) * (1.0 - fog * 0.6) * (1.0 - edgeK));
    col = mix(col, uBg, fog);
    gl_FragColor = vec4(mix(col, uBg, scrimFill(st)), 1.0);
  }`;

function boxMesh(count) {
  const g = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  g.instanceCount = count;
  const attr = (name, size, data, dyn) => {
    const a = new THREE.InstancedBufferAttribute(data || new Float32Array(Math.max(1, count) * size), size);
    if (dyn) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    return a;
  };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: U, vertexShader: BOX_VERT, fragmentShader: BOX_FRAG }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { g, mesh, attr };
}
const N_BOX = B.pos.length / 3;
const boxes = boxMesh(N_BOX);
boxes.attr('iPos', 3, new Float32Array(B.pos));
boxes.attr('iSize', 3, new Float32Array(B.size));
boxes.attr('iInfo', 4, new Float32Array(B.info));
const boxState = boxes.attr('iState', 4, null, true);
// Message blocks in the queues: their own small, moving instances.
const MAX_BLOCKS = 40;
const blocks = boxMesh(0);
const blockPos = blocks.attr('iPos', 3, new Float32Array(MAX_BLOCKS * 3), true);
blocks.attr('iSize', 3, new Float32Array(MAX_BLOCKS * 3).map((_, i) => [0.22, 0.14, 0.34][i % 3]));
blocks.attr('iInfo', 4, new Float32Array(MAX_BLOCKS * 4).map((_, i) => [6, 0, 1, 0][i % 4]));
const blockState = blocks.attr('iState', 4, new Float32Array(MAX_BLOCKS * 4), true);

const N_CYL = Cy.pos.length / 3;
const cylGeo = new THREE.InstancedBufferGeometry().copy(new THREE.CylinderGeometry(1, 1, 1, 64, 1).translate(0, 0.5, 0));
cylGeo.instanceCount = N_CYL;
cylGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(Cy.pos), 3));
cylGeo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(Cy.size), 2));
cylGeo.setAttribute('iInfo', new THREE.InstancedBufferAttribute(new Float32Array(Cy.info), 2));
const cylState = new THREE.InstancedBufferAttribute(new Float32Array(N_CYL * 4), 4).setUsage(THREE.DynamicDrawUsage);
cylGeo.setAttribute('iState', cylState);
const cylHl = new THREE.InstancedBufferAttribute(new Float32Array(N_CYL), 1).setUsage(THREE.DynamicDrawUsage);
cylGeo.setAttribute('iHl', cylHl);
const cylMesh = new THREE.Mesh(cylGeo, new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: /* glsl */ `
    attribute vec3 iPos;
    attribute vec2 iSize, iInfo;
    attribute vec4 iState;
    attribute float iHl;
    varying vec3 vN, vLocal, vW;
    varying float vDepth, vHl;
    varying vec2 vInfo;
    varying vec4 vState;
    void main() {
      vec3 p = vec3(position.x * iSize.x, position.y * iSize.y, position.z * iSize.x) + iPos;
      p.y += iHl * 0.07;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      vN = normal; vLocal = position; vW = p;
      vDepth = -mv.z; vInfo = iInfo; vState = iState; vHl = iHl;
    }`,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform vec3 uTop, uFront, uSide, uEdgeCol, uLightDir;
    uniform float uEdge, uLed, uPorts;
    varying vec3 vN, vLocal, vW;
    varying float vDepth, vHl;
    varying vec2 vInfo;
    varying vec4 vState;
    void main() {
      float kind = vInfo.x;
      float act = vState.x, dim = vState.y, role = vState.z, port = vState.w;
      float st = scrimT(), soft = scrimSoft(st), edgeK = scrimEdge(st);
      vec3 N = normalize(vN);
      float isTop = step(0.5, N.y);
      vec3 col;
      float line = 0.0, plumA = 0.0, detail = 0.0;
      if (isTop > 0.5) {
        col = uTop;
        float r = length(vLocal.xz), fr = max(fwidth(r), 1e-6);
        line = aaLine((1.0 - r) / fr, 0.5, soft);
        if (kind < 0.5 || kind > 1.5) {
          // A drum or shard lid: an inner ring that fills when it serves.
          float ring = aaLine(abs(r - 0.6) / fr, 0.5, soft);
          detail = ring;
          plumA = act * (0.75 * (1.0 - smoothstep(0.6 - fr, 0.6 + fr, r)) + 0.8 * ring);
        } else {
          // The balancer: a hub, spokes and a port per lane. Its policy (in role):
          // round robin rings the hub, least busy fills it, all lanes lights every port.
          float a = atan(vLocal.z, vLocal.x);
          float ang = abs(mod(a + 0.3926991, 0.7853982) - 0.3926991) * r;
          float fa = max(fwidth(ang), 1e-6);
          float spoke = aaLine(ang / fa, 0.6, soft) * step(0.32, r) * step(r, 0.55);
          float hub = aaLine(abs(r - 0.24) / fr, 0.5, soft);
          float fill = (1.0 - smoothstep(0.18 - fr, 0.18 + fr, r)) * step(0.5, role) * step(role, 1.5);
          detail = max(spoke * 0.8, max(hub, fill));
          for (int k = 0; k < 3; k++) {
            vec2 c = vec2((float(k) - 1.0) * 0.3, -0.72);
            float d = length(vLocal.xz - c), fd = max(fwidth(d), 1e-6);
            float dot_ = 1.0 - smoothstep(0.075 - fd, 0.075 + fd, d);
            float on = act * max(1.0 - step(0.5, abs(float(k) - port)), step(1.5, role));
            col = mix(col, mix(uInk, uPlum, on), dot_ * mix(uLed, 1.0, on));
          }
          plumA = spoke * act * 0.6 + dim * aaLine(abs(r - (1.0 - dim) * 0.95) / fr, 2.0, soft) * 0.8;
          dim = 0.0;
        }
      } else {
        float lam = clamp(dot(N, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        col = mix(uSide, uFront, smoothstep(0.25, 0.85, lam));
        vec3 V = normalize(cameraPosition - vW);
        float nv = abs(dot(N, V)), fn = max(fwidth(nv), 1e-6);
        line = 1.0 - smoothstep(fn * 0.7 * soft, fn * 2.0 * soft, nv);
        float y = vLocal.y, fy = max(fwidth(y), 1e-6);
        line = max(line, aaLine(min(y, 1.0 - y) / fy, 0.5, soft));
        if (kind < 0.5) {
          detail = max(aaLine(abs(y - 0.36) / fy, 0.5, soft), aaLine(abs(y - 0.68) / fy, 0.5, soft));
          plumA = act * 0.12;
        } else if (kind > 1.5) plumA = act * 0.22;
        else dim = 0.0;
      }
      float fog = fogOf(vDepth);
      // Replicas are a little quieter than primaries; a failed one fades almost away.
      float quiet = kind < 0.5 || kind > 1.5 ? 1.0 - clamp(role, 0.0, 1.0) : 0.0;
      col = mix(col, uInk, detail * 0.22 * (1.0 - edgeK));
      col = mix(col, uPlum, plumA);
      col = mix(col, uBg, min(1.0, quiet * 0.2 + dim * 0.86));
      vec3 ec = mix(uEdgeCol, uPlum, vHl * 0.9);
      col = mix(col, ec, line * mix(uEdge, max(uEdge, 0.55), vHl) * (1.0 - quiet * 0.35) * (1.0 - dim * 0.5) * (1.0 - fog * 0.6) * (1.0 - edgeK));
      col = mix(col, uBg, fog);
      gl_FragColor = vec4(mix(col, uBg, scrimFill(st)), 1.0);
    }`,
}));
cylMesh.frustumCulled = false;
scene.add(cylMesh);

/* ---------- Contact shadows ---------- */

const SH = { c: [], h: [], p: [] };
const addShadow = (x, z, hx, hz, soft, strength, round = 0) => { SH.c.push(x, z); SH.h.push(hx, hz); SH.p.push(soft, strength, round); };
for (const c of comps) {
  if (c.kind === 'drum' || c.kind === 'balancer' || c.kind === 'gateway') continue;
  const bb = c.aabb;
  addShadow((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2, (bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2, c.kind === 'tower' ? 0.6 : 0.45, 1);
}
for (const k in plaza.parts) { const d = plaza.parts[k], r = S === 3 ? COLUMN.r : DRUM_R; addShadow(d.x, d.z, r, r, 0.45, 1.1, r); }
addShadow(0, 0, LB_R, LB_R, 0.35, 0.9, LB_R);
for (const sx of [-1, 1]) addShadow(sx * 0.56, Z_GW, 0.1, 0.25, 0.4, 1);
const shadowGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
shadowGeo.instanceCount = SH.c.length / 2;
shadowGeo.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(SH.c), 2));
shadowGeo.setAttribute('iH', new THREE.InstancedBufferAttribute(new Float32Array(SH.h), 2));
shadowGeo.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array(SH.p), 3));
const shadowMesh = new THREE.Mesh(shadowGeo, new THREE.ShaderMaterial({
  uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute vec2 iC, iH;
    attribute vec3 iP;
    varying vec2 vP, vH;
    varying vec3 vPar;
    varying float vDepth;
    void main() {
      vec2 local = position.xz * 2.0 * (iH + iP.x);
      vec4 mv = viewMatrix * vec4(iC.x + local.x, 0.003, iC.y + local.y, 1.0);
      gl_Position = projectionMatrix * mv;
      vP = local; vH = iH; vPar = iP; vDepth = -mv.z;
    }`,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform vec3 uShadow;
    uniform float uShadowA;
    varying vec2 vP, vH;
    varying vec3 vPar;
    varying float vDepth;
    void main() {
      vec2 q = abs(vP) - vH + vPar.z;
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vPar.z;
      float k = 1.0 - smoothstep(-0.02, vPar.x, d);
      float a = vPar.y * uShadowA * k * k * (1.0 - fogOf(vDepth)) * (1.0 - scrimEdge(scrimT()));
      gl_FragColor = vec4(uShadow, a);
    }`,
}));
shadowMesh.frustumCulled = false;
shadowMesh.renderOrder = 1;
scene.add(shadowMesh);

/* ---------- Lanes: two fine rails on the floor ---------- */

const T = { pos: [], side: [], w: [], index: [] };
function tray(path, width, weight = 1) {
  const P = path.p, n = P.length, base = T.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    for (const side of [-1, 1]) { T.pos.push(P[i].x - tz * side * width / 2, 0.006, P[i].z + tx * side * width / 2); T.side.push(side); T.w.push(weight); }
    if (i < n - 1) { const v = base + i * 2; T.index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
}
tray(route([[0, Z_IN + 30], [0, 0]]), 0.165);
for (let m = M_MIN; m <= M_MAX; m++) { const { c, r } = aisleHead(m, false); tray(route([...c, [aisleX(m), Z_END]], r), 0.11); }
for (const z of plaza.zs) tray(route([[plaza.x - DB_REACH, z], [plaza.x + DB_REACH, z]]), 0.09);
const trayGeo = new THREE.BufferGeometry();
trayGeo.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
trayGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(T.side, 1));
trayGeo.setAttribute('aW', new THREE.Float32BufferAttribute(T.w, 1));
trayGeo.setIndex(T.index);
const trayMesh = new THREE.Mesh(trayGeo, new THREE.ShaderMaterial({
  uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute float aSide, aW;
    varying float vSide, vDepth, vW;
    void main() {
      vec4 mv = viewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      vSide = aSide; vDepth = -mv.z; vW = aW;
    }`,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform float uTray;
    varying float vSide, vDepth, vW;
    void main() {
      float st = scrimT();
      float fs = max(fwidth(vSide), 1e-6);
      float widthPx = 2.0 / fs;
      float rail = aaLine((1.0 - abs(vSide)) / fs, 0.55, scrimSoft(st));
      float a = max(rail, 0.12);
      a = mix(clamp(widthPx * 0.45, 0.0, 1.0) * 0.6, a, smoothstep(2.0, 5.0, widthPx));
      a *= uTray * vW * (1.0 - fogOf(vDepth)) * (1.0 - scrimEdge(st)) * (1.0 - scrimFill(st));
      gl_FragColor = vec4(uInk, a);
    }`,
}));
trayMesh.frustumCulled = false;
trayMesh.renderOrder = 2;
scene.add(trayMesh);

/* ---------- Replication arcs (skyline): hairlines that appear and fade ---------- */

class Lines {
  constructor(cap) {
    this.cap = cap; this.n = 0; this.ni = 0;
    const g = (this.g = new THREE.BufferGeometry());
    const mk = (name, size) => { const a = new THREE.BufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a.array; };
    this.c = mk('aC', 3); this.t = mk('aTan', 3); this.s = mk('aSide', 1); this.a = mk('aA', 1);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    this.idx = new Uint32Array(cap * 3);
    g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec3 aC, aTan;
        attribute float aSide, aA;
        uniform vec2 uRes;
        uniform float uDpr;
        varying float vSide, vA, vDepth, vHw;
        void main() {
          vec4 mv = viewMatrix * vec4(aC, 1.0);
          vec4 c0 = projectionMatrix * mv;
          vec4 c1 = projectionMatrix * (viewMatrix * vec4(aC + aTan * 0.05, 1.0));
          vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
          d = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0);
          vHw = 1.4 * uDpr;
          c0.xy += vec2(-d.y, d.x) * aSide * vHw * 2.0 / uRes * c0.w;
          gl_Position = c0;
          vSide = aSide; vA = aA; vDepth = -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        varying float vSide, vA, vDepth, vHw;
        void main() {
          float st = scrimT();
          float a = clamp(0.5 * uDpr + 0.5 - abs(vSide) * vHw, 0.0, 1.0);
          a *= vA * (1.0 - fogOf(vDepth)) * (1.0 - scrimEdge(st)) * (1.0 - scrimFill(st));
          if (a < 0.003) discard;
          gl_FragColor = vec4(uPlum, a);
        }`,
    });
    glowMats.push(mat);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; this.ni = 0; }
  strip(pts, alpha) {
    const m = pts.length;
    if (this.n + m * 2 > this.cap) return;
    const base = this.n;
    for (let i = 0; i < m; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)], p = pts[i];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const l = Math.hypot(tx, ty, tz) || 1;
      for (const side of [-1, 1]) {
        const v = this.n++;
        this.c.set([p.x, p.y, p.z], v * 3); this.t.set([tx / l, ty / l, tz / l], v * 3);
        this.s[v] = side; this.a[v] = alpha;
      }
      if (i < m - 1) { const v = base + i * 2; this.idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], this.ni); this.ni += 6; }
    }
  }
  end() {
    this.g.setDrawRange(0, this.ni);
    for (const k of ['aC', 'aTan', 'aSide', 'aA']) this.g.attributes[k].needsUpdate = true;
    this.g.index.needsUpdate = true;
  }
}
const arcs = new Lines(2000);

/* ---------- Points: comets, arrival rings, cabinet lights ---------- */

function pointLayer(cap, attrs, vert, frag, glow = true) {
  const g = new THREE.BufferGeometry(), arr = {};
  g.setAttribute('position', new THREE.BufferAttribute((arr.position = new Float32Array(cap * 3)), 3).setUsage(THREE.DynamicDrawUsage));
  for (const [name, size] of attrs) g.setAttribute(name, new THREE.BufferAttribute((arr[name] = new Float32Array(cap * size)), size).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, vertexShader: vert, fragmentShader: frag });
  if (glow) glowMats.push(mat);
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { g, arr, pts, cap, commit(n) { g.setDrawRange(0, n); for (const k in g.attributes) g.attributes[k].needsUpdate = true; } };
}
const SIZE_BY_DEPTH = /* glsl */ `
  uniform float uDpr, uRefDepth;
  float sizeAt(float px, float depth) { return px * uDpr * clamp(uRefDepth / depth, 0.55, 1.3); }
`;
// A comet: a soft round head with a gentle glow, and a trail of soft discs laid
// along the route behind it. No hard ends, so nothing reads as an arrow.
const comets = pointLayer(2400, [['aSize', 1], ['aA', 1], ['aHead', 1]], /* glsl */ `
  attribute float aSize, aA, aHead;
  ${SIZE_BY_DEPTH}
  varying float vA, vHead, vDepth;
  void main() {
    vec4 mv = viewMatrix * vec4(position + vec3(0.0, 0.06, 0.0), 1.0);
    gl_Position = projectionMatrix * mv;
    vDepth = -mv.z;
    gl_PointSize = sizeAt(aSize, vDepth);
    vA = aA; vHead = aHead;
  }`, /* glsl */ `
  ${COMMON}
  uniform float uGlow, uResp;
  varying float vA, vHead, vDepth;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    // Head: a bright core in a soft halo. Trail: a gaussian blob, faint at its rim.
    float head = (1.0 - smoothstep(0.24, 0.42, d)) + exp(-d * d * 5.5) * mix(0.32, 0.55, uGlow);
    float trail = exp(-d * d * 4.0) * (1.0 - smoothstep(0.75, 1.0, d));
    float a = mix(trail, head, vHead) * vA;
    float st = scrimT();
    a *= (1.0 - fogOf(vDepth)) * (1.0 - scrimEdge(st)) * (1.0 - scrimFill(st));
    if (a < 0.003) discard;
    gl_FragColor = vec4(uPlum, min(a, 1.0));
  }`);
// Arrival: a thin ring that opens and fades over 600ms.
const rings = pointLayer(64, [['aAge', 1]], /* glsl */ `
  attribute float aAge;
  ${SIZE_BY_DEPTH}
  varying float vAge, vDepth, vPx;
  void main() {
    vec4 mv = viewMatrix * vec4(position + vec3(0.0, 0.06, 0.0), 1.0);
    gl_Position = projectionMatrix * mv;
    vDepth = -mv.z;
    vPx = sizeAt(4.0 + 18.0 * sqrt(aAge), vDepth) + 3.0 * uDpr;
    gl_PointSize = vPx;
    vAge = aAge;
  }`, /* glsl */ `
  ${COMMON}
  varying float vAge, vDepth, vPx;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0) * vPx * 0.5;
    float r = vPx * 0.5 - 1.6 * uDpr;
    float a = (1.0 - smoothstep(0.5 * uDpr, 1.3 * uDpr, abs(d - r))) * pow(1.0 - vAge, 1.5) * 0.8;
    float st = scrimT();
    a *= (1.0 - fogOf(vDepth)) * (1.0 - scrimEdge(st)) * (1.0 - scrimFill(st));
    if (a < 0.003) discard;
    gl_FragColor = vec4(uPlum, a);
  }`);
rings.pts.material.depthTest = false;
// One light on each cabinet's door: grey when idle, plum while it serves.
const leds = pointLayer(Math.max(1, N_CABS), [['aAct', 1], ['aDim', 1], ['aFace', 1]], /* glsl */ `
  attribute float aAct, aDim, aFace;
  ${SIZE_BY_DEPTH}
  varying float vAct, vDim, vDepth, vFacing;
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vDepth = -mv.z;
    vAct = smoothstep(0.02, 0.4, aAct); vDim = aDim;
    vFacing = smoothstep(0.02, 0.3, normalize(cameraPosition - position).x * aFace);
    gl_PointSize = vFacing > 0.0 ? sizeAt(mix(2.2, 3.8, vAct), vDepth) : 0.0;
  }`, /* glsl */ `
  ${COMMON}
  uniform float uLed;
  varying float vAct, vDim, vDepth, vFacing;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.55, 1.0, d)) * mix(uLed * 0.8, 1.0, vAct) * (1.0 - vDim) * vFacing;
    float st = scrimT();
    a *= (1.0 - fogOf(vDepth * 1.15)) * (1.0 - scrimEdge(st)) * (1.0 - scrimFill(st));
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uInk, uPlum, vAct), a);
  }`, false);
cabinets.forEach((c, i) => { leds.arr.position.set([c.x + c.face * (CAB.d / 2 + 0.012), CAB.h * 0.88, c.z + c.face * 0.12], i * 3); leds.arr.aFace[i] = c.face; });
leds.commit(N_CABS);

/* ---------- Simulation: pulses on a timetable ---------- */

// Every pulse follows an exact timetable along its route, measured in screen
// pixels: a constant cruise speed, with smooth S-shaped ramps (smoothstep
// velocity, so no jolt) only where it starts from or stops at a node. Position
// depends on elapsed time alone, so motion is the same at any frame rate.
const PACE = { req: 118, resp: 140, inner: 100, small: 92, repl: 78 };   // px/s at 1440x900
const RAMP = 0.55;                // seconds to gather speed or settle
const TRAIL = 0.42;               // seconds of motion the trail shows
let Z_START = 12;                 // trunk entry, just below the screen (set per layout)
let pulses = [], timers = [], ringList = [], arcList = [], clock = 0, seqT = 0.6, surgeAt = -99, pulseId = 0;
const trips = [];
const after = (t, fn) => timers.push({ t, fn });
let paceScale = 1;

function timetable(L, V, rin, rout) {
  let need = (V * (rin + rout)) / 2;
  if (need > L && need > 0) { const k = L / need; rin *= k; rout *= k; }
  return { L, V, rin, rout, T: L / V + (rin + rout) / 2 };
}
function distAt(tt, t) {
  if (t <= 0) return 0;
  if (t >= tt.T) return tt.L;
  const { V, rin, rout, T, L } = tt;
  if (rin > 0 && t < rin) { const x = t / rin; return V * rin * (x * x * x - (x * x * x * x) / 2); }
  if (rout > 0 && t > T - rout) { const y = (T - t) / rout; return L - V * rout * (y * y * y - (y * y * y * y) / 2); }
  return (V * rin) / 2 + V * (t - rin);
}
Path.prototype.pxAt = function (s) {
  const tw = this.tw, tp = this.tp;
  let lo = 0, hi = tw.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tw[mid] <= s) lo = mid; else hi = mid; }
  const d = tw[hi] - tw[lo];
  return tp[lo] + (d > 0 ? (s - tw[lo]) / d : 0) * (tp[hi] - tp[lo]);
};

// kind: 0 request, 1 response (dimmer), 2 small (inside a service, replication, acks).
function launch(path, kind, opt = {}) {
  path.table();
  const V = (opt.pace ?? (kind === 0 ? PACE.req : kind === 1 ? PACE.resp : PACE.small)) * paceScale * (opt.fast ? 1.3 : 1);
  const p = {
    id: ++pulseId, path, kind, t0: clock + (opt.delay || 0), tt: timetable(path.plen, V, opt.rin ?? RAMP, opt.rout ?? RAMP),
    size: opt.size ?? (kind === 0 ? 13.5 : kind === 1 ? 10.5 : 9.5), alpha: opt.alpha ?? (kind === 1 ? 0.62 : kind === 2 ? 0.85 : 1),
    onArrive: opt.onArrive || null, arrived: false, marks: opt.marks || null, arc: opt.arc || null,
  };
  pulses.push(p);
  return p;
}
const ring = (x, y, z) => { if (ringList.length < 60) ringList.push({ x, y, z, age: 0 }); };

/* Where requests go, by variant. */
const live = (st) => !st.comp.drained;
function stopsOn(m, kinds) { return stops.filter((s) => s.m === m && kinds.includes(s.kind) && live(s)); }
// Most requests land in the nearer part of the fleet; some run deep into the haze.
function nearish(list) {
  if (!list.length) return null;
  const target = FRONT - Math.min(70, -Math.log(1 - Math.random() * 0.97) * 13);
  let best = null, bd = Infinity;
  for (const s of list) { const d = Math.abs(s.z - target) + Math.random() * 1.2; if (d < bd) { bd = d; best = s; } }
  return best;
}
function pickLane() {
  if (balancer.policy === 1) {
    let best = 0;
    for (let k = 1; k < K; k++) if (balancer.out[k] < balancer.out[best] || (balancer.out[k] === balancer.out[best] && Math.random() < 0.5)) best = k;
    return best - C;
  }
  balancer.rr = (balancer.rr + 1) % K;
  return balancer.rr - C;
}

const trunkPath = (m, z) => cachedPath(`t${stopKey(m, z)}`, () => { const { c, r } = aisleHead(m); c[0] = [0, Z_START]; return route([...c, [aisleX(m), z]], r); });
const exitPath = (m, z) => cachedPath(`x${stopKey(m, z)}`, () => trunkPath(m, z).reversed());

// A request from the edge to a stop on a lane; arrival calls then(stop).
function request(stop, then, opts = {}) {
  const k = stop.m + C;
  balancer.out[k]++;
  const path = trunkPath(stop.m, stop.z);
  path.table();
  const sGate = Z_START - Z_GW, sLb = Z_START;
  const p = launch(path, 0, { rin: 0, fast: opts.fast, onArrive: () => then(stop), marks: [[path.pxAt(sGate), () => { gateway.act = 1; }], [path.pxAt(sLb), () => { balancer.port = k; balancer.act = 1; }]] });
  p.t0 = clock - (opts.lead || 0);
  return p;
}
// Its response, dimmer, back out past the gateway and off the screen.
function respond(stop) {
  launch(exitPath(stop.m, stop.z), 1, { rout: 0, onArrive: () => { balancer.out[stop.m + C] = Math.max(0, balancer.out[stop.m + C] - 1); } });
}

function hitStop(st, amount = 1) {
  const c = st.comp;
  if (st.part) { st.part.act = Math.max(st.part.act, amount); ring(st.part.x + st.part.face * 0.4, CAB.h * 0.6, st.part.z); }
  else if (c.kind === 'tower') { c.act = Math.max(c.act, amount); c.node = randInt(c.nodes); ring(aisleX(st.m) + Math.sign(podX(c.pod) - aisleX(st.m)) * 0.6, 0.5, st.z); }
  else { c.act = Math.max(c.act, amount); ring(aisleX(st.m), 0.2, st.z); }
}

/* The database: a write goes from a service on the middle lane to a shard's
   primary, which copies it to its replica; an ack comes back. */
const drumSpur = (zFrom, i, side) => cachedPath(`d${zFrom.toFixed(2)}|${i}|${side}`, () => route([[0, zFrom], [0, plaza.zs[i]], [side * DB_REACH, plaza.zs[i]]], [0.5]));
function write(st, done) {
  const i = randInt(4), side = plaza.primary[i], d = plaza.parts[`${i}|${side}`];
  launch(drumSpur(st.z, i, side), 0, { pace: PACE.inner, onArrive: () => {
    d.act = 1; ring(d.x, drumTop(d) * 0.6, d.z + 0.5);
    trips.push(+(clock - (st.t0 ?? clock)).toFixed(2)); if (trips.length > 40) trips.shift();
    replicate(i, () => {});
    after(0.35, () => launch(drumSpur(st.z, i, side).reversed(), 1, { pace: PACE.inner, onArrive: () => { hitStop(st, 0.5); after(0.25, done); } }));
  } });
}
function replicate(i, onAck) {
  const from = plaza.primary[i];
  if (plaza.down[i]) { onAck?.(); return; }
  const a = plaza.parts[`${i}|${from}`], b = plaza.parts[`${i}|${-from}`];
  let path;
  if (S === 3) {
    const pa = new THREE.Vector3(a.x, drumTop(a) + 0.05, a.z), pb = new THREE.Vector3(b.x, drumTop(b) + 0.05, b.z);
    path = cachedPath(`a${i}|${from}`, () => arcPath(pa, pb, 1.3));
  } else path = cachedPath(`g${i}|${from}`, () => route([[plaza.x + from * DB_REACH, plaza.zs[i]], [plaza.x - from * DB_REACH, plaza.zs[i]]]));
  const rec = S === 3 ? { path, born: clock, fade: 0 } : null;
  if (rec) arcList.push(rec);
  launch(path, 2, { pace: PACE.repl, arc: rec, onArrive: () => {
    b.act = Math.max(b.act, 0.7); ring(b.x, drumTop(b), b.z);
    if (rec) rec.fade = clock;
    after(0.12, () => launch(cachedPath(`r${i}|${from}`, () => path.reversed()), 2, { pace: PACE.repl * 1.2, size: 6, alpha: 0.7, onArrive: () => { a.act = Math.max(a.act, 0.5); onAck?.(); } }));
  } });
}

/* Services (s = 2). */
function cacheRead(st) {
  const c = st.comp;
  pick(c.cells).act = 1;
  const hit = Math.random() < 0.4 + 0.55 * c.warm;
  // A hit answers at once; a miss waits on the store behind it and warms the cache.
  if (hit) after(0.3, () => respond(st));
  else after(0.8, () => { c.warm = Math.min(1, c.warm + 0.08); pick(c.cells).act = 1; respond(st); });
}
function scatterGather(st) {
  const c = st.comp, x = aisleX(st.m), toward = Math.sign(podX(c.pod) - x);
  let left = c.shards.length;
  c.shards.forEach((sh, n) => {
    const tx = podX(c.pod) + (n ? 0.42 : -0.42), p = cachedPath(`q${c.pod}|${st.z.toFixed(2)}|${st.m}|${n}`, () => route([[x, st.z], [x + toward * 0.9, st.z], [tx, st.z + 0.6]], [0.3]));
    launch(p, 2, { pace: PACE.small, onArrive: () => {
      sh.act = 1;
      after(0.2, () => launch(cachedPath(`qb${c.pod}|${st.z.toFixed(2)}|${st.m}|${n}`, () => p.reversed()), 2, { pace: PACE.small, size: 6, onArrive: () => { if (--left === 0) respond(st); } }));
    } });
  });
}
function enqueue(q) {
  const t = q.seq % 3;
  if (q.blocks.filter((b) => b.t === t).length < 7) q.blocks.push({ t, z: q.z0 - 0.25, seq: q.seq++ });
  else q.seq++;
}

/* One request through the system. */
function sequence(opts = {}) {
  if (balancer.policy === 2 && opts.lane === undefined && !opts.stop) { for (const lane of [-1, 0, 1]) sequence({ ...opts, lane }); return; }
  const r = Math.random();
  let type = opts.type || (S === 2 ? (r < 0.22 ? 'write' : r < 0.42 ? 'read' : r < 0.58 ? 'query' : r < 0.7 ? 'async' : r < 0.78 ? 'store' : 'compute') : r < 0.4 ? 'write' : 'compute');
  let st = opts.stop || null;
  if (!st) {
    if (type === 'write') st = pick(stops.filter((s) => s.m === 0 && live(s) && (s.kind === 'cab' || s.kind === 'tower') && s.z > plaza.z0 && s.z < plaza.z0 + 3.2)) || nearish(stopsOn(0, ['cab', 'tower']));
    else {
      const kinds = { read: ['cache'], query: ['search'], async: ['queue'], store: ['storage'], compute: ['cab', 'tower'] }[type];
      const lane = opts.lane ?? pickLane();
      st = nearish(stopsOn(lane, kinds)) || nearish(stops.filter((s) => kinds.includes(s.kind) && live(s)));
      if (!st) { type = 'compute'; st = nearish(stopsOn(lane, ['cab', 'tower'])); }
    }
  }
  if (!st) return;
  const t0 = clock;
  request(st, () => {
    hitStop(st, 1);
    const ctx = { ...st, t0 };
    if (type === 'write') after(0.3, () => write(ctx, () => respond(st)));
    else if (type === 'read') cacheRead(st);
    else if (type === 'query') after(0.15, () => scatterGather(st));
    else if (type === 'async') { enqueue(st.comp); after(0.3, () => respond(st)); }
    else after(rand(0.35, 0.55), () => respond(st));
  }, opts);
}

/* Events, slow and quiet: a group drains, a primary fails over, a surge rolls in. */
const ev = { t: still.matches ? Infinity : 16, queue: [] };
const drainable = comps.filter((c) => (c.kind === 'compute' || c.kind === 'tower'));
function setDrain(c, on, ms = 30000) {
  c.drained = on ? 1 : 0;
  clearTimeout(c.timer);
  if (on) c.timer = setTimeout(() => { c.drained = 0; }, ms);
}
function failover(i, ms = 20000) {
  if (plaza.down[i]) { plaza.down[i] = 0; replicate(i); return; }   // a second click: it returns as a replica
  const side = plaza.primary[i];
  plaza.down[i] = side;
  plaza.primary[i] = -side;                     // the replica is promoted
  plaza.parts[`${i}|${-side}`].act = 1;
  clearTimeout(plaza[`t${i}`]);
  plaza[`t${i}`] = setTimeout(() => { if (plaza.down[i] === side) { plaza.down[i] = 0; replicate(i); } }, ms);
}
function nextEvent(forced) {
  if (!ev.queue.length) ev.queue = ['drain', 'failover', 'surge'].sort(() => Math.random() - 0.5);
  const kind = forced || ev.queue.pop();
  if (kind === 'drain') { const c = pick(drainable.filter((c) => !c.drained && c.aabb.max.z > -30)); if (c) setDrain(c, true, 14000); }
  else if (kind === 'failover') { const i = randInt(4); if (!plaza.down[i]) failover(i, 13000); }
  else surgeAt = clock;
  ev.t = rand(17, 23);
}
const surge = (t) => smooth(0, 2.5, t) * (1 - smooth(6, 10, t));

function simulate(dt) {
  clock += dt;
  for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= dt) <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  // A calm cadence: a request every couple of seconds, a little uneven.
  if (!solo && (seqT -= dt * 0.45 * (1 + 0.8 * surge(clock - surgeAt))) <= 0) { seqT = rand(0.85, 1.15); sequence(); }
  for (let i = 0; i < 4; i++) if (!solo && (plaza.replT[i] -= dt) <= 0) { plaza.replT[i] = rand(3.5, 5.5); replicate(i); }
  if (!solo && (ev.t -= dt) <= 0) nextEvent();

  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i], t = clock - p.t0;
    if (p.marks) { const d = distAt(p.tt, t); for (const m of p.marks) if (!m.done && d >= m[0]) { m.done = true; m[1](); } }
    if (!p.arrived && t >= p.tt.T) { p.arrived = true; p.onArrive?.(); }
    if (t > p.tt.T + Math.max(TRAIL, 0.5)) { pulses[i] = pulses[pulses.length - 1]; pulses.pop(); }
  }
  for (let i = ringList.length - 1; i >= 0; i--) if ((ringList[i].age += dt / 0.6) >= 1) ringList.splice(i, 1);
  for (let i = arcList.length - 1; i >= 0; i--) if (arcList[i].fade && clock - arcList[i].fade > 1.2) arcList.splice(i, 1);

  const k1 = Math.exp(-dt * 1.4), k2 = Math.exp(-dt * 2.4);
  for (const c of cabinets) c.act *= k1;
  for (const c of comps) {
    c.act *= c.kind === 'tower' ? Math.exp(-dt * 0.9) : k1;
    c.dim += (c.drained - c.dim) * ease(0.9, dt);
    c.hl += ((c === hovered ? 1 : 0) - c.hl) * ease(8, dt);
  }
  for (const c of services.cache) { for (const cell of c.cells) cell.act *= k2; c.warm = Math.max(0, c.warm - dt / 45); }
  for (const c of services.search) for (const sh of c.shards) sh.act *= k1;
  for (const c of services.storage) for (const t of c.tiers) t.act *= k1;
  for (const w of services.workers) for (const s of w.slabs) s.act *= Math.exp(-dt * 0.9);
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    const d = plaza.parts[`${i}|${side}`];
    d.dim += ((plaza.down[i] === side ? 1 : 0) - d.dim) * ease(0.9, dt);
    d.role += ((plaza.primary[i] === side ? 1 : 0) - d.role) * ease(0.7, dt);
  }
  gateway.act *= k2; balancer.act *= Math.exp(-dt * 2); balancer.ring *= Math.exp(-dt * 1.4);

  // Messages slide along their trough in order; workers take them at the far end.
  for (const q of services.queue) {
    const v = q.flush ? 1.6 : 0.34, end = q.z1 + 0.25;
    for (let t = 0; t < 3; t++) q.blocks.filter((b) => b.t === t).sort((a, b) => a.z - b.z).forEach((b, n) => { b.z = Math.max(end + n * 0.42, b.z - v * dt); });
    if (!solo && (q.prodT = (q.prodT ?? 1) - dt) <= 0) { q.prodT = rand(2.0, 2.8); if (q.blocks.length < 16) enqueue(q); }
    if ((q.drainT = (q.drainT ?? 3) - dt) <= 0) {
      const ready = q.blocks.filter((b) => b.z < end + 0.05);
      if (ready.length) {
        const b = ready.reduce((a, c) => (c.seq < a.seq ? c : a));
        q.blocks.splice(q.blocks.indexOf(b), 1);
        const slab = pick(q.workers.slabs);
        after(0.15, () => { slab.act = 1; });
      }
      if (!q.blocks.length) q.flush = 0;
      q.drainT = q.flush ? 0.25 : 2.6;
    }
  }
}

/* ---------- Writing state to the GPU ---------- */

const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
const setBox = (i, act, dim, hl, node = 0) => { const st = boxState.array; st[i * 4] = act; st[i * 4 + 1] = dim; st[i * 4 + 2] = hl; st[i * 4 + 3] = node; };
function draw() {
  for (const c of comps) for (const i of c.boxes) setBox(i, c.kind === 'tower' ? c.act : 0, c.dim, c.hl, c.node || 0);
  for (const c of cabinets) setBox(c.idx, c.act, c.comp.dim, c.comp.hl);
  setBox(gateway.lintel, gateway.act, 0, gateway.hl);
  for (const c of services.cache) for (const cell of c.cells) setBox(cell.idx, cell.act, c.warm, c.hl);
  for (const c of services.search) for (const sh of c.shards) for (const i of sh.cards) setBox(i, sh.act, 0, c.hl);
  for (const c of services.storage) for (const t of c.tiers) setBox(t.idx, t.act, 0, c.hl);
  for (const w of services.workers) for (const s of w.slabs) setBox(s.idx, s.act, 0, w.hl);
  boxState.needsUpdate = true;

  const cs = cylState.array, ch = cylHl.array;
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    const d = plaza.parts[`${i}|${side}`];
    for (const ci of d.cyls) { const o = ci * 4; cs[o] = d.act; cs[o + 1] = d.dim; cs[o + 2] = d.role; cs[o + 3] = 0; ch[ci] = d.hl; }
  }
  { const o = balancer.idx * 4; cs[o] = balancer.act; cs[o + 1] = balancer.ring; cs[o + 2] = balancer.policy; cs[o + 3] = balancer.port; ch[balancer.idx] = balancer.hl; }
  cylState.needsUpdate = true; cylHl.needsUpdate = true;

  if (N_CABS) {
    const la = leds.arr;
    cabinets.forEach((c, i) => { la.aAct[i] = c.act; la.aDim[i] = c.comp.dim; });
    leds.g.attributes.aAct.needsUpdate = true; leds.g.attributes.aDim.needsUpdate = true;
  }

  let nb = 0;
  const bp = blockPos.array;
  for (const q of services.queue) for (const b of q.blocks) {
    if (nb >= MAX_BLOCKS) break;
    bp.set([q.x + q.troughs[b.t], 0.05 + q.hl * 0.07, b.z], nb * 3); nb++;
  }
  blocks.g.instanceCount = nb;
  blockPos.needsUpdate = true;

  // Comets: the head where the timetable puts it now; the trail where it was a
  // moment ago, sampled evenly in time so it bends with the route.
  const ca = comets.arr, KS = 18;
  let n = 0;
  for (const p of pulses) {
    const t = clock - p.t0;
    if (t < 0) continue;
    const fade = p.alpha * (1 - smooth(p.tt.T, p.tt.T + 0.45, t)) * smooth(0, 0.12, t + (p.tt.rin === 0 ? 1 : 0));
    if (fade < 0.002 || n + KS + 1 > comets.cap) continue;
    for (let k = KS; k >= 1; k--) {
      const tk = t - (k / KS) * TRAIL;
      if (tk < 0) continue;
      p.path.at(p.path.worldAt(distAt(p.tt, tk)), tmp);
      const u = k / KS;
      ca.position.set([tmp.x, tmp.y, tmp.z], n * 3);
      ca.aSize[n] = p.size * (0.9 - 0.4 * u);
      ca.aA[n] = fade * 0.36 * Math.pow(1 - u, 1.3);
      ca.aHead[n] = 0;
      n++;
    }
    p.path.at(p.path.worldAt(distAt(p.tt, t)), tmp);
    ca.position.set([tmp.x, tmp.y, tmp.z], n * 3);
    ca.aSize[n] = p.size; ca.aA[n] = fade; ca.aHead[n] = 1;
    n++;
  }
  comets.commit(n);
  const ra = rings.arr;
  ringList.forEach((r, i) => { ra.position.set([r.x, r.y, r.z], i * 3); ra.aAge[i] = r.age; });
  rings.commit(ringList.length);

  arcs.begin();
  for (const a of arcList) arcs.strip(a.path.p, 0.42 * Math.min(1, (clock - a.born) / 0.3) * (a.fade ? Math.max(0, 1 - (clock - a.fade) / 1.2) : 1));
  arcs.end();
}

/* ---------- Camera, layout and the scrim behind the text ---------- */

// fleet2's view: a long, low drone shot down the aisles; closer and steeper on tall screens.
const CAM = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
let phone = false;
function layoutCamera() {
  phone = innerWidth < 760;
  const t = smooth(0.55, 1.5, innerWidth / innerHeight);
  // On phones, a narrower lens keeps the database above the text and the
  // balancer and gateway clear below it.
  CAM.fov = 37 + 3 * t;
  CAM.pos.set(-2 - 2 * t, 16 - 5 * t, 12 + 6 * t);
  CAM.target.set(0.5 - 8 * t, 0, -4.6 - 9.4 * t);
  const q = debug.get('cam');
  if (q) { const v = q.split(',').map(Number); CAM.pos.set(v[0], v[1], v[2]); CAM.target.set(v[3], v[4], v[5]); if (v[6]) CAM.fov = v[6]; }
  camera.fov = CAM.fov;
  const dist = CAM.pos.distanceTo(CAM.target);
  U.uRefDepth.value = dist;
  // Phones see less of the floor, so the haze starts further back there.
  U.uFogNear.value = dist * (phone ? 0.8 : 0.55);
  U.uFogFar.value = dist * (phone ? 3.2 : 2.5);
  // The screen metric pulses are timed in: the resting view.
  refCam.fov = CAM.fov; refCam.aspect = innerWidth / innerHeight; refCam.near = camera.near; refCam.far = camera.far;
  refCam.position.copy(CAM.pos); refCam.lookAt(CAM.target); refCam.updateProjectionMatrix(); refCam.updateMatrixWorld();
  layoutVersion++;
  paceScale = clamp((innerWidth + innerHeight) / 2340, 0.55, 1.4);
  // Requests enter where the trunk crosses the bottom edge of the screen.
  let lo = Z_GW, hi = CAM.pos.z - 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    _v.set(0, 0, mid).project(refCam);
    if ((1 - _v.y) * 0.5 * innerHeight > innerHeight + 24) hi = mid; else lo = mid;
  }
  Z_START = hi;
  pathCache.clear();
}

let textLines = [];
function measureText() {
  const base = heading.getBoundingClientRect(), lines = [];
  for (const w of heading.querySelectorAll('.word')) {
    const r = w.getBoundingClientRect();
    if (!r.width) continue;
    let line = lines.find((l) => Math.abs(l.top - r.top) < 6);
    if (!line) lines.push((line = { top: r.top, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }));
    line.x0 = Math.min(line.x0, r.left); line.x1 = Math.max(line.x1, r.right);
    line.y0 = Math.min(line.y0, r.top); line.y1 = Math.max(line.y1, r.bottom);
  }
  if (lines.length) textLines = lines.map((l) => ({ x0: l.x0 - base.left, y0: l.y0 - base.top, x1: l.x1 - base.left, y1: l.y1 - base.top }));
}
const scrimBox = { x1: -1e4, y0: -1e4, y1: -1e4 };
let scrimLines = [];
// On phones the text fills most of the screen, so the scrim there is a lighter,
// tighter band: the scene still reads around the words and edges stay half-visible.
const PHONE_SCRIM = { fill: 0.6, edgeCut: 0.5, soft: 1.6, pad: 14, feather: 64 };
let scrimBase = 0.9;
function applyScrimStrength() {
  U.uScrimAmt.value = scrimBase * (phone ? PHONE_SCRIM.fill : 1);
  U.uEdgeCut.value = phone ? PHONE_SCRIM.edgeCut : 1;
  U.uSoftMax.value = phone ? PHONE_SCRIM.soft : 4;
}
function placeScrim() {
  applyScrimStrength();
  if (!textLines.length) return;
  const b = heading.getBoundingClientRect();
  const x1 = b.left + Math.max(...textLines.map((l) => l.x1)), y0 = b.top + Math.min(...textLines.map((l) => l.y0)), y1 = b.top + Math.max(...textLines.map((l) => l.y1));
  if (phone) Object.assign(scrimBox, { x1: 1e5, y0: y0 - PHONE_SCRIM.pad, y1: y1 + PHONE_SCRIM.pad });
  else Object.assign(scrimBox, { x1: x1 + 48, y0: y0 - 52, y1: y1 + 52 });
  U.uScrim.value.set(scrimBox.x1, scrimBox.y0, scrimBox.y1, phone ? 1 : 0);
  scrimLines = textLines.slice(0, 8).map((l, i, all) => ({ x1: b.left + l.x1 + 44, y0: b.top + l.y0 - (i === 0 ? 40 : 16), y1: b.top + l.y1 + (i === all.length - 1 ? 40 : 16) }));
  scrimLines.forEach((l, i) => U.uLines.value[i].set(l.x1, l.y0, l.y1, 0));
  U.uLineN.value = scrimLines.length;
}
// The same shape in script: how far into the scrim a point on screen is (0 = core).
function scrimAt(x, y) {
  if (phone) return clamp(Math.max(scrimBox.y0 - y, y - scrimBox.y1) / PHONE_SCRIM.feather, 0, 1);
  let t = 1;
  for (const l of scrimLines) {
    const r = 30, cy = (l.y0 + l.y1) / 2, hy = (l.y1 - l.y0) / 2;
    const qx = Math.max(x - (l.x1 - r), 0), qy = Math.max(Math.abs(y - cy) - (hy - r), 0);
    const d = Math.hypot(qx, qy) - r;
    t = Math.min(t, d <= 0 ? 0 : clamp(d / (90 + 80 * (qx / Math.max(Math.hypot(qx, qy), 1e-3))), 0, 1));
  }
  return t;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  layoutCamera();
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  U.uRes.value.copy(size);
  U.uDpr.value = renderer.getPixelRatio();
  U.uPxScale.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  measureText();
  placeScrim();
  dirty = true;
}

/* ---------- Pointing and clicking ---------- */

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitV = new THREE.Vector3(), padded = new THREE.Box3();
function aim(x, y) { ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
function floorPoint(x, y) { aim(x, y); return ray.ray.intersectPlane(plane, new THREE.Vector3()); }
function pickAt(x, y) {
  if (scrimAt(x, y) < 0.35) return null;           // nothing to point at behind the text
  aim(x, y);
  const far = U.uFogNear.value + 0.6 * (U.uFogFar.value - U.uFogNear.value);
  let best = null, bestD = Infinity;
  for (const c of comps) {
    padded.copy(c.aabb).expandByScalar(0.1);
    if (!ray.ray.intersectBox(padded, hitV)) continue;
    const d = hitV.distanceTo(ray.ray.origin);
    if (d < bestD && d < far) { bestD = d; best = c; }
  }
  return best;
}
const stopOf = (c) => stops.filter((s) => s.comp === c).sort((a, b) => Math.abs(a.m) - Math.abs(b.m))[0];

let hovered = null, solo = false;
function interact(c, x, y) {
  const at = (n, gap, fn) => { for (let k = 0; k < n; k++) after(k * gap, fn); };
  switch (c?.kind) {
    case 'gateway':   // a burst of requests enters
      gateway.act = 1;
      at(6, 0.35, () => sequence({ type: 'compute', lead: 1.2, fast: true }));
      break;
    case 'balancer':  // cycle the routing policy, and show it
      balancer.policy = (balancer.policy + 1) % POLICIES.length;
      balancer.ring = 1; balancer.act = 1;
      at(2, 0.6, () => sequence({ type: 'compute', lead: 1.2 }));
      break;
    case 'compute': case 'tower':   // drain the group; traffic routes around it
      setDrain(c, !c.drained);
      break;
    case 'drum':      // fail the shard's primary; its replica takes over
      failover(c.i);
      break;
    case 'cache':     // warm it: reads now mostly return early
      c.warm = 1;
      c.cells.forEach((cell, i) => after((i % 6) * 0.05 + Math.floor(i / 6) * 0.04, () => { cell.act = 1; }));
      { const st = stopOf(c); if (st) at(2, 0.7, () => sequence({ type: 'read', stop: st, lead: 1.2 })); }
      break;
    case 'search': { const st = stopOf(c); if (st) scatterGather(st); break; }
    case 'queue': c.flush = 1; c.drainT = 0; break;
    case 'workers': c.slabs.forEach((s, i) => after(i * 0.06, () => { s.act = 1; })); break;
    case 'storage': {
      c.tiers.forEach((t, i) => after(i * 0.16, () => { t.act = 1; }));
      const st = stopOf(c); if (st) sequence({ type: 'store', stop: st, lead: 1.2 });
      break;
    }
    default: {        // empty floor: send requests toward that spot
      const p = floorPoint(x, y);
      if (!p) break;
      const cands = stops.filter((s) => live(s) && (s.kind === 'cab' || s.kind === 'tower' || S === 2));
      const near = cands.sort((a, b) => Math.hypot(aisleX(a.m) - p.x, a.z - p.z) - Math.hypot(aisleX(b.m) - p.x, b.z - p.z)).slice(0, 4);
      at(3, 0.4, () => sequence({ stop: pick(near), type: 'compute', lead: 1.2, fast: true }));
    }
  }
}
const input = { x: 0, y: 0, ex: 0, ey: 0 };
addEventListener('pointermove', (e) => {
  input.x = (e.clientX / innerWidth) * 2 - 1;
  input.y = -((e.clientY / innerHeight) * 2 - 1);
  if (e.pointerType !== 'mouse' || still.matches || heroVis < 0.6) return;
  hovered = e.target.closest('a, button, input, nav') ? null : pickAt(e.clientX, e.clientY);
  document.body.style.cursor = hovered ? 'pointer' : '';
});
addEventListener('click', (e) => {
  if (heroVis < 0.6 || still.matches || e.target.closest('a, button, input, nav')) return;
  if (scrimAt(e.clientX, e.clientY) < 0.35) return;     // the text is not part of the system
  interact(pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
});

/* ---------- Loop ---------- */

const perf = { t: 0, n: 0 };
function adapt(dt) {
  perf.t += dt; perf.n++;
  if (perf.t < 2) return;
  const avg = perf.t / perf.n;
  perf.t = 0; perf.n = 0;
  if (avg > 1 / 45 && ratioStep < RATIOS.length - 1) { renderer.setPixelRatio(RATIOS[++ratioStep]); resize(); }
}
const right = new THREE.Vector3(), lookAt = new THREE.Vector3();
function placeCamera() {
  // Pointer parallax plus a slow drift, as if the drone were holding position.
  const dx = input.ex * 1.1 + Math.sin(clock * 0.05) * 0.6, dy = input.ey * 0.45 + Math.sin(clock * 0.037 + 1) * 0.2;
  right.subVectors(CAM.target, CAM.pos).cross(camera.up).normalize();
  camera.position.copy(CAM.pos).addScaledVector(right, dx).add(tmp.set(0, dy, 0));
  lookAt.copy(CAM.target).addScaledVector(right, dx * 0.25);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();
}
function render() {
  placeScrim();
  U.uTime.value = clock;
  draw();
  renderer.render(scene, camera);
}

let heroVis = 1, last = 0, fade = 0, rec = null;
const fpsLog = [];
const proj = (v) => { v.project(camera); return [+((v.x + 1) * 0.5 * innerWidth).toFixed(2), +((1 - v.y) * 0.5 * innerHeight).toFixed(2)]; };
function frame(now) {
  requestAnimationFrame(frame);
  const box = hero.getBoundingClientRect();
  heroVis = clamp(box.bottom / (innerHeight * 0.85), 0, 1);
  const raw = last ? (now - last) / 1000 : 1 / 60;
  const dt = Math.min(raw, 1 / 20);
  last = now;
  fade += (1 - fade) * ease(still.matches ? 60 : 1.4, dt);
  const shown = heroVis * heroVis;
  canvas.style.opacity = (shown * fade).toFixed(3);
  if (shown < 0.002) { last = 0; if (hovered) { hovered = null; document.body.style.cursor = ''; } return; }
  if (still.matches) { if (dirty) { placeCamera(); render(); dirty = false; } return; }
  input.ex += (input.x - input.ex) * ease(1.5, dt);
  input.ey += (input.y - input.ey) * ease(1.5, dt);
  simulate(dt);
  placeCamera();
  render();
  if (raw < 0.25) { adapt(raw); fpsLog.push(raw); if (fpsLog.length > 240) fpsLog.shift(); }
  if (rec) rec.push({ t: now, c: +clock.toFixed(5), ps: pulses.filter((p) => clock >= p.t0).map((p) => {
    const t = clock - p.t0;
    p.path.at(p.path.worldAt(distAt(p.tt, t)), tmp); const h = proj(tmp);
    p.path.at(p.path.worldAt(distAt(p.tt, Math.max(0, t - TRAIL))), tmp); const tl = proj(tmp);
    return { id: p.id, k: p.kind, h, tl, arr: p.arrived };
  }) });
}

new MutationObserver(readTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
addEventListener('resize', resize);
document.fonts?.ready.then(() => { measureText(); dirty = true; });
setTimeout(() => { measureText(); dirty = true; }, 1600);
readTheme();
resize();
// Start mid-flow, with traffic already moving; reduced motion keeps this one frame.
for (let k = 0; k < 300; k++) simulate(1 / 30);
placeCamera();

requestAnimationFrame(frame);
