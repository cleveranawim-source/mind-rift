// ─── 게임 오케스트레이터 ───
import { clamp, dist, TAU } from './core/math.js';
import { WORLD, NEXUS_POS, FOUNTAIN, TOWER_DEFS, CAMP_DEFS, SPIRIT_DEF, SAGE_DEF, renderTerrain } from './world/map.js';
import { Hero, Minion, Tower, Nexus, Monster, TEAM_COLOR } from './entities/units.js';
import { CHAMPIONS } from './data/champions.js';
import { updateProjectiles, drawProjectiles, updateTelegraphs, drawTelegraphs, projectiles, telegraphs, addBuff } from './combat/abilities.js';
import { castAbility } from './combat/abilities.js';
import { updateHeroAI, updateMinionAI } from './ai/ai.js';
import { SelSystem } from './sel/sel.js';
import { updateFX, drawFX, drawFloaters, clearFX, shake, spawnParticles, spawnRing, spawnFloater, addShake } from './fx/fx.js';
import { drawHUD, drawWorldPings, pingWheelSelection, minimapRect } from './ui/hud.js';
import { SFX, startMusic, stopMusic } from './audio/audio.js';

export class Game {
  constructor(canvas, playerChampId, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.time = 0;
    this.timescale = 1;
    this.over = false;
    this.result = null;

    this.terrain = renderTerrain();

    // ── 유닛 생성 ──
    this.heroes = [];
    for (const champ of CHAMPIONS) {
      const isPlayer = champ.id === playerChampId;
      const blue = new Hero(champ, 'blue', { isPlayer });
      this.heroes.push(blue);
      if (isPlayer) this.player = blue;
      this.heroes.push(new Hero(champ, 'red'));
    }
    this.minions = [];
    this.towers = TOWER_DEFS.map((d) => new Tower(d, this));
    this.nexus = { blue: new Nexus('blue', this), red: new Nexus('red', this) };
    this.monsters = [];
    this.campTimers = CAMP_DEFS.map(() => 18); // 첫 스폰 18초
    this.spirit = null;
    this.sage = null;
    this.spiritTimer = SPIRIT_DEF.spawnAt;
    this.sageTimer = SAGE_DEF.spawnAt;

    this.waveTimer = 12;
    this.waveCount = 0;
    this.spawnQueue = [];

    this.teamKills = { blue: 0, red: 0 };
    this.killFeed = [];
    this.announcement = null;
    this.objBanner = null;
    this.teamMods = { blue: {}, red: {} };
    this.lastKill = { time: -99, count: 0 };

    this.sel = new SelSystem(this);

    // ── 카메라 · 입력 ──
    this.vw = 0; this.vh = 0;
    this.zoom = 1;
    this.cam = { x: this.player.x - 600, y: this.player.y - 400 };
    this.input = { mx: 0, my: 0, rightHeld: false, rightHeldT: 0 };

    // 시야 (전장의 안개)
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = 400; this.fogCanvas.height = 400;
    this.fogCtx = this.fogCanvas.getContext('2d');

    this.bindInput();
    this.resize();
    this._raf = null;
    this._last = performance.now();

    this.announce('마음의 협곡에 오신 것을 환영합니다', '#3fe5a0', '그림자 군단의 넥서스를 파괴하세요');
    startMusic();
  }

  // ═══ 입력 ═══
  bindInput() {
    const c = this.canvas;
    this._listeners = [];
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); this._listeners.push([el, ev, fn]); };

    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.input.mx = e.clientX - r.left;
      this.input.my = e.clientY - r.top;
    });
    on(c, 'mousedown', (e) => {
      if (this.over) return;
      if (e.button === 2) {
        this.input.rightHeld = true;
        this.handleRightClick();
      }
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 2) this.input.rightHeld = false;
    });
    on(window, 'keydown', (e) => {
      if (this.over || this.sel.activeEvent) return;
      const k = e.key.toLowerCase();
      if (e.repeat) {
        if (k === ' ') e.preventDefault();
        return;
      }
      const aim = this.getAimWorld();
      if (k === 'q') castAbility(this.player, 'Q', this, aim);
      else if (k === 'w') castAbility(this.player, 'W', this, aim);
      else if (k === 'e') castAbility(this.player, 'E', this, aim);
      else if (k === 'b') {
        if (!this.player.dead && !this.player.recalling) {
          this.player.recalling = true;
          this.player.recallT = 0;
          SFX.recall();
        }
      } else if (k === ' ') {
        e.preventDefault();
        this.sel.startBreath();
      } else if (k === 'g') {
        if (!this.sel.pingWheel) {
          this.sel.pingWheel = { sx: this.input.mx, sy: this.input.my, wx: aim.x, wy: aim.y };
        }
      }
    });
    on(window, 'keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ') {
        if (this.sel.breathing) this.sel.cancelBreath();
      } else if (k === 'g') {
        if (this.sel.pingWheel) {
          const type = pingWheelSelection(this);
          if (type) this.sel.firePing(type, this.sel.pingWheel.wx, this.sel.pingWheel.wy);
          this.sel.pingWheel = null;
        }
      }
    });
    on(window, 'resize', () => this.resize());
  }

  screenToWorld(sx, sy) {
    return { x: this.cam.x + sx / this.zoom, y: this.cam.y + sy / this.zoom };
  }

  // 틸트가 심하면 조준이 흔들린다 (틸트의 체감!)
  getAimWorld() {
    const w = this.screenToWorld(this.input.mx, this.input.my);
    if (this.sel.tiltTier() === 2) {
      w.x += Math.sin(this.time * 13.7) * 26;
      w.y += Math.cos(this.time * 11.3) * 26;
    }
    return w;
  }

  handleRightClick() {
    const p = this.player;
    if (p.dead) return;

    // 미니맵 클릭 → 이동 명령
    const mm = minimapRect(this);
    if (this.input.mx >= mm.x && this.input.mx <= mm.x + mm.s && this.input.my >= mm.y && this.input.my <= mm.y + mm.s) {
      const wx = ((this.input.mx - mm.x) / mm.s) * WORLD;
      const wy = ((this.input.my - mm.y) / mm.s) * WORLD;
      p.target = null;
      p.moveTarget = { x: wx, y: wy };
      p.recalling = false;
      return;
    }

    const w = this.getAimWorld();
    // 적 유닛 클릭 판정
    const clickables = [
      ...this.unitsOfTeam(p.team === 'blue' ? 'red' : 'blue', true),
      ...this.monsters.filter((m) => !m.dead),
    ];
    let best = null, bestD = 45;
    for (const u of clickables) {
      if (u.dead || u.invulnerable) continue;
      const d = dist(w.x, w.y, u.x, u.y) - u.radius;
      if (d < bestD) { bestD = d; best = u; }
    }
    p.recalling = false;
    if (best) {
      p.target = best;
      p.moveTarget = null;
      spawnRing(best.x, best.y, '#ff5544', best.radius + 8, 0.3);
    } else {
      p.target = null;
      p.moveTarget = { x: w.x, y: w.y };
      spawnRing(w.x, w.y, '#3fe5a0', 18, 0.35);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = this.vw * dpr;
    this.canvas.height = this.vh * dpr;
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    this.dpr = dpr;
    this.zoom = clamp(Math.min(this.vw / 1450, this.vh / 900), 0.72, 1.1);
  }

  // ═══ 유닛 조회 ═══
  unitsOfTeam(team, includeStructures = false) {
    const arr = [];
    for (const h of this.heroes) if (h.team === team && !h.dead) arr.push(h);
    for (const m of this.minions) if (m.team === team && !m.dead) arr.push(m);
    if (includeStructures) {
      for (const t of this.towers) if (t.team === team && !t.dead) arr.push(t);
      const n = this.nexus[team];
      if (!n.dead) arr.push(n);
    }
    return arr;
  }
  heroesOfTeam(team) {
    return this.heroes.filter((h) => h.team === team);
  }

  // 팀 데미지 배율: 오브젝트 버프 × 사기(플레이어 팀) / 적팀 약간 핸디캡
  teamDmgMul(team) {
    const tm = this.teamMods[team];
    let m = tm.objDmgMul || 1;
    if (team === this.player.team) m *= 0.94 + this.sel.morale * 0.0012;
    else m *= 0.94; // 중학생 눈높이 난이도 보정
    return m;
  }

  // 시야: 플레이어 팀 유닛 근처만 보임
  isVisible(u) {
    const myTeam = this.player.team;
    if (u.team === myTeam) return true;
    for (const h of this.heroes) {
      if (h.team === myTeam && !h.dead && dist(h.x, h.y, u.x, u.y) < 520) return true;
    }
    for (const m of this.minions) {
      if (m.team === myTeam && !m.dead && dist(m.x, m.y, u.x, u.y) < 400) return true;
    }
    for (const t of this.towers) {
      if (t.team === myTeam && !t.dead && dist(t.x, t.y, u.x, u.y) < 620) return true;
    }
    return false;
  }

  // ═══ 알림 ═══
  announce(text, color = '#e8f4ec', sub = null) {
    this.announcement = { text, color, sub, t: 3.2, dur: 3.2 };
  }
  feed(text, color) {
    this.killFeed.unshift({ text, color, t: 6 });
    if (this.killFeed.length > 5) this.killFeed.pop();
  }
  banner(text) {
    this.objBanner = { text, t: 5 };
  }

  // ═══ 사망 처리 ═══
  onUnitDeath(unit, source) {
    const srcHero = source && source.isHero ? source : (source && source.source && source.source.isHero ? source.source : null);

    if (unit.isMinion) {
      unit.dead = true;
      spawnParticles({ x: unit.x, y: unit.y, count: 8, color: unit.team === 'blue' ? '#6aa8e8' : '#e87a6a', speed: 90, life: 0.4, size: 3 });
      if (srcHero) {
        srcHero.addGold(unit.gold, this);
        srcHero.cs++;
        if (srcHero === this.player) SFX.minionDie();
      }
      // 경험치 분배 (근처 적팀 영웅)
      const xpTeam = unit.team === 'blue' ? 'red' : 'blue';
      const near = this.heroesOfTeam(xpTeam).filter((h) => !h.dead && dist(h.x, h.y, unit.x, unit.y) < 800);
      for (const h of near) h.addXp(unit.xpVal / Math.sqrt(near.length || 1), this);
      return;
    }

    if (unit.isHero) {
      unit.die(this);
      this.teamKills[unit.team === 'blue' ? 'red' : 'blue']++;
      SFX.death();

      // 골드/경험치
      if (srcHero) {
        srcHero.kills++;
        srcHero.addGold(280 + unit.level * 12, this);
        srcHero.addXp(180 + unit.level * 18, this);
      }
      // 어시스트
      if (unit.recentDamagers) {
        for (const [h, t] of unit.recentDamagers) {
          if (h !== srcHero && !h.dead && this.time - t < 10 && h.team !== unit.team) {
            h.assists++;
            h.addGold(140, this);
            h.addXp(100, this);
          }
        }
        unit.recentDamagers.clear();
      }

      // 킬피드
      const killerName = srcHero ? srcHero.name : (source && source.isTower ? '수호 타워' : '협곡');
      this.feed(`${killerName} ⚔ ${unit.name}`, unit.team === this.player.team ? '#ff8877' : '#7de8a8');

      // 플레이어 관련 연출 + SEL
      if (srcHero === this.player) {
        this.lastKill.count = this.time - this.lastKill.time < 9 ? this.lastKill.count + 1 : 1;
        this.lastKill.time = this.time;
        const titles = ['처치!', '더블 킬!', '트리플 킬!', '쿼드라 킬!', '펜타 킬!'];
        this.announce(titles[Math.min(this.lastKill.count - 1, 4)], '#3fe5a0');
        SFX.kill();
        addShake(6);
        this.sel.addMorale(5);
        this.sel.addTilt(-6);
      } else if (unit === this.player) {
        this.sel.addTilt(26, '+멘탈 동요');
        this.sel.addMorale(-5);
        // 그림자의 도발 — 죽음을 SEL 순간으로
        if (srcHero && srcHero.quote) {
          this.announce(`${srcHero.name}: ${srcHero.quote}`, srcHero.color, '그림자의 목소리에 흔들리지 말 것');
        } else {
          this.announce('쓰러졌다…', '#ff8877');
        }
        addShake(9);
      } else if (unit.team === this.player.team) {
        this.sel.addTilt(8);
        this.sel.addMorale(-4);
        if (dist(unit.x, unit.y, this.player.x, this.player.y) < 900) {
          spawnFloater(unit.x, unit.y - 40, `${unit.name}이(가) 쓰러졌다`, { color: '#ff8877', size: 14 });
        }
      } else {
        this.sel.addMorale(4);
      }
      return;
    }

    if (unit.isTower) {
      unit.dead = true;
      SFX.towerDown();
      addShake(8);
      spawnParticles({ x: unit.x, y: unit.y, count: 36, color: TEAM_COLOR[unit.team], speed: 300, life: 0.9, size: 6 });
      spawnRing(unit.x, unit.y, TEAM_COLOR[unit.team], 100, 0.9);
      const enemyTeam = unit.team === 'blue' ? 'red' : 'blue';
      for (const h of this.heroesOfTeam(enemyTeam)) h.addGold(110, this);
      if (unit.team === this.player.team) {
        this.announce('아군 타워 파괴됨', '#ff8877');
        this.sel.addTilt(12, '+타워 상실');
        this.sel.addMorale(-8);
      } else {
        this.announce('적 타워 파괴!', '#3fe5a0');
        this.sel.addMorale(10);
      }
      this.feed(`${unit.team === 'blue' ? '마음팀' : '그림자'} 타워 파괴`, '#ffc247');
      return;
    }

    if (unit.isMonster) {
      unit.dead = true;
      spawnParticles({ x: unit.x, y: unit.y, count: 16, color: '#c8a44a', speed: 160, life: 0.6, size: 4 });
      if (srcHero) {
        srcHero.addGold(unit.def.gold, this);
        srcHero.addXp(unit.def.xp, this);
        // 버프 캠프
        if (unit.def.buff === 'calm') {
          addBuff(srcHero, { id: 'calmBuff', dur: 60, mpRegen: 3 });
          if (srcHero === this.player) {
            this.banner('🧘 평정의 기운 획득 — 멘탈 회복 가속 (60초)');
            SFX.buff();
          }
        } else if (unit.def.buff === 'focus') {
          addBuff(srcHero, { id: 'focusBuff', dur: 60, dmgMul: 1.12 });
          if (srcHero === this.player) {
            this.banner('🎯 집중의 기운 획득 — 공격력 증가 (60초)');
            SFX.buff();
          }
        }
      }
      // 대형 오브젝트 → 팀 버프
      if (unit === this.spirit && srcHero) {
        const team = srcHero.team;
        this.teamMods[team] = { objDmgMul: 1.08, tiltShield: true, until: this.time + 90 };
        this.spiritTimer = SPIRIT_DEF.respawn;
        this.spirit = null;
        this.banner(`✨ ${team === this.player.team ? '우리 팀' : '적 팀'}이 마음의 정령을 획득!`);
        if (team === this.player.team) { this.sel.addMorale(12); this.sel.addTilt(-10); }
        SFX.victory();
      }
      if (unit === this.sage && srcHero) {
        const team = srcHero.team;
        this.teamMods[team] = { ...(this.teamMods[team] || {}), objDmgMul: 1.16, until: this.time + 100 };
        this.sageTimer = SAGE_DEF.respawn;
        this.sage = null;
        this.banner(`👁 ${team === this.player.team ? '우리 팀' : '적 팀'}이 지혜의 수호자를 획득!`);
        if (team === this.player.team) this.sel.addMorale(15);
        SFX.victory();
      }
      return;
    }

    if (unit.isNexus) {
      unit.dead = true;
      this.endGame(unit.team !== this.player.team);
    }
  }

  endGame(victory) {
    if (this.over) return;
    this.over = true;
    this.result = victory ? 'victory' : 'defeat';
    this.timescale = 0.25;
    stopMusic();
    (victory ? SFX.victory : SFX.defeat)();
    addShake(12);
    const nx = victory ? NEXUS_POS.red : NEXUS_POS.blue;
    spawnParticles({ x: nx.x, y: nx.y, count: 80, color: victory ? '#3fe5a0' : '#ff5544', speed: 400, life: 1.5, size: 7, glow: true });
    setTimeout(() => {
      this.timescale = 0;
      if (this.callbacks.onEnd) this.callbacks.onEnd(this);
    }, 2200);
  }

  // ═══ 스폰 ═══
  spawnWave() {
    this.waveCount++;
    const types = ['melee', 'melee', 'melee', 'caster', 'caster'];
    if (this.waveCount % 3 === 0) types.push('cannon');
    for (const lane of ['top', 'mid', 'bot']) {
      types.forEach((type, i) => {
        this.spawnQueue.push({ delay: i * 0.7, type, lane, team: 'blue' });
        this.spawnQueue.push({ delay: i * 0.7, type, lane, team: 'red' });
      });
    }
  }

  updateSpawns(dt) {
    // 미니언 웨이브
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = 26;
      this.spawnWave();
    }
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      s.delay -= dt;
      if (s.delay <= 0) {
        this.minions.push(new Minion(s.type, s.team, s.lane, this));
        this.spawnQueue.splice(i, 1);
      }
    }
    // 정글 캠프
    CAMP_DEFS.forEach((def, i) => {
      const alive = this.monsters.some((m) => m.def === def && !m.dead);
      if (!alive) {
        this.campTimers[i] -= dt;
        if (this.campTimers[i] <= 0) {
          this.monsters.push(new Monster(def, this));
          this.campTimers[i] = 75;
        }
      }
    });
    // 정령 / 수호자
    if (!this.spirit || this.spirit.dead) {
      this.spiritTimer -= dt;
      if (this.spiritTimer <= 0) {
        this.spirit = new Monster(SPIRIT_DEF, this);
        this.monsters.push(this.spirit);
        this.spiritTimer = Infinity;
        this.banner('✨ 마음의 정령이 강에 나타났습니다');
        SFX.event();
      }
    }
    if (!this.sage || this.sage.dead) {
      this.sageTimer -= dt;
      if (this.sageTimer <= 0) {
        this.sage = new Monster(SAGE_DEF, this);
        this.monsters.push(this.sage);
        this.sageTimer = Infinity;
        this.banner('👁 지혜의 수호자가 깨어났습니다');
        SFX.event();
      }
    }
    // 죽은 유닛 정리
    this.minions = this.minions.filter((m) => !m.dead);
    this.monsters = this.monsters.filter((m) => !m.dead);
  }

  // ═══ 업데이트 ═══
  update(rawDt) {
    const dt = Math.min(rawDt, 0.05) * this.timescale;
    if (dt <= 0) {
      updateFX(Math.min(rawDt, 0.05));
      return;
    }
    this.time += dt;

    // 팀 버프 만료
    for (const team of ['blue', 'red']) {
      if (this.teamMods[team].until && this.time > this.teamMods[team].until) this.teamMods[team] = {};
    }
    // 협곡의 폭풍 예고 (12분)
    if (!this.stormAnnounced && this.time > 600) {
      this.stormAnnounced = true;
      this.announce('⛈ 협곡의 폭풍', '#b08ae8', '미니언들이 점점 강해집니다 — 승부의 시간!');
    }

    // 우클릭 홀드 → 이동 갱신
    if (this.input.rightHeld && !this.player.dead) {
      this.input.rightHeldT -= dt;
      if (this.input.rightHeldT <= 0) {
        this.input.rightHeldT = 0.15;
        const mm = minimapRect(this);
        const inMM = this.input.mx >= mm.x && this.input.my >= mm.y;
        if (!inMM && !this.player.target) {
          const w = this.getAimWorld();
          this.player.moveTarget = { x: w.x, y: w.y };
        }
      }
    }

    this.updateSpawns(dt);

    // AI
    for (const h of this.heroes) updateHeroAI(h, this, dt);
    for (const m of this.minions) updateMinionAI(m, this);

    // 유닛 업데이트
    for (const h of this.heroes) h.update(dt, this);
    for (const m of this.minions) m.update(dt, this);
    for (const t of this.towers) t.update(dt, this);
    for (const m of this.monsters) m.update(dt, this);
    this.nexus.blue.update(dt, this);
    this.nexus.red.update(dt, this);

    updateProjectiles(dt, this);
    updateTelegraphs(dt, this);
    this.sel.update(dt);
    updateFX(Math.min(rawDt, 0.05));

    // 패시브 골드
    for (const h of this.heroes) if (!h.dead) h.gold += 1.9 * dt;

    // 알림 타이머
    if (this.announcement) {
      this.announcement.t -= Math.min(rawDt, 0.05);
      if (this.announcement.t <= 0) this.announcement = null;
    }
    if (this.objBanner) this.objBanner.t -= Math.min(rawDt, 0.05);
    for (const f of this.killFeed) f.t -= Math.min(rawDt, 0.05);
    this.killFeed = this.killFeed.filter((f) => f.t > 0);

    // 카메라: 플레이어 추적
    const targetX = this.player.x - this.vw / 2 / this.zoom;
    const targetY = this.player.y - this.vh / 2 / this.zoom;
    const lerpK = 1 - Math.exp(-8 * Math.min(rawDt, 0.05));
    this.cam.x += (targetX - this.cam.x) * lerpK;
    this.cam.y += (targetY - this.cam.y) * lerpK;
    this.cam.x = clamp(this.cam.x, -100, WORLD - this.vw / this.zoom + 100);
    this.cam.y = clamp(this.cam.y, -100, WORLD - this.vh / this.zoom + 100);
  }

  // ═══ 렌더 ═══
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#050906';
    ctx.fillRect(0, 0, this.vw, this.vh);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x + shake.x / this.zoom, -this.cam.y + shake.y / this.zoom);

    // 지형
    ctx.drawImage(this.terrain, 0, 0, WORLD, WORLD);

    // 장판 예고
    drawTelegraphs(ctx, this);
    // 월드 핑
    drawWorldPings(ctx, this);

    // 유닛 (y 정렬)
    const drawables = [];
    for (const t of this.towers) drawables.push(t);
    drawables.push(this.nexus.blue, this.nexus.red);
    for (const m of this.monsters) if (!m.dead) drawables.push(m);
    for (const m of this.minions) if (!m.dead && this.isVisible(m)) drawables.push(m);
    for (const h of this.heroes) if (!h.dead && this.isVisible(h)) drawables.push(h);
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw(ctx, this);

    drawProjectiles(ctx);
    drawFX(ctx);
    drawFloaters(ctx);

    // 전장의 안개
    this.renderFog(ctx);

    ctx.restore();

    // HUD (스크린 좌표)
    drawHUD(ctx, this);
  }

  renderFog(ctx) {
    const fc = this.fogCtx;
    const S = 400;
    const k = S / WORLD;
    fc.clearRect(0, 0, S, S);
    fc.fillStyle = 'rgba(3,7,5,0.72)';
    fc.fillRect(0, 0, S, S);
    fc.globalCompositeOperation = 'destination-out';
    const punch = (x, y, r) => {
      const g = fc.createRadialGradient(x * k, y * k, r * k * 0.55, x * k, y * k, r * k);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = g;
      fc.beginPath();
      fc.arc(x * k, y * k, r * k, 0, TAU);
      fc.fill();
    };
    const myTeam = this.player.team;
    for (const h of this.heroes) if (h.team === myTeam && !h.dead) punch(h.x, h.y, 560);
    for (const m of this.minions) if (m.team === myTeam && !m.dead) punch(m.x, m.y, 420);
    for (const t of this.towers) if (t.team === myTeam && !t.dead) punch(t.x, t.y, 640);
    punch(NEXUS_POS[myTeam].x, NEXUS_POS[myTeam].y, 600);
    fc.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.fogCanvas, 0, 0, WORLD, WORLD);
  }

  // ═══ 루프 ═══
  start() {
    const loop = (now) => {
      const rawDt = (now - this._last) / 1000;
      this._last = now;
      this.update(rawDt);
      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    this._last = performance.now();
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    for (const [el, ev, fn] of this._listeners || []) el.removeEventListener(ev, fn);
    projectiles.length = 0;
    telegraphs.length = 0;
    clearFX();
    stopMusic();
  }
}
