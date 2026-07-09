// ─── 전투 코어: 데미지 · 투사체 · 스킬 시스템 ───
import { dist, norm, angleTo, TAU, clamp } from '../core/math.js';
import { spawnParticles, spawnRing, spawnFloater, spawnBeam, spawnDecal, spawnAfterimage, addShake } from '../fx/fx.js';
import { SFX } from '../audio/audio.js';
import { DASH } from '../data/champions.js';
import { UNIT, loadImg, imgReady } from '../ui/assets.js';

// 영웅의 전신 스프라이트 (잔상용)
function heroSprite(hero) {
  const img = loadImg(UNIT[hero.team === 'red' ? `shadow_${hero.champ.id}` : hero.champ.id]);
  return imgReady(img) ? img : null;
}
function dashTrail(hero, fromX, fromY, toX, toY, count = 5) {
  const img = heroSprite(hero);
  if (!img) return;
  const flip = toX < fromX;
  for (let k = 0; k < count; k++) {
    const t = k / count;
    spawnAfterimage(img, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t - hero.radius * 0.75, hero.radius * 4.3, flip, 0.2 + t * 0.22);
  }
}

export const projectiles = [];
export const telegraphs = []; // 장판 예고

// ─── 데미지 처리 ───
export function dealDamage(target, amount, source, game, { showAlways = false, color = null } = {}) {
  if (!target || target.dead || target.invulnerable) return 0;

  // 방어력 경감
  const armor = target.effArmor ? target.effArmor() : (target.armor || 0);
  let dmg = amount * (100 / (100 + armor));

  // 팀 버프 (사기 · 정령 · 난이도 보정)
  if (source && source.team && source.team !== 'neutral' && game.teamDmgMul) {
    dmg *= game.teamDmgMul(source.team);
  }
  if (source && source.effDmgMul) dmg *= source.effDmgMul();

  dmg = Math.max(1, Math.round(dmg));

  // 보호막 흡수
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
    if (absorbed > 0) spawnParticles({ x: target.x, y: target.y, count: 4, color: '#aaddff', speed: 80, life: 0.3, size: 3 });
  }

  target.hp -= dmg;
  target.lastDamagedAt = game.time;
  target.lastDamagedBy = source;
  target.hitFlash = 0.13; // 피격 화이트 플래시

  // 어시스트 추적 (영웅만)
  if (target.isHero && source && source.isHero) {
    target.recentDamagers = target.recentDamagers || new Map();
    target.recentDamagers.set(source, game.time);
    // 타워 보호: 아군 영웅을 때린 적 영웅에게 어그로
    if (game.towers) {
      for (const tw of game.towers) {
        if (tw.team === target.team && !tw.dead && tw.protectAlly) tw.protectAlly(source, game);
      }
    }
  }

  // 어그로 훅
  if (target.onDamaged) target.onDamaged(source, game);

  // 데미지 숫자 (플레이어 관련만 크게)
  const player = game.player;
  if (source === player) {
    spawnFloater(target.x, target.y - target.radius - 8, `${dmg}`, { color: '#ffdd66', size: 15 });
  } else if (target === player) {
    spawnFloater(target.x, target.y - target.radius - 8, `-${dmg}`, { color: '#ff5544', size: 16 });
  } else if (showAlways) {
    spawnFloater(target.x, target.y - target.radius - 8, `${dmg}`, { color: color || '#ccc', size: 12 });
  }

  if (target.hp <= 0) {
    target.hp = 0;
    game.onUnitDeath(target, source);
  }
  return dmg;
}

export function applyHeal(target, amount, game) {
  if (!target || target.dead) return;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const healed = Math.round(target.hp - before);
  if (healed > 2) {
    spawnFloater(target.x, target.y - target.radius - 10, `+${healed}`, { color: '#66ff88', size: 14 });
    spawnParticles({ x: target.x, y: target.y, count: 8, color: '#66ff88', speed: 60, life: 0.6, size: 3, gravity: -80, glow: true });
  }
}

export function applyShield(target, amount, dur, game) {
  if (!target || target.dead) return;
  target.shield = Math.max(target.shield, amount);
  target.shieldUntil = game.time + dur;
  spawnRing(target.x, target.y, '#aaddff', target.radius + 12, 0.5);
  SFX.shield();
}

export function addBuff(unit, buff) {
  // 같은 id 갱신
  unit.buffs = unit.buffs.filter((b) => b.id !== buff.id);
  unit.buffs.push({ ...buff });
}

// ─── 투사체 ───
export function spawnProjectile(p) {
  projectiles.push({
    trail: true, hitSet: new Set(), traveled: 0,
    radius: 10, ...p,
  });
}

export function updateProjectiles(dt, game) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const step = p.speed * dt;

    if (p.homing) {
      const t = p.target;
      if (!t || t.dead) { projectiles.splice(i, 1); continue; }
      const d = dist(p.x, p.y, t.x, t.y);
      if (d <= step + t.radius) {
        // 명중
        if (p.onHit) p.onHit(t, game);
        else dealDamage(t, p.dmg, p.source, game);
        spawnParticles({ x: t.x, y: t.y, count: 6, color: p.color, speed: 100, life: 0.3, size: 3, glow: true });
        projectiles.splice(i, 1);
        continue;
      }
      const [nx, ny] = norm(t.x - p.x, t.y - p.y);
      p.x += nx * step; p.y += ny * step;
      p.angle = Math.atan2(ny, nx);
    } else {
      // 직선 (스킬샷)
      p.x += p.dx * step; p.y += p.dy * step;
      p.traveled += step;
      p.angle = Math.atan2(p.dy, p.dx);
      // 적중 판정
      const enemies = game.unitsOfTeam(p.team === 'blue' ? 'red' : 'blue', true);
      let consumed = false;
      for (const u of enemies) {
        if (u.dead || p.hitSet.has(u)) continue;
        if (dist(p.x, p.y, u.x, u.y) < (p.radius || 40) + u.radius) {
          p.hitSet.add(u);
          dealDamage(u, p.dmg, p.source, game);
          spawnParticles({ x: u.x, y: u.y, count: 10, color: p.color, speed: 140, life: 0.35, size: 4, glow: true });
          SFX.hit();
          if (p.source === game.player) addShake(2.5);
          if (!p.pierce) { consumed = true; break; }
        }
      }
      if (consumed || p.traveled >= p.maxDist) {
        if (consumed) projectiles.splice(i, 1);
        else {
          spawnParticles({ x: p.x, y: p.y, count: 5, color: p.color, speed: 60, life: 0.3, size: 3 });
          projectiles.splice(i, 1);
        }
        continue;
      }
    }

    if (p.trail && Math.random() < 0.6) {
      spawnParticles({ x: p.x, y: p.y, count: 1, color: p.color, speed: 20, life: 0.35, size: 3, glow: true });
    }
  }
}

export function drawProjectiles(ctx, game) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of projectiles) {
    const pt = game.r3d.project(p.x, p.y, 38);
    const sc = game.r3d.worldScaleAt(p.x, p.y);
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(p.angle || 0);
    const r = p.radius * 0.85 * sc;
    if (p.arrow) {
      // 바람 화살: 긴 빛줄기 + 화살촉
      const streak = ctx.createLinearGradient(-r * 5.5, 0, 14, 0);
      streak.addColorStop(0, 'rgba(0,0,0,0)');
      streak.addColorStop(1, p.color);
      ctx.strokeStyle = streak;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 5.5, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(16, 0); ctx.lineTo(-8, -5.5); ctx.lineTo(-4, 0); ctx.lineTo(-8, 5.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.lineTo(-2, -2); ctx.lineTo(-2, 2);
      ctx.closePath(); ctx.fill();
    } else {
      // 마법구: 외곽 글로우 → 본색 → 백색 코어 3중 레이어
      const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.6);
      glow.addColorStop(0, p.color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, TAU); ctx.fill();
      // 꼬리
      const tail = ctx.createLinearGradient(-r * 4.5, 0, 0, 0);
      tail.addColorStop(0, 'rgba(0,0,0,0)');
      tail.addColorStop(1, p.color);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = tail;
      ctx.beginPath();
      ctx.moveTo(-r * 4.5, 0);
      ctx.quadraticCurveTo(-r * 1.6, -r * 0.9, 0, -r * 0.75);
      ctx.lineTo(0, r * 0.75);
      ctx.quadraticCurveTo(-r * 1.6, r * 0.9, -r * 4.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.45, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

// ─── 장판 (예고 후 폭발) ───
export function updateTelegraphs(dt, game) {
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const t = telegraphs[i];
    t.t += dt;
    if (t.t >= t.delay) {
      // 폭발
      const enemies = game.unitsOfTeam(t.team === 'blue' ? 'red' : 'blue', true);
      for (const u of enemies) {
        if (!u.dead && dist(t.x, t.y, u.x, u.y) < t.radius + u.radius) {
          dealDamage(u, t.dmg, t.source, game);
        }
      }
      spawnParticles({ x: t.x, y: t.y, count: 30, color: t.color, speed: 280, life: 0.55, size: 5, glow: true });
      spawnParticles({ x: t.x, y: t.y, count: 10, color: '#ffffff', speed: 160, life: 0.3, size: 3, glow: true });
      spawnRing(t.x, t.y, t.color, t.radius, 0.5);
      spawnRing(t.x, t.y, '#ffffff', t.radius * 0.5, 0.3);
      spawnDecal(t.x, t.y, t.radius * 0.6, 'rgba(25,12,8,0.5)', 6);
      if (t.source === game.player || dist(t.x, t.y, game.player.x, game.player.y) < 600) addShake(6);
      SFX.abilityW();
      telegraphs.splice(i, 1);
    }
  }
}

export function drawTelegraphs(ctx, game) {
  const FS = 0.62;
  for (const t of telegraphs) {
    const prog = clamp(t.t / t.delay, 0, 1);
    const pt = game.r3d.project(t.x, t.y, 2);
    const sc = game.r3d.worldScaleAt(t.x, t.y);
    const R = t.radius * sc;
    // 룬 서클: 반대 방향으로 도는 이중 점선 링 (원근 타원)
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.scale(1, FS);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 10]);
    ctx.rotate(game.time * 1.4);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.rotate(-game.time * 2.8);
    ctx.setLineDash([6, 12]);
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // 채워지는 코어
    ctx.rotate(game.time * 1.4);
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.arc(0, 0, R * prog, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ─── 스킬 시전 ───
// slot: 'Q' | 'W' | 'E'  /  aim: { x, y } 월드 좌표 (플레이어=마우스, AI=대상 위치)
export function castAbility(hero, slot, game, aim) {
  if (hero.dead || hero.stunned) return false;
  const def = slot === 'E' ? DASH : hero.champ[slot];
  if (!def) return false;
  if (hero.cooldowns[slot] > 0) return false;
  if (hero.mana < def.mana) return false;

  const lv = hero.level;
  const scale = (base, per) => base + (per || 0) * (lv - 1);
  let success = true;

  switch (slot === 'E' ? 'dash' : def.type) {
    case 'selfAoe': {
      const dmg = scale(def.dmg, def.dmgPerLv);
      const enemies = game.unitsOfTeam(hero.team === 'blue' ? 'red' : 'blue', true);
      let hitAny = false;
      for (const u of enemies) {
        if (!u.dead && dist(hero.x, hero.y, u.x, u.y) < def.radius + u.radius) {
          dealDamage(u, dmg, hero, game);
          addBuff(u, { id: 'slow', dur: def.slowDur, slow: def.slow });
          hitAny = true;
        }
      }
      // 대지 강타: 이중 충격파 + 흙먼지 파편 + 바닥 균열
      spawnRing(hero.x, hero.y, hero.color, def.radius, 0.5);
      spawnRing(hero.x, hero.y, '#fff2d0', def.radius * 0.55, 0.35);
      spawnParticles({ x: hero.x, y: hero.y, count: 22, color: hero.color, speed: 320, life: 0.45, size: 4, glow: true });
      spawnParticles({ x: hero.x, y: hero.y, count: 14, color: '#8a6f4a', speed: 220, life: 0.7, size: 5, gravity: 240 });
      spawnDecal(hero.x, hero.y, def.radius * 0.55, 'rgba(30,22,12,0.45)', 5);
      if (hero === game.player) addShake(hitAny ? 7 : 3);
      SFX.abilityQ();
      break;
    }
    case 'shieldSelf': {
      applyShield(hero, scale(def.amount, def.perLv), def.dur, game);
      break;
    }
    case 'dashStrike': {
      // 범위 내 가장 가까운 적 (영웅 우선)
      const enemies = game.unitsOfTeam(hero.team === 'blue' ? 'red' : 'blue', true)
        .filter((u) => !u.dead && dist(hero.x, hero.y, u.x, u.y) <= def.range);
      if (!enemies.length) { success = false; break; }
      enemies.sort((a, b) => (b.isHero ? 1 : 0) - (a.isHero ? 1 : 0) || dist(hero.x, hero.y, a.x, a.y) - dist(hero.x, hero.y, b.x, b.y));
      const t = enemies[0];
      spawnBeam(hero.x, hero.y, t.x, t.y, hero.color, 0.3, 4);
      const sx0 = hero.x, sy0 = hero.y;
      const a = angleTo(t.x, t.y, hero.x, hero.y);
      hero.x = t.x + Math.cos(a) * (t.radius + hero.radius + 5);
      hero.y = t.y + Math.sin(a) * (t.radius + hero.radius + 5);
      dashTrail(hero, sx0, sy0, hero.x, hero.y, 5);
      dealDamage(t, scale(def.dmg, def.dmgPerLv), hero, game);
      spawnParticles({ x: t.x, y: t.y, count: 14, color: hero.color, speed: 200, life: 0.4, size: 4, glow: true });
      hero.target = t;
      if (hero === game.player) addShake(5);
      SFX.dash(); SFX.hit();
      break;
    }
    case 'insight': {
      addBuff(hero, { id: 'insight', dur: def.dur, msMul: 1 + def.msBoost });
      applyHeal(hero, scale(def.heal, def.healPerLv), game);
      spawnRing(hero.x, hero.y, hero.color, 200, 0.6);
      SFX.buff();
      break;
    }
    case 'skillshot': {
      const [dx, dy] = norm(aim.x - hero.x, aim.y - hero.y);
      // 머즐 플래시
      spawnParticles({ x: hero.x + dx * hero.radius * 1.4, y: hero.y + dy * hero.radius * 1.4, count: 8, color: hero.color, speed: 130, life: 0.25, size: 3.5, glow: true, angle: Math.atan2(dy, dx), spread: 1.1 });
      spawnProjectile({
        x: hero.x + dx * hero.radius, y: hero.y + dy * hero.radius,
        dx, dy, speed: def.speed, maxDist: def.range,
        dmg: scale(def.dmg, def.dmgPerLv), source: hero, team: hero.team,
        color: hero.color, radius: def.radius, pierce: false,
      });
      SFX.abilityQ();
      break;
    }
    case 'pierce': {
      const [dx, dy] = norm(aim.x - hero.x, aim.y - hero.y);
      spawnProjectile({
        x: hero.x + dx * hero.radius, y: hero.y + dy * hero.radius,
        dx, dy, speed: def.speed, maxDist: def.range,
        dmg: scale(def.dmg, def.dmgPerLv), source: hero, team: hero.team,
        color: hero.color, radius: def.width / 2, pierce: true, arrow: true,
      });
      SFX.abilityQ();
      break;
    }
    case 'groundAoe': {
      const d = dist(hero.x, hero.y, aim.x, aim.y);
      const [dx, dy] = norm(aim.x - hero.x, aim.y - hero.y);
      const reach = Math.min(d, def.range);
      telegraphs.push({
        x: hero.x + dx * reach, y: hero.y + dy * reach,
        radius: def.radius, delay: def.delay, t: 0,
        dmg: scale(def.dmg, def.dmgPerLv), source: hero, team: hero.team, color: hero.color,
      });
      SFX.abilityW();
      break;
    }
    case 'frenzy': {
      addBuff(hero, { id: 'frenzy', dur: def.dur, asMul: 1 + def.asBoost, msMul: 1 + def.msBoost });
      spawnRing(hero.x, hero.y, hero.color, 100, 0.5);
      SFX.buff();
      break;
    }
    case 'healAlly': {
      // 자신 포함 범위 내 체력 비율 최저 아군
      const allies = game.heroesOfTeam(hero.team)
        .filter((u) => !u.dead && dist(hero.x, hero.y, u.x, u.y) <= def.range);
      if (!allies.length) { success = false; break; }
      allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      const t = allies[0];
      if (t.hp / t.maxHp > 0.97) { success = false; break; }
      applyHeal(t, scale(def.heal, def.healPerLv), game);
      spawnBeam(hero.x, hero.y, t.x, t.y, '#66ff88', 0.4, 3);
      SFX.heal();
      break;
    }
    case 'shieldAlly': {
      const allies = game.heroesOfTeam(hero.team)
        .filter((u) => !u.dead && dist(hero.x, hero.y, u.x, u.y) <= def.range);
      if (!allies.length) { success = false; break; }
      allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      const t = allies[0];
      applyShield(t, scale(def.amount, def.perLv), def.dur, game);
      spawnBeam(hero.x, hero.y, t.x, t.y, '#aaddff', 0.4, 3);
      break;
    }
    case 'dash': {
      const [dx, dy] = norm(aim.x - hero.x, aim.y - hero.y);
      const sx = hero.x, sy = hero.y;
      hero.x += dx * DASH.dist;
      hero.y += dy * DASH.dist;
      dashTrail(hero, sx, sy, hero.x, hero.y, 6);
      for (let k = 0; k < 8; k++) {
        spawnParticles({
          x: sx + dx * DASH.dist * (k / 8), y: sy + dy * DASH.dist * (k / 8),
          count: 2, color: hero.color, speed: 40, life: 0.4, size: 4, glow: true,
        });
      }
      hero.recallT = 0; // 이동하면 귀환 취소
      SFX.dash();
      break;
    }
    default:
      success = false;
  }

  if (success) {
    const cdMul = (hero.cdMul || 1) * (1 - (hero.itemStats?.cdr || 0));
    hero.cooldowns[slot] = def.cd * cdMul;
    hero.mana -= def.mana;
    hero.castFlash = 0.18;
    hero.recallT = 0;
  }
  return success;
}
