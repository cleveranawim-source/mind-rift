// ─── 유닛: 영웅 · 미니언 · 타워 · 넥서스 · 정글 몬스터 ───
import { dist, clamp, norm, TAU } from '../core/math.js';
import { collideWalls, LANES, FOUNTAIN, NEXUS_POS } from '../world/map.js';
import { dealDamage, spawnProjectile, addBuff } from '../combat/abilities.js';
import { spawnParticles, spawnRing, spawnFloater, spawnSlash, spawnCorpse, addShake } from '../fx/fx.js';
import { SFX } from '../audio/audio.js';
import { SHADOWS } from '../data/champions.js';
import { champArt, shadowArt, drawPortraitCircle, ENV, MON, UNIT, loadImg, imgReady } from '../ui/assets.js';

export const TEAM_COLOR = { blue: '#4a9eff', red: '#ff5555', neutral: '#c8a44a' };

// 스프라이트 변형 캐시 (ctx.filter는 프레임마다 쓰면 치명적으로 느려서 1회만 구움)
const spriteVariantCache = new Map();
function getSpriteVariant(src, variant) {
  const key = src + '|' + variant;
  if (spriteVariantCache.has(key)) return spriteVariantCache.get(key);
  const img = loadImg(src);
  if (!imgReady(img)) return null;
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  if (variant === 'dim') g.fillStyle = 'rgba(70,80,88,0.62)';        // 무적 (탈색)
  else if (variant === 'dead') g.fillStyle = 'rgba(15,18,20,0.78)';  // 잔해 (검게)
  else if (variant === 'flash') g.fillStyle = 'rgba(255,255,255,0.92)'; // 피격 플래시
  g.fillRect(0, 0, cv.width, cv.height);
  spriteVariantCache.set(key, cv);
  return cv;
}

let UID = 1;

// ═══ 기본 유닛 ═══
export class Unit {
  constructor({ x, y, team, radius = 16, hp = 100, ms = 320, range = 150, ad = 20, as = 0.8, armor = 0, regen = 0 }) {
    this.id = UID++;
    this.x = x; this.y = y; this.team = team;
    this.radius = radius;
    this.maxHp = hp; this.hp = hp;
    this.ms = ms; this.range = range; this.ad = ad; this.as = as;
    this.armor = armor; this.regen = regen;
    this.buffs = [];
    this.shield = 0; this.shieldUntil = 0;
    this.target = null;
    this.moveTarget = null;
    this.attackCd = 0;
    this.attackAnim = 0;
    this.facing = Math.random() * TAU;
    this.dead = false;
    this.kind = 'melee';
    this.lastDamagedAt = -99;
  }

  buffVal(prop, base, mode = 'mul') {
    let v = base;
    for (const b of this.buffs) {
      if (b[prop] != null) v = mode === 'mul' ? v * b[prop] : v + b[prop];
    }
    return v;
  }
  effMs() {
    let v = this.buffVal('msMul', this.ms);
    let slow = 0;
    for (const b of this.buffs) if (b.slow) slow = Math.max(slow, b.slow);
    return v * (1 - slow);
  }
  effAs() { return this.buffVal('asMul', this.as); }
  effAd() { return this.ad; }
  effArmor() { return this.armor; }
  effDmgMul() { return this.buffVal('dmgMul', 1); }

  moveToward(tx, ty, dt) {
    const d = dist(this.x, this.y, tx, ty);
    if (d < 4) return true;
    const [nx, ny] = norm(tx - this.x, ty - this.y);
    const step = Math.min(d, this.effMs() * dt);
    this.x += nx * step;
    this.y += ny * step;
    // 각도 랩어라운드 보간
    const targetA = Math.atan2(ny, nx);
    let diff = targetA - this.facing;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    this.facing += diff * Math.min(1, 12 * dt);
    collideWalls(this);
    return false;
  }

  inAttackRange(t) {
    return dist(this.x, this.y, t.x, t.y) <= this.range + this.radius + t.radius;
  }

  performAttack(game) {
    const t = this.target;
    if (!t || t.dead) return;
    this.facing = Math.atan2(t.y - this.y, t.x - this.x);
    this.attackAnim = 0.22;
    if (this.kind === 'ranged') {
      spawnProjectile({
        x: this.x, y: this.y, homing: true, target: t,
        speed: 900, dmg: this.effAd(), source: this, team: this.team,
        color: this.projColor || TEAM_COLOR[this.team], radius: 7,
        trail: false, arrow: this.arrowProj || false,
      });
      if (this === game.player) SFX.attackRanged();
    } else {
      dealDamage(t, this.effAd(), this, game);
      // 슬래시 궤적 + 스파크
      const a = Math.atan2(t.y - this.y, t.x - this.x);
      spawnSlash(this.x + Math.cos(a) * this.radius * 0.6, this.y + Math.sin(a) * this.radius * 0.6, a, this.radius + 26, this.isHero ? '#ffe8c0' : '#e8d8c0');
      spawnParticles({ x: t.x, y: t.y, count: 6, color: '#ffcc88', speed: 130, life: 0.25, size: 3, glow: true });
      if (this === game.player) { SFX.attackMelee(); addShake(1.5); }
      else if (t === game.player) SFX.hit();
    }
    this.attackCd = 1 / this.effAs();
  }

  updateBase(dt, game) {
    // 버프 만료
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].dur -= dt;
      if (this.buffs[i].dur <= 0) this.buffs.splice(i, 1);
    }
    // 보호막 만료
    if (this.shield > 0 && game.time > this.shieldUntil) this.shield = 0;
    // 재생
    if (this.regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
    // 쿨다운
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 타겟 추적 / 공격
    this.moving = false;
    if (this.target && !this.target.dead) {
      if (this.inAttackRange(this.target)) {
        this.facing = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        if (this.attackCd <= 0) this.performAttack(game);
      } else {
        this.moving = !this.moveToward(this.target.x, this.target.y, dt);
      }
    } else {
      this.target = null;
      if (this.moveTarget) {
        if (this.moveToward(this.moveTarget.x, this.moveTarget.y, dt)) this.moveTarget = null;
        else this.moving = true;
      }
    }
  }

  update(dt, game) { this.updateBase(dt, game); }

  drawHpBar(ctx, game, { w = 42, h = 5, dy = null, showMana = false } = {}) {
    if (this.hp >= this.maxHp && !this.isHero && this.shield <= 0) return;
    const x = this.x - w / 2;
    const y = this.y - this.radius - (dy ?? 16);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const ratio = clamp(this.hp / this.maxHp, 0, 1);
    let color;
    if (this === game.player) color = '#3fe5a0';
    else if (this.team === game.player.team) color = '#4a9eff';
    else if (this.team === 'neutral') color = '#c8a44a';
    else color = '#ff5555';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * ratio, h);
    // 체력 구분 눈금 (영웅)
    if (this.isHero) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      for (let v = 200; v < this.maxHp; v += 200) {
        ctx.fillRect(x + (v / this.maxHp) * w, y, 1, h);
      }
    }
    // 보호막
    if (this.shield > 0) {
      const sr = clamp(this.shield / this.maxHp, 0, 1 - ratio + 0.3);
      ctx.fillStyle = 'rgba(200,230,255,0.9)';
      ctx.fillRect(x + w * ratio, y, Math.min(w * sr, w - w * ratio), h);
    }
    if (showMana && this.maxMana) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 1, y + h + 1, w + 2, 3);
      ctx.fillStyle = '#4a7dff';
      ctx.fillRect(x, y + h + 1, w * clamp(this.mana / this.maxMana, 0, 1), 2);
    }
  }
}

// ═══ 영웅 ═══
export class Hero extends Unit {
  constructor(champ, team, { isPlayer = false } = {}) {
    const s = champ.stats;
    super({
      x: FOUNTAIN[team].x, y: FOUNTAIN[team].y, team,
      radius: 22, hp: s.hp, ms: s.ms, range: s.range, ad: s.ad, as: s.as,
      armor: s.armor, regen: s.regen,
    });
    this.isHero = true;
    this.champ = champ;
    this.kind = champ.kind;
    this.isPlayer = isPlayer;
    this.level = 1; this.xp = 0;
    this.gold = 550;
    this.items = [];
    this.itemStats = { ad: 0, hp: 0, armor: 0, ms: 0, regen: 0, cdr: 0, tiltDecay: 0 };
    this.maxMana = s.mp; this.mana = s.mp;
    this.cooldowns = { Q: 0, W: 0, E: 0 };
    this.kills = 0; this.deaths = 0; this.assists = 0; this.cs = 0;
    this.respawnT = 0;
    this.recallT = 0; this.recalling = false;
    this.castFlash = 0;
    this.cdMul = 1;
    this.recentDamagers = new Map();

    // 적팀 = 그림자 군단
    if (team === 'red') {
      const sh = SHADOWS[champ.id];
      this.name = sh.name;
      this.title = sh.title;
      this.color = sh.color;
      this.quote = sh.quote;
    } else {
      this.name = champ.name;
      this.title = champ.title;
      this.color = champ.color;
    }
    this.projColor = this.color;
    this.arrowProj = champ.id === 'gale';
  }

  recomputeStats() {
    const s = this.champ.stats;
    const lv = this.level - 1;
    const it = this.itemStats;
    const oldMax = this.maxHp;
    this.maxHp = s.hp + s.hpPerLv * lv + it.hp;
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - oldMax));
    this.maxMana = s.mp + s.mpPerLv * lv;
    this.ad = s.ad + s.adPerLv * lv + it.ad;
    this.armor = s.armor + s.armorPerLv * lv + it.armor;
    this.ms = s.ms + it.ms;
    this.regen = s.regen + it.regen;
  }

  addItem(item) {
    this.items.push(item);
    for (const [k, v] of Object.entries(item.stats)) {
      this.itemStats[k] = (this.itemStats[k] || 0) + v;
    }
    this.recomputeStats();
  }

  xpToLevel() { return 160 + (this.level - 1) * 110; }

  addXp(amount, game) {
    if (this.level >= 15) return;
    this.xp += amount;
    while (this.xp >= this.xpToLevel() && this.level < 15) {
      this.xp -= this.xpToLevel();
      this.level++;
      this.recomputeStats();
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.12);
      this.mana = Math.min(this.maxMana, this.mana + 60);
      spawnRing(this.x, this.y, '#ffd93d', 60, 0.8);
      spawnParticles({ x: this.x, y: this.y, count: 16, color: '#ffd93d', speed: 120, life: 0.8, size: 4, gravity: -100, glow: true });
      if (this === game.player) {
        SFX.levelUp();
        spawnFloater(this.x, this.y - 50, `레벨 ${this.level}!`, { color: '#ffd93d', size: 20, crit: true });
      }
    }
  }

  addGold(amount, game) {
    this.gold += amount;
    if (this === game.player && amount >= 15) {
      spawnFloater(this.x + 20, this.y - 30, `+${amount}G`, { color: '#ffcf40', size: 13 });
      SFX.gold();
    }
  }

  die(game) {
    this.dead = true;
    this.deaths++;
    // 시체 페이드아웃
    const img = loadImg(UNIT[this.team === 'red' ? `shadow_${this.champ.id}` : this.champ.id]);
    if (imgReady(img)) {
      spawnCorpse(img, this.x, this.y - this.radius * 0.75, this.radius * 4.3, Math.cos(this.facing) < 0, 1.1);
    }
    // 후반으로 갈수록 죽음의 비용이 커진다 (LOL과 동일한 게임 종결 장치)
    this.respawnT = 7 + this.level * 1.35 + Math.min(16, game.time / 75);
    this.target = null; this.moveTarget = null;
    this.recalling = false; this.recallT = 0;
    this.buffs = [];
    spawnParticles({ x: this.x, y: this.y, count: 30, color: this.color, speed: 220, life: 0.9, size: 5, glow: true });
    spawnRing(this.x, this.y, this.color, 70, 0.8);
  }

  respawn(game) {
    this.dead = false;
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.x = FOUNTAIN[this.team].x;
    this.y = FOUNTAIN[this.team].y;
    this.shield = 0;
    spawnRing(this.x, this.y, TEAM_COLOR[this.team], 80, 0.7);
  }

  update(dt, game) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn(game);
      return;
    }
    // 마나 재생
    this.mana = Math.min(this.maxMana, this.mana + (1.4 + this.level * 0.12 + (this.buffVal('mpRegen', 0, 'add'))) * dt);
    // 스킬 쿨다운
    for (const k of ['Q', 'W', 'E']) if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    if (this.castFlash > 0) this.castFlash -= dt;

    // 분수 회복
    const f = FOUNTAIN[this.team];
    if (dist(this.x, this.y, f.x, f.y) < 320) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.07 * dt);
      this.mana = Math.min(this.maxMana, this.mana + this.maxMana * 0.07 * dt);
    }

    // 귀환 채널링
    if (this.recalling) {
      this.target = null; this.moveTarget = null;
      this.recallT += dt;
      if (game.time - this.lastDamagedAt < 0.1) { this.recalling = false; this.recallT = 0; }
      if (this.recallT >= 4.2) {
        this.recalling = false; this.recallT = 0;
        this.x = f.x; this.y = f.y;
        spawnRing(this.x, this.y, TEAM_COLOR[this.team], 90, 0.7);
      }
      return; // 채널 중 이동 불가
    }

    this.updateBase(dt, game);

    // 걷기 먼지
    if (this.moving && Math.random() < dt * 7) {
      spawnParticles({
        x: this.x + (Math.random() - 0.5) * 10, y: this.y + this.radius * 0.5,
        count: 1, color: 'rgba(140,125,95,0.5)', speed: 22, life: 0.5, size: 4.5, gravity: -18,
      });
    }
  }

  draw(ctx, game) {
    if (this.dead) return;
    const r = this.radius;
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + r * 0.55, r * 0.95, r * 0.4, 0, 0, TAU); ctx.fill();

    // 공격 런지
    let ox = 0, oy = 0;
    if (this.attackAnim > 0) {
      const t = this.attackAnim / 0.22;
      const lunge = Math.sin(t * Math.PI) * 7;
      ox = Math.cos(this.facing) * lunge;
      oy = Math.sin(this.facing) * lunge;
    }
    const cx = this.x + ox, cy = this.y + oy;

    // 플레이어 하이라이트
    if (this.isPlayer) {
      ctx.strokeStyle = 'rgba(63,229,160,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(cx, cy, r + 8, game.time * 1.5, game.time * 1.5 + TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 발밑 유닛 링 (LOL식 타원)
    const ringY = this.y + r * 0.55;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(this.x, ringY, r * 1.15, r * 0.5, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = this.isPlayer ? '#3fe5a0' : TEAM_COLOR[this.team];
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(this.x, ringY, r * 1.15, r * 0.5, 0, 0, TAU); ctx.stroke();

    // 본체 — 3D 렌더풍 전신 스프라이트
    const unitKey = this.team === 'red' ? `shadow_${this.champ.id}` : this.champ.id;
    const sprite = loadImg(UNIT[unitKey]);
    const hasSprite = imgReady(sprite);
    if (hasSprite) {
      const d = r * 4.3;
      // 이동 시 발걸음 바운스, 대기 시 잔잔한 숨쉬기
      const bob = this.moving
        ? Math.abs(Math.sin(game.time * 9 + this.id)) * 4.5
        : Math.sin(game.time * 2 + this.id) * 1.5;
      const wobble = this.moving ? Math.sin(game.time * 9 + this.id) * 0.045 : 0;
      ctx.save();
      ctx.translate(cx, cy - r * 0.75 - bob);
      ctx.rotate(wobble);
      if (Math.cos(this.facing) < 0) ctx.scale(-1, 1); // 이동 방향 반전
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d);
      // 피격 화이트 플래시
      if (this.hitFlash > 0) {
        const fv = getSpriteVariant(UNIT[unitKey], 'flash');
        if (fv) {
          ctx.globalAlpha = (this.hitFlash / 0.13) * 0.75;
          ctx.drawImage(fv, -d / 2, -d / 2, d, d);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    } else {
      // 폴백: 초상 토큰
      ctx.strokeStyle = TEAM_COLOR[this.team];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, TAU); ctx.stroke();
      const artSrc = this.team === 'red' ? shadowArt(this.champ.id) : champArt(this.champ.id);
      if (!drawPortraitCircle(ctx, artSrc, cx, cy, r)) {
        const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
        grad.addColorStop(0, this.color);
        grad.addColorStop(1, this.champ.colorDark || '#333');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `bold ${r * 0.75}px "Noto Sans KR", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.name[0], cx, cy + 1);
        ctx.textBaseline = 'alphabetic';
      }
    }

    // 캐스트 플래시
    if (this.castFlash > 0) {
      ctx.globalAlpha = this.castFlash / 0.18;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 보호막 비주얼
    if (this.shield > 0) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#aaddff';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 귀환 채널
    if (this.recalling) {
      const t = this.recallT / 4.2;
      ctx.strokeStyle = TEAM_COLOR[this.team];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * t); ctx.stroke();
      ctx.globalAlpha = 0.3 + Math.sin(game.time * 6) * 0.15;
      ctx.fillStyle = TEAM_COLOR[this.team];
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 14, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 이름표 + 레벨 (전신 스프라이트면 머리 위로 올림)
    const labelDy = hasSprite ? r + 56 : r + 22;
    ctx.font = `bold 12px "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const label = `${this.name} · ${this.level}`;
    ctx.strokeText(label, this.x, this.y - labelDy);
    ctx.fillStyle = this.isPlayer ? '#3fe5a0' : (this.team === game.player.team ? '#bcd8ff' : '#ffb0a8');
    ctx.fillText(label, this.x, this.y - labelDy);

    this.drawHpBar(ctx, game, { w: 54, h: 6, dy: hasSprite ? 52 : 18, showMana: true });
  }
}

// ═══ 미니언 ═══
const MINION_STATS = {
  melee: { hp: 300, ad: 14, range: 55, ms: 285, as: 1.0, radius: 13, gold: 22, xp: 32 },
  caster: { hp: 190, ad: 21, range: 300, ms: 285, as: 0.75, radius: 11, gold: 16, xp: 30 },
  cannon: { hp: 700, ad: 32, range: 320, ms: 270, as: 0.7, radius: 19, gold: 55, xp: 60 },
};

export class Minion extends Unit {
  constructor(type, team, lane, game) {
    const s = MINION_STATS[type];
    // 시간 경과 강화 + 12분 이후 '협곡의 폭풍' 가속 (게임 종결 장치)
    let scale = 1 + Math.floor(game.time / 90) * 0.09;
    if (game.time > 600) scale += (game.time - 600) / 60 * 0.2;
    const wps = team === 'blue' ? LANES[lane] : [...LANES[lane]].reverse();
    super({
      x: wps[0][0] + (Math.random() - 0.5) * 50,
      y: wps[0][1] + (Math.random() - 0.5) * 50,
      team,
      radius: s.radius, hp: s.hp * scale, ms: s.ms, range: s.range,
      ad: s.ad * scale, as: s.as,
    });
    this.isMinion = true;
    this.type = type;
    this.kind = type === 'melee' ? 'melee' : 'ranged';
    this.lane = lane;
    this.waypoints = wps;
    this.wpIndex = 1;
    this.gold = Math.round(s.gold * scale);
    this.xpVal = s.xp;
    this.aggroRange = 300;
  }

  update(dt, game) {
    // 웨이포인트 진행
    if (!this.target || this.target.dead) {
      this.target = null;
      const wp = this.waypoints[this.wpIndex];
      if (wp) {
        if (dist(this.x, this.y, wp[0], wp[1]) < 60) {
          this.wpIndex = Math.min(this.wpIndex + 1, this.waypoints.length - 1);
        }
        this.moveTarget = { x: wp[0], y: wp[1] };
      }
    }
    this.updateBase(dt, game);
  }

  draw(ctx, game) {
    const r = this.radius;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + r * 0.5, r * 0.9, r * 0.35, 0, 0, TAU); ctx.fill();

    // 3D 렌더풍 미니언 스프라이트
    const sprite = loadImg(UNIT[this.team === 'blue' ? 'minion_blue' : 'minion_red']);
    if (imgReady(sprite)) {
      const d = r * (this.type === 'cannon' ? 3.6 : 3.1);
      const bob = Math.abs(Math.sin(game.time * 8 + this.id)) * 2.5;
      ctx.save();
      ctx.translate(this.x, this.y - r * 0.6 - bob);
      if (Math.cos(this.facing) < 0) ctx.scale(-1, 1);
      // 캐스터는 살짝 보라 톤, 대포는 크게
      if (this.type === 'caster') ctx.globalAlpha = 0.92;
      ctx.drawImage(sprite, -d / 2, -d / 2, d, d);
      if (this.hitFlash > 0) {
        const fv = getSpriteVariant(UNIT[this.team === 'blue' ? 'minion_blue' : 'minion_red'], 'flash');
        if (fv) {
          ctx.globalAlpha = (this.hitFlash / 0.13) * 0.75;
          ctx.drawImage(fv, -d / 2, -d / 2, d, d);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      const base = this.team === 'blue' ? '#3a76c4' : '#c44a3a';
      const light = this.team === 'blue' ? '#6aa8e8' : '#e87a6a';
      const grad = ctx.createRadialGradient(this.x - r * 0.3, this.y - r * 0.3, r * 0.15, this.x, this.y, r);
      grad.addColorStop(0, light);
      grad.addColorStop(1, base);
      ctx.fillStyle = grad;
      ctx.beginPath();
      if (this.type === 'cannon') {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.facing);
        ctx.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
        ctx.restore();
      } else {
        ctx.arc(this.x, this.y, r, 0, TAU);
        ctx.fill();
      }
      if (this.type === 'caster') {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.35, 0, TAU); ctx.fill();
      }
    }
    this.drawHpBar(ctx, game, { w: 28, h: 3.5, dy: 22 });
  }
}

// ═══ 타워 ═══
export class Tower extends Unit {
  constructor(def, game) {
    const hp = def.tier === 1 ? 2600 : def.tier === 2 ? 3000 : 3400;
    super({
      x: def.x, y: def.y, team: def.team,
      radius: 42, hp, range: 640, ad: 175, as: 0.8, armor: 40,
    });
    this.isTower = true;
    this.lane = def.lane;
    this.tier = def.tier;
    this.kind = 'ranged';
    this.aggro = null;
  }

  isProtected(game) {
    if (this.tier === 1) return false;
    if (this.tier === 2) {
      return game.towers.some((t) => t.team === this.team && t.lane === this.lane && t.tier === 1 && !t.dead);
    }
    // tier 3 (넥서스 타워): 자기 팀 tier2가 하나라도 파괴되어야 공격 가능
    return !game.towers.some((t) => t.team === this.team && t.tier === 2 && t.dead);
  }

  onDamaged(source, game) {
    // 보호 상태면 데미지 무효화는 dealDamage 전에 처리 (game 쪽에서 invulnerable 갱신)
  }

  update(dt, game) {
    if (this.dead) return;
    this.invulnerable = this.isProtected(game);
    if (this.attackCd > 0) this.attackCd -= dt;

    // 어그로: 유지 → 미니언 우선 → 영웅
    if (this.aggro && (this.aggro.dead || !this.inRange(this.aggro))) this.aggro = null;
    if (!this.aggro) {
      const enemies = game.unitsOfTeam(this.team === 'blue' ? 'red' : 'blue', true)
        .filter((u) => !u.dead && this.inRange(u));
      const minions = enemies.filter((u) => u.isMinion);
      this.aggro = minions[0] || enemies[0] || null;
    }
    if (this.aggro && this.attackCd <= 0) {
      spawnProjectile({
        x: this.x, y: this.y - 30, homing: true, target: this.aggro,
        speed: 750, dmg: this.ad * (this.aggro.isHero ? 1.4 : 1),
        source: this, team: this.team,
        color: this.team === 'blue' ? '#7ab8ff' : '#ff8877', radius: 11,
      });
      this.attackCd = 1 / this.as;
      if (this.aggro === game.player) SFX.towerHit();
    }
  }

  inRange(u) { return dist(this.x, this.y, u.x, u.y) <= this.range; }

  // 영웅이 아군 영웅 공격 시 어그로 전환
  protectAlly(attacker, game) {
    if (!this.dead && attacker.isHero && this.inRange(attacker)) this.aggro = attacker;
  }

  draw(ctx, game) {
    const sprite = loadImg(this.team === 'blue' ? ENV.towerBlue : ENV.towerRed);
    const hasSprite = imgReady(sprite);

    if (this.dead) {
      // 잔해
      const deadSprite = hasSprite ? getSpriteVariant(this.team === 'blue' ? ENV.towerBlue : ENV.towerRed, 'dead') : null;
      if (deadSprite) {
        ctx.globalAlpha = 0.55;
        const w = 130;
        ctx.drawImage(deadSprite, this.x - w / 2, this.y - w * 0.68, w, w);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(60,60,60,0.6)';
        ctx.beginPath(); ctx.arc(this.x, this.y, 30, 0, TAU); ctx.fill();
      }
      return;
    }
    const c = this.team === 'blue' ? '#4a9eff' : '#ff5555';
    const dark = this.team === 'blue' ? '#1a3a66' : '#661a1a';
    // 사거리 표시 (플레이어가 적 타워 근처일 때)
    if (this.team !== game.player.team && !game.player.dead && dist(this.x, this.y, game.player.x, game.player.y) < this.range + 200) {
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(this.x, this.y, this.range, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 받침 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + 22, 52, 22, 0, 0, TAU); ctx.fill();

    if (hasSprite) {
      // AI 스프라이트 타워
      const pulse = 0.75 + Math.sin(game.time * 3 + this.id) * 0.25;
      const w = 150;
      if (this.invulnerable) {
        const dim = getSpriteVariant(this.team === 'blue' ? ENV.towerBlue : ENV.towerRed, 'dim');
        ctx.drawImage(dim || sprite, this.x - w / 2, this.y - w * 0.68, w, w);
      } else {
        ctx.drawImage(sprite, this.x - w / 2, this.y - w * 0.68, w, w);
        // 크리스탈 발광 오버레이
        const gx = this.x, gy = this.y - w * 0.42;
        const grad = ctx.createRadialGradient(gx, gy, 4, gx, gy, 34 * pulse);
        grad.addColorStop(0, this.team === 'blue' ? 'rgba(120,190,255,0.5)' : 'rgba(255,130,110,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(gx, gy, 36 * pulse, 0, TAU); ctx.fill();
      }
    } else {
      // 폴백: 육각 타워
      ctx.fillStyle = dark;
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        const px = this.x + Math.cos(a) * 38;
        const py = this.y + Math.sin(a) * 38;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      const pulse = 0.75 + Math.sin(game.time * 3 + this.id) * 0.25;
      ctx.shadowColor = c;
      ctx.shadowBlur = this.invulnerable ? 4 : 16 * pulse;
      ctx.fillStyle = this.invulnerable ? '#888' : c;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - 26);
      ctx.lineTo(this.x + 11, this.y - 6);
      ctx.lineTo(this.x, this.y + 12);
      ctx.lineTo(this.x - 11, this.y - 6);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }

    this.drawHpBar(ctx, game, { w: 64, h: 6, dy: hasSprite ? 108 : 44 });
  }
}

// ═══ 넥서스 ═══
export class Nexus extends Unit {
  constructor(team, game) {
    super({ x: NEXUS_POS[team].x, y: NEXUS_POS[team].y, team, radius: 58, hp: 3800 });
    this.isNexus = true;
  }
  isProtected(game) {
    return !game.towers.some((t) => t.team === this.team && t.tier === 3 && t.dead);
  }
  update(dt, game) {
    this.invulnerable = this.isProtected(game);
  }
  draw(ctx, game) {
    const c = this.team === 'blue' ? '#4a9eff' : '#ff5555';
    const t = game.time;
    const sprite = loadImg(this.team === 'blue' ? ENV.nexusBlue : ENV.nexusRed);

    if (imgReady(sprite)) {
      // AI 스프라이트 넥서스 (부유 애니메이션 + 발광)
      const bob = Math.sin(t * 1.6) * 5;
      const w = 230;
      // 바닥 발광
      const glow = ctx.createRadialGradient(this.x, this.y + 20, 20, this.x, this.y + 20, 130);
      glow.addColorStop(0, this.team === 'blue' ? 'rgba(74,158,255,0.28)' : 'rgba(255,85,85,0.28)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(this.x, this.y + 20, 130, 0, TAU); ctx.fill();
      if (this.invulnerable) {
        const dim = getSpriteVariant(this.team === 'blue' ? ENV.nexusBlue : ENV.nexusRed, 'dim');
        ctx.drawImage(dim || sprite, this.x - w / 2, this.y - w * 0.62 + bob, w, w);
      } else {
        ctx.drawImage(sprite, this.x - w / 2, this.y - w * 0.62 + bob, w, w);
      }
      // 펄스 링
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.3 + Math.sin(t * 2) * 0.12;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(this.x, this.y, 82 + Math.sin(t * 2) * 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      this.drawHpBar(ctx, game, { w: 90, h: 8, dy: 120 });
      return;
    }

    // 폴백: 회전 다이아 크리스탈
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 68 + Math.sin(t * 2) * 4, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.rotate(t * 0.4);
    const grad = ctx.createLinearGradient(-40, -40, 40, 40);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, c);
    grad.addColorStop(1, this.team === 'blue' ? '#123' : '#311');
    ctx.shadowColor = c;
    ctx.shadowBlur = this.invulnerable ? 8 : 30;
    ctx.fillStyle = this.invulnerable ? '#99a' : grad;
    ctx.beginPath();
    ctx.moveTo(0, -48); ctx.lineTo(34, 0); ctx.lineTo(0, 48); ctx.lineTo(-34, 0);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    this.drawHpBar(ctx, game, { w: 90, h: 8, dy: 66 });
  }
}

// ═══ 정글 몬스터 ═══
export class Monster extends Unit {
  constructor(def, game) {
    super({
      x: def.x, y: def.y, team: 'neutral',
      radius: def.big ? 30 : 20, hp: def.hp, ms: 300,
      range: 140, ad: def.dmg, as: 0.75, armor: 15, regen: 0,
    });
    this.isMonster = true;
    this.def = def;
    this.home = { x: def.x, y: def.y };
    this.leashRange = 550;
  }

  onDamaged(source, game) {
    if (source && source.isHero && !this.returning) this.target = source;
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 리시 (너무 멀어지면 복귀 + 완전 회복)
    if (dist(this.x, this.y, this.home.x, this.home.y) > this.leashRange || (this.target && this.target.dead)) {
      this.target = null;
      this.returning = true;
    }
    this.moving = false;
    if (this.returning) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5 * dt);
      this.moving = !this.moveToward(this.home.x, this.home.y, dt);
      if (!this.moving) this.returning = false;
      return;
    }
    if (this.target && !this.target.dead) {
      if (this.inAttackRange(this.target)) {
        this.facing = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        if (this.attackCd <= 0) this.performAttack(game);
      } else {
        this.moving = !this.moveToward(this.target.x, this.target.y, dt);
      }
    }
  }

  draw(ctx, game) {
    if (this.dead) return;
    const r = this.radius;
    const isSpirit = this.def.id === 'spirit';
    const isSage = this.def.id === 'sage';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + r * 0.5, r, r * 0.4, 0, 0, TAU); ctx.fill();

    let color = '#8a7a4a', light = '#c8b06a';
    if (this.def.buff === 'calm') { color = '#3a6a8a'; light = '#6aa8d8'; }
    if (this.def.buff === 'focus') { color = '#8a3a5a'; light = '#d86a9a'; }
    if (isSpirit) { color = '#3a8a7a'; light = '#7ae8d0'; }
    if (isSage) { color = '#6a4a9a'; light = '#b08ae8'; }

    // AI 스프라이트 (로드 시)
    const sprite = this.def.id ? loadImg(MON[this.def.id]) : null;
    if (sprite && imgReady(sprite)) {
      const d = r * 3.1;
      const bob = (isSpirit || isSage) ? Math.sin(game.time * 1.8 + this.id) * 5 : 0;
      // 대형 오브젝트는 은은한 발광
      if (isSpirit || isSage) {
        const glow = ctx.createRadialGradient(this.x, this.y, r * 0.4, this.x, this.y, r * 2);
        glow.addColorStop(0, isSpirit ? 'rgba(122,232,208,0.30)' : 'rgba(176,138,232,0.30)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(this.x, this.y, r * 2, 0, TAU); ctx.fill();
      }
      ctx.save();
      ctx.translate(this.x, this.y + bob);
      if (Math.cos(this.facing) < 0) ctx.scale(-1, 1); // 이동 방향 따라 좌우 반전
      ctx.drawImage(sprite, -d / 2, -d / 2 - r * 0.35, d, d);
      if (this.hitFlash > 0) {
        const fv = getSpriteVariant(MON[this.def.id], 'flash');
        if (fv) {
          ctx.globalAlpha = (this.hitFlash / 0.13) * 0.7;
          ctx.drawImage(fv, -d / 2, -d / 2 - r * 0.35, d, d);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    } else {
      // 폴백: 그라디언트 원
      const grad = ctx.createRadialGradient(this.x - r * 0.3, this.y - r * 0.3, r * 0.2, this.x, this.y, r);
      grad.addColorStop(0, light);
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const ex = Math.cos(this.facing) * r * 0.35, ey = Math.sin(this.facing) * r * 0.35;
      ctx.beginPath(); ctx.arc(this.x + ex - r * 0.18, this.y + ey, r * 0.11, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(this.x + ex + r * 0.18, this.y + ey, r * 0.11, 0, TAU); ctx.fill();
    }

    // 이름 (가까울 때)
    if (dist(this.x, this.y, game.player.x, game.player.y) < 500) {
      ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(this.def.name, this.x, this.y - r - 20);
      ctx.fillStyle = light;
      ctx.fillText(this.def.name, this.x, this.y - r - 20);
    }
    this.drawHpBar(ctx, game, { w: this.def.big ? 50 : 36, h: 5, dy: 16 });
  }
}
