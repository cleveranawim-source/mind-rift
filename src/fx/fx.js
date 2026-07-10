// ─── 파티클 · 플로팅 텍스트 · 스크린 셰이크 시스템 ───
import { rand, TAU, clamp } from '../core/math.js';

export const particles = [];
export const floaters = [];   // 데미지 숫자, 골드 등
export const beams = [];      // 레이저/치유 빔
export const decals = [];     // 바닥 흔적 (그을음·균열)
export const corpses = [];    // 죽은 유닛 페이드아웃
export const slashes = [];    // 근접 슬래시 궤적
export const afterimages = []; // 대시 잔상

export const shake = { x: 0, y: 0, power: 0 };

export function addShake(power) {
  shake.power = Math.min(18, shake.power + power);
}

export function updateShake(dt) {
  if (shake.power > 0.1) {
    shake.x = rand(-1, 1) * shake.power;
    shake.y = rand(-1, 1) * shake.power;
    shake.power *= Math.exp(-6 * dt);
  } else {
    shake.x = 0; shake.y = 0; shake.power = 0;
  }
}

// ─── 파티클 ───
export function spawnParticles({ x, y, count = 8, color = '#fff', speed = 120, life = 0.5, size = 3, gravity = 0, glow = false, spread = TAU, angle = 0 }) {
  for (let i = 0; i < count; i++) {
    const a = angle + rand(-spread / 2, spread / 2);
    const s = rand(speed * 0.4, speed);
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rand(life * 0.6, life),
      maxLife: life,
      size: rand(size * 0.6, size * 1.3),
      color, gravity, glow,
    });
  }
}

export function spawnRing(x, y, color, radius = 40, life = 0.4) {
  particles.push({ x, y, vx: 0, vy: 0, life, maxLife: life, size: radius, color, ring: true });
}

export function spawnFloater(x, y, text, { color = '#fff', size = 16, life = 1.0, crit = false } = {}) {
  floaters.push({
    x: x + rand(-12, 12), y,
    h: 0, vy: -60, text, color,
    size: crit ? size * 1.5 : size,
    life, maxLife: life, crit,
  });
}

export function spawnBeam(x1, y1, x2, y2, color, life = 0.3, width = 3) {
  beams.push({ x1, y1, x2, y2, color, life, maxLife: life, width });
}

// 바닥 흔적 (스킬 그을음 등) — 유닛 아래 레이어에 그려짐
export function spawnDecal(x, y, r, color = 'rgba(12,8,5,0.5)', life = 6) {
  decals.push({ x, y, r, color, life, maxLife: life, rot: rand(0, TAU) });
  if (decals.length > 40) decals.shift();
}

// 죽은 유닛 페이드아웃 (스프라이트 유령)
export function spawnCorpse(img, x, y, d, flip, life = 0.9) {
  if (!img) return;
  corpses.push({ img, x, y, d, flip, life, maxLife: life });
  if (corpses.length > 30) corpses.shift();
}

// 근접 슬래시 궤적
export function spawnSlash(x, y, angle, radius, color = '#ffe8c0') {
  slashes.push({ x, y, angle, radius, color, life: 0.18, maxLife: 0.18 });
}

// 대시 잔상
export function spawnAfterimage(img, x, y, d, flip, life = 0.35) {
  if (!img) return;
  afterimages.push({ img, x, y, d, flip, life, maxLife: life });
}

export function updateFX(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (!p.ring) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.gravity || 0) * dt;
      p.vx *= Math.exp(-2 * dt);
      p.vy *= Math.exp(-2 * dt);
    }
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    f.h -= f.vy * dt; // 3D에서는 높이로 상승
    f.vy *= Math.exp(-1.5 * dt);
  }
  for (let i = beams.length - 1; i >= 0; i--) {
    beams[i].life -= dt;
    if (beams[i].life <= 0) beams.splice(i, 1);
  }
  for (const arr of [decals, corpses, slashes, afterimages]) {
    for (let i = arr.length - 1; i >= 0; i--) {
      arr[i].life -= dt;
      if (arr[i].life <= 0) arr.splice(i, 1);
    }
  }
  updateShake(dt);
}

// ─── 유닛 아래 레이어: 데칼 + 시체 + 잔상 (3D 투영) ───
const FS = 0.62; // 지면 원 원근 눌림 비율 (카메라 틸트 고정이라 상수)

// 투영 발산 가드 — 카메라 뒤 좌표는 Infinity가 될 수 있음
const finite = (pt, s) => isFinite(pt.x) && isFinite(pt.y) && isFinite(s) && s > 0;

export function drawUnderFX(ctx, game) {
  const P = (x, y, h = 0) => game.r3d.project(x, y, h);
  const S = (x, y) => game.r3d.worldScaleAt(x, y);
  for (const d of decals) {
    const t = clamp(d.life / d.maxLife, 0, 1);
    const pt = P(d.x, d.y, 1);
    const s = S(d.x, d.y);
    if (!finite(pt, s)) continue;
    ctx.globalAlpha = t * 0.8;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, d.r * s, d.r * s * FS, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const c of corpses) {
    const t = clamp(c.life / c.maxLife, 0, 1);
    const pt = P(c.x, c.y, c.d * 0.3);
    const s = S(c.x, c.y);
    if (!finite(pt, s)) continue;
    ctx.globalAlpha = t * 0.75;
    ctx.save();
    ctx.translate(pt.x, pt.y + (1 - t) * 8);
    if (c.flip) ctx.scale(-1, 1);
    const sz = c.d * s * (0.85 + t * 0.15);
    ctx.drawImage(c.img, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  }
  for (const a of afterimages) {
    const t = clamp(a.life / a.maxLife, 0, 1);
    const pt = P(a.x, a.y, a.d * 0.35);
    const s = S(a.x, a.y);
    if (!finite(pt, s)) continue;
    ctx.globalAlpha = t * 0.45;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    if (a.flip) ctx.scale(-1, 1);
    const sz = a.d * s;
    ctx.drawImage(a.img, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function drawFX(ctx, game) {
  // ── 가산 발광 패스 (3D 투영) ──
  const P = (x, y, h = 0) => game.r3d.project(x, y, h);
  const S = (x, y) => game.r3d.worldScaleAt(x, y);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 빔 (외곽 글로우 + 코어)
  ctx.lineCap = 'round';
  for (const b of beams) {
    const t = b.life / b.maxLife;
    const a = P(b.x1, b.y1, 34), c = P(b.x2, b.y2, 34);
    if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(c.x) || !isFinite(c.y)) continue;
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = t * 0.35;
    ctx.lineWidth = (b.width * t + 1) * 3.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    ctx.globalAlpha = t;
    ctx.lineWidth = b.width * t + 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    ctx.globalAlpha = t * 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = (b.width * t + 1) * 0.4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }

  // 슬래시 궤적 (초승달 호)
  for (const s of slashes) {
    const t = clamp(s.life / s.maxLife, 0, 1);
    const pt = P(s.x, s.y, 26);
    const sc = S(s.x, s.y);
    if (!finite(pt, sc)) continue;
    const sweep = 1.3;
    const prog = 1 - t;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.scale(1, FS);
    ctx.rotate(s.angle - sweep / 2 + sweep * prog);
    ctx.globalAlpha = t * 0.85;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 6 * t + 1;
    ctx.beginPath(); ctx.arc(0, 0, s.radius * sc, -0.55, 0.55); ctx.stroke();
    ctx.globalAlpha = t * 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * t;
    ctx.beginPath(); ctx.arc(0, 0, s.radius * sc, -0.4, 0.4); ctx.stroke();
    ctx.restore();
  }

  // 파티클 (글로우 = 이중 원)
  for (const p of particles) {
    const t = clamp(p.life / p.maxLife, 0, 1);
    const pt = P(p.x, p.y, 18);
    const sc = S(p.x, p.y);
    if (!finite(pt, sc)) continue;
    if (p.ring) {
      const rr = p.size * (1.6 - t * 0.6) * sc;
      ctx.strokeStyle = p.color;
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.scale(1, FS);
      ctx.globalAlpha = t * 0.5;
      ctx.lineWidth = (3 * t + 1) * 2.6;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      ctx.globalAlpha = t;
      ctx.lineWidth = 3 * t + 1;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      ctx.restore();
    } else {
      const r = Math.max(0.1, p.size * t * sc);
      if (p.glow) {
        ctx.globalAlpha = t * 0.32;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, TAU); ctx.fill();
      if (p.glow) {
        ctx.globalAlpha = t * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 0.4, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawFloaters(ctx, game) {
  for (const f of floaters) {
    const t = clamp(f.life / f.maxLife, 0, 1);
    const pt = game.r3d.project(f.x, f.y, 60 + f.h);
    if (!isFinite(pt.x) || !isFinite(pt.y)) continue;
    const sc = clamp(game.r3d.worldScaleAt(f.x, f.y), 0.75, 1.15);
    ctx.globalAlpha = t;
    ctx.font = `${f.crit ? 'bold ' : ''}${Math.round(f.size * sc)}px "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(f.text, pt.x, pt.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, pt.x, pt.y);
  }
  ctx.globalAlpha = 1;
}

export function clearFX() {
  particles.length = 0;
  floaters.length = 0;
  beams.length = 0;
  decals.length = 0;
  corpses.length = 0;
  slashes.length = 0;
  afterimages.length = 0;
  shake.power = 0;
}
