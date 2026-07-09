// ─── AI 아트 에셋 로더 ───
import { CHAMPIONS } from '../data/champions.js';

export const ART_BASE = './assets/art/';
export const champArt = (id) => `${ART_BASE}champ_${id}.jpg`;
export const shadowArt = (id) => `${ART_BASE}shadow_${id}.jpg`;
export const splashArt = `${ART_BASE}splash.jpg`;

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
