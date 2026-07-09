// ─── 파티클 · 플로팅 텍스트 · 스크린 셰이크 시스템 ───
import { rand, TAU, clamp } from '../core/math.js';

export const particles = [];
export const floaters = [];   // 데미지 숫자, 골드 등
export const beams = [];      // 레이저/치유 빔

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
    vy: -60, text, color,
    size: crit ? size * 1.5 : size,
    life, maxLife: life, crit,
  });
}

export function spawnBeam(x1, y1, x2, y2, color, life = 0.3, width = 3) {
  beams.push({ x1, y1, x2, y2, color, life, maxLife: life, width });
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
    f.y += f.vy * dt;
    f.vy *= Math.exp(-1.5 * dt);
  }
  for (let i = beams.length - 1; i >= 0; i--) {
    beams[i].life -= dt;
    if (beams[i].life <= 0) beams.splice(i, 1);
  }
  updateShake(dt);
}

export function drawFX(ctx) {
  // 빔
  for (const b of beams) {
    const t = b.life / b.maxLife;
    ctx.globalAlpha = t;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width * t + 1;
    ctx.lineCap = 'round';
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // 파티클
  for (const p of particles) {
    const t = clamp(p.life / p.maxLife, 0, 1);
    ctx.globalAlpha = t;
    if (p.ring) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * t + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.6), 0, TAU);
      ctx.stroke();
    } else {
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
}

export function drawFloaters(ctx) {
  for (const f of floaters) {
    const t = clamp(f.life / f.maxLife, 0, 1);
    ctx.globalAlpha = t;
    ctx.font = `${f.crit ? 'bold ' : ''}${Math.round(f.size)}px "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

export function clearFX() {
  particles.length = 0;
  floaters.length = 0;
  beams.length = 0;
  shake.power = 0;
}
