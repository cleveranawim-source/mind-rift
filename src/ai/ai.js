// ─── AI: 영웅 매크로/마이크로 · 미니언 타겟팅 ───
import { dist, clamp, norm } from '../core/math.js';
import { LANES, FOUNTAIN, CAMP_DEFS } from '../world/map.js';
import { castAbility } from '../combat/abilities.js';
import { ITEMS } from '../data/champions.js';

// ─── 라인 진행도 유틸 (파랑→빨강 방향 스칼라) ───
const laneLengths = {};
const laneCumul = {};
for (const [name, pts] of Object.entries(LANES)) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  laneCumul[name] = cum;
  laneLengths[name] = cum[cum.length - 1];
}

export function laneProgress(lane, x, y) {
  const pts = LANES[lane];
  const cum = laneCumul[lane];
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, py = ay + dy * t;
    const d = dist(x, y, px, py);
    if (d < bestD) { bestD = d; best = cum[i] + Math.sqrt(len2) * t; }
  }
  return best;
}

export function lanePoint(lane, prog) {
  const pts = LANES[lane];
  const cum = laneCumul[lane];
  prog = clamp(prog, 0, laneLengths[lane]);
  for (let i = 0; i < pts.length - 1; i++) {
    if (prog <= cum[i + 1]) {
      const segLen = cum[i + 1] - cum[i];
      const t = segLen ? (prog - cum[i]) / segLen : 0;
      return {
        x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1] };
}

// ─── 영웅 AI ───
export function updateHeroAI(hero, game, dt) {
  if (hero.dead || hero.isPlayer) return;

  // 이벤트로 인한 일시 이탈 (포기 선언 등)
  if (hero.afkT > 0) {
    hero.afkT -= dt;
    hero.target = null;
    hero.moveTarget = null;
    return;
  }

  // 마이크로(스킬)는 짧은 주기, 매크로(위치 결정)는 0.3s 주기
  hero.aiMicroT = (hero.aiMicroT || 0) - dt;
  if (hero.aiMicroT <= 0) {
    hero.aiMicroT = 0.35;
    microCombat(hero, game);
  }
  hero.aiT = (hero.aiT || 0) - dt;
  if (hero.aiT > 0) return;
  hero.aiT = 0.3 + Math.random() * 0.15;

  const enemies = game.heroesOfTeam(hero.team === 'blue' ? 'red' : 'blue').filter((h) => !h.dead);
  const nearEnemies = enemies.filter((e) => dist(hero.x, hero.y, e.x, e.y) < 850);
  const hpRatio = hero.hp / hero.maxHp;

  // 분수에 있으면 쇼핑
  const f = FOUNTAIN[hero.team];
  if (dist(hero.x, hero.y, f.x, f.y) < 320) aiShop(hero);

  // ── 생존: 도주 ──
  if (hpRatio < 0.24 && nearEnemies.length) {
    hero.target = null;
    hero.recalling = false;
    const [dx, dy] = norm(hero.x - nearEnemies[0].x, hero.y - nearEnemies[0].y);
    hero.moveTarget = { x: hero.x + dx * 500 + (f.x - hero.x) * 0.15, y: hero.y + dy * 500 + (f.y - hero.y) * 0.15 };
    if (hero.cooldowns.E <= 0) castAbility(hero, 'E', game, { x: f.x, y: f.y });
    return;
  }

  // ── 귀환 판단 ──
  if (hero.recalling) return; // 채널 유지
  if (hpRatio < 0.32 && !nearEnemies.length && dist(hero.x, hero.y, f.x, f.y) > 900) {
    hero.target = null; hero.moveTarget = null;
    hero.recalling = true;
    return;
  }

  // ── 교전 대상 선택 ──
  const killable = nearEnemies.filter((e) => {
    const myPower = hero.hp + hero.effAd() * 6;
    const theirPower = e.hp + e.effAd() * 6;
    return myPower > theirPower * 0.85 || e.hp / e.maxHp < 0.3;
  });
  // 타워 다이브 회피
  const safeTargets = killable.filter((e) => !underEnemyTower(e, hero.team, game) || e.hp / e.maxHp < 0.18);
  if (safeTargets.length) {
    safeTargets.sort((a, b) => a.hp - b.hp);
    hero.target = safeTargets[0];
    return;
  }

  // ── 위험하면 후퇴 ──
  const outnumbered = nearEnemies.length >= 2 && game.heroesOfTeam(hero.team).filter((h) => !h.dead && dist(h.x, h.y, hero.x, hero.y) < 800).length < nearEnemies.length;
  if (outnumbered || (nearEnemies.length && hpRatio < 0.45)) {
    hero.target = null;
    const [dx, dy] = norm(f.x - hero.x, f.y - hero.y);
    hero.moveTarget = { x: hero.x + dx * 420, y: hero.y + dy * 420 };
    return;
  }

  // ── 한타 합류: 근처에서 아군이 싸우는 중 ──
  const allies = game.heroesOfTeam(hero.team).filter((h) => !h.dead && h !== hero);
  for (const a of allies) {
    if (game.time - a.lastDamagedAt < 1.5 && dist(hero.x, hero.y, a.x, a.y) < 1400) {
      const foes = enemies.filter((e) => dist(e.x, e.y, a.x, a.y) < 700);
      if (foes.length) {
        hero.target = foes.sort((x, y) => x.hp - y.hp)[0];
        return;
      }
    }
  }

  // ── 결집 핑 응답 (플레이어와 같은 팀만) ──
  const rally = game.sel?.rallyPoint;
  if (rally && hero.team === game.player.team && game.time < rally.until) {
    if (dist(hero.x, hero.y, rally.x, rally.y) > 320) {
      hero.target = null;
      hero.moveTarget = { x: rally.x + (Math.random() - 0.5) * 160, y: rally.y + (Math.random() - 0.5) * 160 };
      return;
    }
  }

  // ── 역할 수행 ──
  if (hero.champ.lane === 'jungle') jungleMacro(hero, game, enemies);
  else laneMacro(hero, game);
}

function underEnemyTower(unit, myTeam, game) {
  return game.towers.some((t) => t.team !== myTeam && !t.dead && dist(t.x, t.y, unit.x, unit.y) < t.range + 60);
}

// ── 라이너: 프론트라인 유지 + CS ──
function laneMacro(hero, game, laneOverride = null) {
  const lane = laneOverride || (hero.champ.lane === 'jungle' ? 'mid' : hero.champ.lane);
  const sign = hero.team === 'blue' ? 1 : -1;
  const L = laneLengths[lane];

  // 아군 미니언 최전선
  const myMinions = game.minions.filter((m) => m.team === hero.team && m.lane === lane && !m.dead);
  let front;
  if (myMinions.length) {
    const progs = myMinions.map((m) => laneProgress(lane, m.x, m.y));
    front = hero.team === 'blue' ? Math.max(...progs) : Math.min(...progs);
  } else {
    front = hero.team === 'blue' ? L * 0.32 : L * 0.68;
  }

  // 적 타워보다 앞서지 않기
  const enemyTowers = game.towers.filter((t) => t.team !== hero.team && !t.dead && t.lane === lane);
  if (enemyTowers.length) {
    const tProgs = enemyTowers.map((t) => laneProgress(lane, t.x, t.y));
    const nearest = hero.team === 'blue' ? Math.min(...tProgs) : Math.max(...tProgs);
    const hasWaveTanking = myMinions.some((m) => dist(m.x, m.y, lanePoint(lane, nearest).x, lanePoint(lane, nearest).y) < 640);
    if (!hasWaveTanking) {
      front = hero.team === 'blue' ? Math.min(front, nearest - 720) : Math.max(front, nearest + 720);
    }
  }

  // 서포터는 원딜 곁에
  if (hero.champ.id === 'moon') {
    const adc = game.heroesOfTeam(hero.team).find((h) => h.champ.id === 'gale' && !h.dead);
    if (adc && dist(hero.x, hero.y, adc.x, adc.y) > 350) {
      hero.moveTarget = { x: adc.x + 60, y: adc.y + 60 };
      return;
    }
  }

  const standPos = lanePoint(lane, front - sign * 120);

  // CS: 근처 적 유닛 공격 (미니언 → 타워)
  const foes = game.unitsOfTeam(hero.team === 'blue' ? 'red' : 'blue', true)
    .filter((u) => !u.dead && !u.isHero && dist(hero.x, hero.y, u.x, u.y) < 620);
  const minionTargets = foes.filter((u) => u.isMinion);
  const towerTargets = foes.filter((u) => u.isTower && !u.invulnerable);
  const nexusTargets = foes.filter((u) => u.isNexus && !u.invulnerable);

  if (minionTargets.length) {
    minionTargets.sort((a, b) => a.hp - b.hp);
    hero.target = minionTargets[0];
  } else if (towerTargets.length) {
    hero.target = towerTargets[0];
  } else if (nexusTargets.length) {
    hero.target = nexusTargets[0];
  } else if (dist(hero.x, hero.y, standPos.x, standPos.y) > 100) {
    hero.target = null;
    hero.moveTarget = standPos;
  }
}

// ── 정글러: 캠프 사냥 → 갱킹 ──
function jungleMacro(hero, game, enemies) {
  // 갱킹 기회: 우리 진영 쪽 라인의 약한 적
  const gankTarget = enemies.find((e) => e.hp / e.maxHp < 0.5 && dist(hero.x, hero.y, e.x, e.y) < 1300 && !underEnemyTower(e, hero.team, game));
  if (gankTarget && hero.hp / hero.maxHp > 0.5) {
    hero.target = gankTarget;
    return;
  }

  // 마음의 정령 시도 (레벨 5+, 체력 양호)
  if (game.spirit && !game.spirit.dead && hero.level >= 5 && hero.hp / hero.maxHp > 0.65) {
    const alliesNear = game.heroesOfTeam(hero.team).filter((h) => !h.dead && dist(h.x, h.y, game.spirit.x, game.spirit.y) < 900).length;
    if (alliesNear >= 1 && Math.random() < 0.3) {
      hero.target = game.spirit;
      return;
    }
  }

  // 캠프 사냥
  const camps = game.monsters.filter((m) => !m.dead && m.def.side === hero.team);
  if (camps.length) {
    camps.sort((a, b) => dist(hero.x, hero.y, a.x, a.y) - dist(hero.x, hero.y, b.x, b.y));
    hero.target = camps[0];
    return;
  }
  // 캠프 없으면 상대 정글 침입 or 미드 합류
  const enemyCamps = game.monsters.filter((m) => !m.dead && m.def.side !== hero.team);
  if (enemyCamps.length && hero.hp / hero.maxHp > 0.7) {
    enemyCamps.sort((a, b) => dist(hero.x, hero.y, a.x, a.y) - dist(hero.x, hero.y, b.x, b.y));
    hero.target = enemyCamps[0];
    return;
  }
  // 할 일 없으면 미드 합류
  laneMacro(hero, game, 'mid');
}

// ── 마이크로: 스킬 사용 ──
function microCombat(hero, game) {
  if (hero.dead || hero.recalling) return;
  const enemies = game.heroesOfTeam(hero.team === 'blue' ? 'red' : 'blue')
    .filter((h) => !h.dead);
  const nearest = enemies
    .map((e) => ({ e, d: dist(hero.x, hero.y, e.x, e.y) }))
    .sort((a, b) => a.d - b.d)[0];

  const id = hero.champ.id;
  const allies = game.heroesOfTeam(hero.team).filter((h) => !h.dead);

  switch (id) {
    case 'guardian':
      if (nearest && nearest.d < 220) castAbility(hero, 'Q', game, nearest.e);
      if (hero.hp / hero.maxHp < 0.6 && nearest && nearest.d < 500) castAbility(hero, 'W', game, hero);
      break;
    case 'fox':
      if (nearest && nearest.d < 480 && (nearest.e.hp / nearest.e.maxHp < 0.6 || hero.hp / hero.maxHp > 0.7)) {
        castAbility(hero, 'Q', game, nearest.e);
      }
      // 몬스터에게도 Q
      if (hero.target && hero.target.isMonster && dist(hero.x, hero.y, hero.target.x, hero.target.y) < 480) {
        castAbility(hero, 'Q', game, hero.target);
      }
      if (hero.hp / hero.maxHp < 0.75 && hero.target) castAbility(hero, 'W', game, hero);
      break;
    case 'flame':
      if (nearest && nearest.d < 820) castAbility(hero, 'Q', game, { x: nearest.e.x, y: nearest.e.y });
      if (nearest && nearest.d < 680) castAbility(hero, 'W', game, { x: nearest.e.x, y: nearest.e.y });
      break;
    case 'gale':
      if (nearest && nearest.d < 860) castAbility(hero, 'Q', game, { x: nearest.e.x, y: nearest.e.y });
      if (hero.target && (hero.target.isHero || hero.target.isTower)) castAbility(hero, 'W', game, hero);
      break;
    case 'moon': {
      const wounded = allies.filter((a) => a.hp / a.maxHp < 0.72 && dist(hero.x, hero.y, a.x, a.y) < 700);
      if (wounded.length) castAbility(hero, 'Q', game, hero);
      const inDanger = allies.filter((a) => a.hp / a.maxHp < 0.5 && game.time - a.lastDamagedAt < 2 && dist(hero.x, hero.y, a.x, a.y) < 700);
      if (inDanger.length) castAbility(hero, 'W', game, hero);
      // 서포터도 근처 적 공격
      if (!hero.target && nearest && nearest.d < hero.range + 60) hero.target = nearest.e;
      break;
    }
  }
}

// ── AI 상점 ──
const BUILD_ORDER = {
  guardian: ['boots', 'armor', 'sword', 'armor', 'pendant', 'sword', 'armor'],
  fox: ['boots', 'sword', 'sword', 'armor', 'orb', 'sword', 'sword'],
  flame: ['boots', 'orb', 'sword', 'sword', 'orb', 'sword', 'armor'],
  gale: ['boots', 'sword', 'sword', 'sword', 'orb', 'sword', 'armor'],
  moon: ['boots', 'pendant', 'orb', 'armor', 'pendant', 'armor', 'sword'],
};

function aiShop(hero) {
  const order = BUILD_ORDER[hero.champ.id] || [];
  const idx = hero.items.length;
  if (idx >= order.length) return;
  const item = ITEMS.find((i) => i.id === order[idx]);
  if (item && hero.gold >= item.cost) {
    hero.gold -= item.cost;
    hero.addItem(item);
  }
}

// ─── 미니언 타겟팅 ───
export function updateMinionAI(minion, game) {
  if (minion.dead) return;
  // 현재 타겟 유효성
  if (minion.target && (minion.target.dead || dist(minion.x, minion.y, minion.target.x, minion.target.y) > 560)) {
    minion.target = null;
  }
  if (minion.target) return;

  const foes = game.unitsOfTeam(minion.team === 'blue' ? 'red' : 'blue', true);
  let best = null, bestD = Infinity;
  for (const u of foes) {
    if (u.dead || u.invulnerable) continue;
    const d = dist(minion.x, minion.y, u.x, u.y);
    const limit = u.isTower || u.isNexus ? 420 : minion.aggroRange;
    if (d < limit) {
      // 우선순위: 미니언 > 타워/넥서스 > 영웅
      const prio = u.isMinion ? 0 : (u.isTower || u.isNexus) ? 1 : 2;
      const score = prio * 10000 + d;
      if (score < bestD) { bestD = score; best = u; }
    }
  }
  if (best) minion.target = best;
}
