// ─── 마음의 협곡 맵 ───
// 3200×3200 월드. 파랑 기지 좌하단, 빨강 기지 우상단.
// 3개 라인(탑=좌·상단 가장자리, 미드=대각선, 봇=하·우단 가장자리) + 정글 + 강(주대각선).

import { dist, distToSegment, clamp, TAU } from '../core/math.js';
import { ENV, loadImg, imgReady } from '../ui/assets.js';

export const WORLD = 3200;

// ─── 주요 지점 ───
export const NEXUS_POS = {
  blue: { x: 430, y: 2770 },
  red: { x: 2770, y: 430 },
};
export const FOUNTAIN = {
  blue: { x: 240, y: 2960 },
  red: { x: 2960, y: 240 },
};

// 라인 웨이포인트 (파랑 → 빨강 방향)
export const LANES = {
  top: [
    [430, 2770], [440, 2500], [370, 2000], [370, 1300], [400, 650],
    [430, 430], [650, 400], [1300, 370], [2000, 370], [2500, 440], [2770, 430],
  ],
  mid: [
    [430, 2770], [640, 2560], [1100, 2100], [1600, 1600], [2100, 1100], [2560, 640], [2770, 430],
  ],
  bot: [
    [430, 2770], [700, 2760], [900, 2830], [1600, 2830], [2200, 2830], [2550, 2770],
    [2770, 2770], [2830, 2550], [2830, 1600], [2830, 900], [2760, 700], [2770, 430],
  ],
};

// ─── 타워 ───
// tier1(외곽) → tier2(내곽) → tier3(넥서스 타워, 아무 라인 tier2 파괴 시 공격 가능)
function pointReflect([x, y]) { return [WORLD - x, WORLD - y]; }

const BLUE_TOWERS = [
  { lane: 'top', tier: 1, x: 370, y: 1500 },
  { lane: 'top', tier: 2, x: 400, y: 2150 },
  { lane: 'mid', tier: 1, x: 1250, y: 1950 },
  { lane: 'mid', tier: 2, x: 850, y: 2350 },
  { lane: 'bot', tier: 1, x: 1700, y: 2830 },
  { lane: 'bot', tier: 2, x: 1050, y: 2800 },
  { lane: 'mid', tier: 3, x: 590, y: 2610 },
];

export const TOWER_DEFS = [
  ...BLUE_TOWERS.map((t) => ({ ...t, team: 'blue' })),
  ...BLUE_TOWERS.map((t) => {
    const [x, y] = pointReflect([t.x, t.y]);
    // 점대칭 시 탑↔봇 라인이 뒤바뀜
    const lane = t.lane === 'top' ? 'bot' : t.lane === 'bot' ? 'top' : 'mid';
    return { lane, tier: t.tier, x, y, team: 'red' };
  }),
];

// ─── 정글 캠프 ───
const BLUE_CAMPS = [
  { id: 'calm', name: '평정의 골렘', buff: 'calm', x: 850, y: 1780, hp: 900, dmg: 40, gold: 90, xp: 110, big: true },
  { id: 'wolf', name: '잿빛 늑대', buff: null, x: 1250, y: 1560, hp: 550, dmg: 28, gold: 55, xp: 70, big: false },
  { id: 'focus', name: '집중의 사슴', buff: 'focus', x: 1780, y: 2450, hp: 900, dmg: 40, gold: 90, xp: 110, big: true },
  { id: 'boar', name: '가시 멧돼지', buff: null, x: 1520, y: 2130, hp: 550, dmg: 28, gold: 55, xp: 70, big: false },
];
export const CAMP_DEFS = [
  ...BLUE_CAMPS.map((c) => ({ ...c, side: 'blue' })),
  ...BLUE_CAMPS.map((c) => {
    const [x, y] = pointReflect([c.x, c.y]);
    return { ...c, x, y, side: 'red' };
  }),
];

// 강의 대형 오브젝트 — 마음의 정령 (처치 시 팀 전체 버프)
export const SPIRIT_DEF = {
  id: 'spirit', name: '마음의 정령', x: 2120, y: 2120, hp: 2600, dmg: 70,
  gold: 150, xp: 200, spawnAt: 150, respawn: 150, big: true,
};
// 지혜의 수호자 (후반 대형 버프)
export const SAGE_DEF = {
  id: 'sage', name: '지혜의 수호자', x: 1080, y: 1080, hp: 4200, dmg: 110,
  gold: 300, xp: 400, spawnAt: 420, respawn: 210, big: true,
};

// ─── 시드 기반 난수 (지형 결정론) ───
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 숲(벽) 생성 — 거부 샘플링 ───
// 라인·강·캠프·기지에서 충분히 떨어진 곳에만 나무 군락 배치 → 자연스러운 정글 통로가 생김
export const WALLS = [];

function laneClearance(x, y) {
  let min = Infinity;
  for (const lane of Object.values(LANES)) {
    for (let i = 0; i < lane.length - 1; i++) {
      const d = distToSegment(x, y, lane[i][0], lane[i][1], lane[i + 1][0], lane[i + 1][1]);
      if (d < min) min = d;
    }
  }
  return min;
}

function riverClearance(x, y) {
  return distToSegment(x, y, 880, 880, 2320, 2320);
}

(function generateWalls() {
  const rng = mulberry32(20260709);
  const attempts = 900;
  for (let i = 0; i < attempts && WALLS.length < 52; i++) {
    const x = 250 + rng() * (WORLD - 500);
    const y = 250 + rng() * (WORLD - 500);
    const r = 95 + rng() * 45;
    if (laneClearance(x, y) < r + 130) continue;
    if (riverClearance(x, y) < r + 160) continue;
    let bad = false;
    for (const c of CAMP_DEFS) if (dist(x, y, c.x, c.y) < r + 190) { bad = true; break; }
    if (!bad) for (const o of [SPIRIT_DEF, SAGE_DEF]) if (dist(x, y, o.x, o.y) < r + 230) { bad = true; break; }
    if (!bad) for (const f of Object.values(FOUNTAIN)) if (dist(x, y, f.x, f.y) < r + 380) { bad = true; break; }
    if (!bad) for (const n of Object.values(NEXUS_POS)) if (dist(x, y, n.x, n.y) < r + 340) { bad = true; break; }
    if (!bad) for (const w of WALLS) if (dist(x, y, w.x, w.y) < r + w.r + 130) { bad = true; break; }
    if (bad) continue;
    // 군락 내 나무 배치 (장식)
    const trees = [];
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU;
      const rr = rng() * r * 0.6;
      trees.push({ dx: Math.cos(a) * rr, dy: Math.sin(a) * rr, s: 26 + rng() * 26 });
    }
    WALLS.push({ x, y, r, trees });
  }
})();

// ─── 이동 충돌 ───
export function collideWalls(unit) {
  // 맵 경계
  const m = 150;
  unit.x = clamp(unit.x, m, WORLD - m);
  unit.y = clamp(unit.y, m, WORLD - m);
  // 숲 군락 (원형) — 밖으로 밀어냄
  for (const w of WALLS) {
    const dx = unit.x - w.x, dy = unit.y - w.y;
    const d = Math.hypot(dx, dy);
    const min = w.r + unit.radius * 0.6;
    if (d < min && d > 0.001) {
      unit.x = w.x + (dx / d) * min;
      unit.y = w.y + (dy / d) * min;
    }
  }
}

export function isWalled(x, y, pad = 0) {
  for (const w of WALLS) {
    if (dist(x, y, w.x, w.y) < w.r + pad) return true;
  }
  return false;
}

// ─── 수풀 (장식) ───
export const BRUSH = [];
(function generateBrush() {
  const rng = mulberry32(777);
  for (let i = 0; i < 260 && BRUSH.length < 70; i++) {
    const x = 300 + rng() * (WORLD - 600);
    const y = 300 + rng() * (WORLD - 600);
    const lc = laneClearance(x, y);
    if (lc < 110 || lc > 240) continue; // 라인 가장자리에만
    if (isWalled(x, y, 80)) continue;
    BRUSH.push({ x, y, r: 45 + rng() * 30, a: rng() * TAU });
  }
})();

// 타일 패턴 생성 (텍스처 로드 시)
function makePattern(g, src, tile = 640) {
  const img = loadImg(src);
  if (!imgReady(img)) return null;
  const cv = document.createElement('canvas');
  cv.width = tile; cv.height = tile;
  cv.getContext('2d').drawImage(img, 0, 0, tile, tile);
  return g.createPattern(cv, 'repeat');
}

// ─── 지형 렌더링 (오프스크린 1회) ───
// AI 텍스처가 로드되어 있으면 텍스처 기반, 아니면 프로시저럴 폴백
export function renderTerrain() {
  const scale = 0.5;
  const size = WORLD * scale;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.scale(scale, scale);

  const P = {
    ground: makePattern(g, ENV.ground, 720),
    path: makePattern(g, ENV.path, 560),
    water: makePattern(g, ENV.water, 560),
  };
  const trees = {
    a: loadImg(ENV.tree1),
    b: loadImg(ENV.tree2),
  };
  const treesReady = imgReady(trees.a) && imgReady(trees.b);

  // 바닥
  if (P.ground) {
    g.fillStyle = P.ground;
    g.fillRect(0, 0, WORLD, WORLD);
    // 다크 팔레트 유지용 톤 다운
    g.fillStyle = 'rgba(6,14,10,0.42)';
    g.fillRect(0, 0, WORLD, WORLD);
  } else {
    g.fillStyle = '#101f16';
    g.fillRect(0, 0, WORLD, WORLD);
  }

  // 유기적 바닥 얼룩 (텍스처 위에도 옅게 — 깊이감)
  const rng = mulberry32(4242);
  for (let i = 0; i < 700; i++) {
    const x = rng() * WORLD, y = rng() * WORLD, r = 30 + rng() * 130;
    const a = P.ground ? 0.16 : 0.5;
    g.fillStyle = rng() > 0.5 ? `rgba(22,42,30,${a})` : `rgba(10,18,13,${a})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  // 강 (주대각선, 은은한 발광)
  g.save();
  g.lineCap = 'round';
  // 강둑 어두운 테두리
  g.strokeStyle = '#0a1c20';
  g.lineWidth = 340;
  g.beginPath(); g.moveTo(880, 880); g.lineTo(2320, 2320); g.stroke();
  if (P.water) {
    g.strokeStyle = P.water;
    g.lineWidth = 290;
    g.beginPath(); g.moveTo(880, 880); g.lineTo(2320, 2320); g.stroke();
  } else {
    g.strokeStyle = '#174754';
    g.lineWidth = 240;
    g.beginPath(); g.moveTo(880, 880); g.lineTo(2320, 2320); g.stroke();
  }
  g.strokeStyle = 'rgba(64,181,208,0.20)';
  g.lineWidth = 130;
  g.beginPath(); g.moveTo(900, 900); g.lineTo(2300, 2300); g.stroke();
  // 물결 줄무늬
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const cx = 900 + (2300 - 900) * t + (rng() - 0.5) * 120;
    const cy = 900 + (2300 - 900) * t + (rng() - 0.5) * 120;
    g.strokeStyle = 'rgba(120,220,240,0.12)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, 20 + rng() * 30, rng() * TAU, rng() * TAU + 2);
    g.stroke();
  }
  g.restore();

  // 라인 (흙길)
  function drawLane(pts) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    // 길 가장자리 어두운 테두리
    g.strokeStyle = P.path ? '#1a170f' : '#3a3728';
    g.lineWidth = 185;
    g.stroke();
    if (P.path) {
      g.strokeStyle = P.path;
      g.lineWidth = 158;
      g.stroke();
      g.strokeStyle = 'rgba(20,16,8,0.25)';
      g.lineWidth = 158;
      g.stroke();
    } else {
      g.strokeStyle = '#4a4632';
      g.lineWidth = 150;
      g.stroke();
    }
    g.strokeStyle = 'rgba(200,185,120,0.10)';
    g.lineWidth = 60;
    g.stroke();
    g.restore();
  }
  drawLane(LANES.top);
  drawLane(LANES.mid);
  drawLane(LANES.bot);

  // 캠프 공터
  for (const c of CAMP_DEFS) {
    g.fillStyle = 'rgba(60,55,40,0.55)';
    g.beginPath(); g.arc(c.x, c.y, c.big ? 130 : 105, 0, TAU); g.fill();
  }
  // 오브젝트 웅덩이
  for (const o of [SPIRIT_DEF, SAGE_DEF]) {
    g.fillStyle = 'rgba(20,50,60,0.8)';
    g.beginPath(); g.arc(o.x, o.y, 170, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(100,200,220,0.3)';
    g.lineWidth = 6;
    g.stroke();
  }

  // 기지 플랫폼
  function drawBase(cx, cy, color, glow) {
    g.save();
    const grad = g.createRadialGradient(cx, cy, 40, cx, cy, 420);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, 420, 0, TAU); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(cx, cy, 300, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 8;
    g.beginPath(); g.arc(cx, cy, 300, 0, TAU); g.stroke();
    g.restore();
  }
  drawBase(NEXUS_POS.blue.x, NEXUS_POS.blue.y, '#16233d', 'rgba(70,120,255,0.18)');
  drawBase(NEXUS_POS.red.x, NEXUS_POS.red.y, '#3d1616', 'rgba(255,80,70,0.18)');
  // 분수대
  for (const [team, f] of Object.entries(FOUNTAIN)) {
    g.fillStyle = team === 'blue' ? 'rgba(80,140,255,0.35)' : 'rgba(255,90,80,0.35)';
    g.beginPath(); g.arc(f.x, f.y, 150, 0, TAU); g.fill();
  }

  // 수풀 (텍스처 위에서는 은은하게)
  const brushA = P.ground ? 0.30 : 0.75;
  for (const b of BRUSH) {
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.a);
    g.fillStyle = `rgba(34,74,40,${brushA})`;
    g.beginPath();
    g.ellipse(0, 0, b.r * 1.3, b.r * 0.8, 0, 0, TAU);
    g.fill();
    g.fillStyle = `rgba(52,110,54,${brushA * 0.55})`;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse((i - 2) * b.r * 0.35, (i % 2) * 10 - 5, b.r * 0.3, b.r * 0.5, (i - 2) * 0.3, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  // 숲 군락 (그림자 → 나무)
  for (const w of WALLS) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(w.x + 10, w.y + 14, w.r, 0, TAU); g.fill();
  }
  if (treesReady) {
    // AI 나무 스프라이트 스탬핑
    WALLS.forEach((w, i) => {
      const img = i % 2 === 0 ? trees.a : trees.b;
      const d = w.r * 2.55;
      g.save();
      g.translate(w.x, w.y);
      g.rotate((i * 2.399) % TAU); // 골든앵글 회전으로 반복감 제거
      g.drawImage(img, -d / 2, -d / 2, d, d);
      g.restore();
    });
  } else {
    for (const w of WALLS) {
      g.fillStyle = '#0c1a10';
      g.beginPath(); g.arc(w.x, w.y, w.r, 0, TAU); g.fill();
      for (const t of w.trees) {
        const tx = w.x + t.dx, ty = w.y + t.dy;
        g.fillStyle = '#15301c';
        g.beginPath(); g.arc(tx, ty, t.s, 0, TAU); g.fill();
        g.fillStyle = '#1f4527';
        g.beginPath(); g.arc(tx - t.s * 0.25, ty - t.s * 0.3, t.s * 0.55, 0, TAU); g.fill();
        g.fillStyle = 'rgba(90,180,100,0.25)';
        g.beginPath(); g.arc(tx - t.s * 0.35, ty - t.s * 0.42, t.s * 0.25, 0, TAU); g.fill();
      }
    }
  }

  // 맵 테두리 (절벽)
  g.strokeStyle = '#050906';
  g.lineWidth = 220;
  g.strokeRect(0, 0, WORLD, WORLD);
  g.strokeStyle = 'rgba(120,200,140,0.08)';
  g.lineWidth = 6;
  g.strokeRect(120, 120, WORLD - 240, WORLD - 240);

  return cv;
}
