// ─── AI 아트 에셋 로더 ───
import { CHAMPIONS } from '../data/champions.js';

export const ART_BASE = './assets/art/';
export const champArt = (id) => `${ART_BASE}champ_${id}.jpg`;
export const shadowArt = (id) => `${ART_BASE}shadow_${id}.jpg`;
export const splashArt = `${ART_BASE}splash.jpg`;

// 환경 에셋 (지형 텍스처 · 구조물 스프라이트)
export const ENV = {
  ground: `${ART_BASE}env/ground.jpg`,
  path: `${ART_BASE}env/path.jpg`,
  water: `${ART_BASE}env/water.jpg`,
  tree1: `${ART_BASE}env/tree1.png`,
  tree2: `${ART_BASE}env/tree2.png`,
  towerBlue: `${ART_BASE}env/tower_blue.png`,
  towerRed: `${ART_BASE}env/tower_red.png`,
  nexusBlue: `${ART_BASE}env/nexus_blue.png`,
  nexusRed: `${ART_BASE}env/nexus_red.png`,
};
export function envReady() {
  return Object.values(ENV).every((src) => imgReady(loadImg(src)));
}

// 3D 렌더풍 전신 유닛 스프라이트
export const UNIT = {
  guardian: `${ART_BASE}env/unit_guardian.png`,
  fox: `${ART_BASE}env/unit_fox.png`,
  flame: `${ART_BASE}env/unit_flame.png`,
  gale: `${ART_BASE}env/unit_gale.png`,
  moon: `${ART_BASE}env/unit_moon.png`,
  shadow_guardian: `${ART_BASE}env/unit_shadow_guardian.png`,
  shadow_fox: `${ART_BASE}env/unit_shadow_fox.png`,
  shadow_flame: `${ART_BASE}env/unit_shadow_flame.png`,
  shadow_gale: `${ART_BASE}env/unit_shadow_gale.png`,
  shadow_moon: `${ART_BASE}env/unit_shadow_moon.png`,
  minion_blue: `${ART_BASE}env/unit_minion_blue.png`,
  minion_red: `${ART_BASE}env/unit_minion_red.png`,
};

// 몬스터 스프라이트 (지형 렌더와 무관하게 개별 로드)
export const MON = {
  calm: `${ART_BASE}env/mon_calm.png`,
  wolf: `${ART_BASE}env/mon_wolf.png`,
  focus: `${ART_BASE}env/mon_focus.png`,
  boar: `${ART_BASE}env/mon_boar.png`,
  spirit: `${ART_BASE}env/mon_spirit.png`,
  sage: `${ART_BASE}env/mon_sage.png`,
};

const cache = {};
export function loadImg(src) {
  if (!cache[src]) {
    const img = new Image();
    img.src = src;
    cache[src] = img;
  }
  return cache[src];
}
export function imgReady(img) {
  return img && img.complete && img.naturalWidth > 0;
}

// 게임 시작 시 전체 프리로드
export function preloadArt() {
  loadImg(splashArt);
  for (const c of CHAMPIONS) {
    loadImg(champArt(c.id));
    loadImg(shadowArt(c.id));
  }
  for (const src of Object.values(ENV)) loadImg(src);
  for (const src of Object.values(MON)) loadImg(src);
  for (const src of Object.values(UNIT)) loadImg(src);
}

// 원형 클리핑으로 초상 그리기 (캔버스 HUD용) — 얼굴이 위쪽에 있는 2:3 초상 기준 크롭
export function drawPortraitCircle(ctx, src, cx, cy, r) {
  const img = loadImg(src);
  if (!imgReady(img)) return false;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const s = Math.min(iw, ih);
  const sx = (iw - s) / 2;
  const sy = ih > iw ? ih * 0.06 : (ih - s) / 2; // 세로 초상은 얼굴 쪽 크롭
  ctx.drawImage(img, sx, sy, s, s, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  return true;
}
