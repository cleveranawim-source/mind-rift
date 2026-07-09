// ─── SEL 시스템: 틸트(멘탈) · 심호흡 · 핑 · 선택 이벤트 · 성찰 ───
// 이 게임의 교육적 심장부. 게임 메커니즘 자체가 사회정서기술을 연습하게 만든다.
import { clamp, dist } from '../core/math.js';
import { spawnRing, spawnFloater, spawnParticles } from '../fx/fx.js';
import { SFX } from '../audio/audio.js';
import { addBuff } from '../combat/abilities.js';

export class SelSystem {
  constructor(game) {
    this.game = game;
    // 멘탈 게이지 (플레이어): 0 안정 ~ 100 틸트
    this.tilt = 0;
    this.maxTiltSeen = 0;
    this.tiltFlash = 0; // 게이지 상승 시 시각 효과

    // 팀 사기: 0~100
    this.morale = 60;

    // 심호흡
    this.breathing = false;
    this.breathT = 0;
    this.breathDur = 2.6;
    this.breathCount = 0;

    // 핑
    this.pingWheel = null; // { x, y } 화면 좌표 (열려있을 때)
    this.pings = []; // 월드 마커 { x, y, type, t }
    this.praiseCd = 0;
    this.pingCounts = { danger: 0, retreat: 0, gather: 0, praise: 0 };

    // 이벤트
    this.eventQueue = buildEvents();
    this.activeEvent = null;
    this.firedEvents = new Set();

    // 성찰 점수 (선택 누적)
    this.choiceScores = { 자기: 0, 관계: 0, 공동체: 0, 마음: 0 };
    this.choiceLog = [];
    this.rallyPoint = null;
  }

  // ── 틸트 ──
  addTilt(amount, reason = '') {
    const shielded = this.game.teamMods?.[this.game.player.team]?.tiltShield;
    if (shielded && amount > 0) amount *= 0.5;
    this.tilt = clamp(this.tilt + amount, 0, 100);
    if (amount > 0) {
      this.tiltFlash = 0.8;
      if (reason) spawnFloater(this.game.player.x, this.game.player.y - 60, reason, { color: '#ff8866', size: 13 });
    }
    this.maxTiltSeen = Math.max(this.maxTiltSeen, this.tilt);
  }

  tiltTier() {
    return this.tilt >= 70 ? 2 : this.tilt >= 40 ? 1 : 0;
  }

  addMorale(amount) {
    this.morale = clamp(this.morale + amount, 0, 100);
  }

  // ── 심호흡 ──
  startBreath() {
    const p = this.game.player;
    if (this.breathing || p.dead || this.tilt < 8) return;
    this.breathing = true;
    this.breathT = 0;
    p.target = null;
    p.moveTarget = null;
    SFX.breathe();
  }
  cancelBreath() {
    this.breathing = false;
    this.breathT = 0;
  }
  updateBreath(dt) {
    if (!this.breathing) return;
    const p = this.game.player;
    // 피격·이동·사망 시 취소
    if (p.dead || p.moveTarget || p.target || this.game.time - p.lastDamagedAt < 0.15) {
      this.cancelBreath();
      return;
    }
    this.breathT += dt;
    if (this.breathT >= this.breathDur) {
      this.breathing = false;
      this.breathCount++;
      this.addTilt(-38);
      spawnRing(p.x, p.y, '#3fe5a0', 90, 1.0);
      spawnParticles({ x: p.x, y: p.y, count: 18, color: '#3fe5a0', speed: 80, life: 1.0, size: 4, gravity: -60, glow: true });
      spawnFloater(p.x, p.y - 60, '마음이 가라앉는다…', { color: '#3fe5a0', size: 15 });
      SFX.breatheDone();
    }
  }

  // ── 핑 ──
  firePing(type, wx, wy) {
    const game = this.game;
    this.pings.push({ x: wx, y: wy, type, t: 2.4 });
    this.pingCounts[type]++;
    if (type === 'praise') {
      if (this.praiseCd > 0) return;
      this.praiseCd = 8;
      this.addMorale(8);
      // 가까운 아군 AI에게 격려 버프
      const allies = game.heroesOfTeam(game.player.team).filter((h) => !h.isPlayer && !h.dead);
      allies.sort((a, b) => dist(a.x, a.y, wx, wy) - dist(b.x, b.y, wx, wy));
      if (allies[0] && dist(allies[0].x, allies[0].y, wx, wy) < 1100) {
        addBuff(allies[0], { id: 'praised', dur: 6, dmgMul: 1.12 });
        spawnRing(allies[0].x, allies[0].y, '#3fe5a0', 50, 0.8);
        spawnFloater(allies[0].x, allies[0].y - 50, `${allies[0].name}: 고마워! 힘난다!`, { color: '#3fe5a0', size: 13 });
      }
      SFX.pingPraise();
    } else {
      if (type === 'gather') {
        this.rallyPoint = { x: wx, y: wy, until: game.time + 5 };
      }
      SFX.ping();
    }
  }

  // ── 이벤트 ──
  checkEvents() {
    if (this.activeEvent || this.game.over) return;
    const g = this.game;
    for (const ev of this.eventQueue) {
      if (this.firedEvents.has(ev.id)) continue;
      if (ev.trigger(g, this)) {
        this.firedEvents.add(ev.id);
        this.showEvent(ev);
        break;
      }
    }
  }

  showEvent(ev) {
    this.activeEvent = ev;
    this.game.timescale = 0;
    SFX.event();

    // text/speaker는 함수일 수 있음 (동적 아군 참조)
    const speaker = typeof ev.speaker === 'function' ? ev.speaker(this.game, this) : ev.speaker;
    const text = typeof ev.text === 'function' ? ev.text(this.game, this) : ev.text;

    const root = document.getElementById('event-layer');
    root.innerHTML = `
      <div class="event-backdrop"></div>
      <div class="event-modal">
        <div class="event-tag">⚡ 마음의 순간</div>
        <div class="event-title">${ev.title}</div>
        <div class="event-speaker">${speaker}</div>
        <div class="event-text">${text}</div>
        <div class="event-choices">
          ${ev.choices.map((c, i) => `<button class="event-choice" data-i="${i}"><span class="choice-num">${i + 1}</span>${c.label}</button>`).join('')}
        </div>
      </div>`;
    root.style.display = 'block';

    const onChoice = (i) => {
      const c = ev.choices[i];
      if (!c) return;
      window.removeEventListener('keydown', keyHandler);
      this.resolveChoice(ev, c);
    };
    root.querySelectorAll('.event-choice').forEach((btn) => {
      btn.addEventListener('click', () => onChoice(parseInt(btn.dataset.i)));
    });
    const keyHandler = (e) => {
      const n = parseInt(e.key);
      if (n >= 1 && n <= ev.choices.length) onChoice(n - 1);
    };
    window.addEventListener('keydown', keyHandler);
  }

  resolveChoice(ev, c) {
    // 점수 반영
    for (const [k, v] of Object.entries(c.scores || {})) {
      this.choiceScores[k] = (this.choiceScores[k] || 0) + v;
    }
    this.choiceLog.push({ event: ev.title, choice: c.label, good: c.good });
    if (c.effect) c.effect(this.game, this);
    (c.good ? SFX.choiceGood : SFX.choiceBad)();

    // 피드백 표시 후 재개
    const root = document.getElementById('event-layer');
    root.innerHTML = `
      <div class="event-backdrop"></div>
      <div class="event-modal event-feedback ${c.good ? 'good' : 'bad'}">
        <div class="feedback-icon">${c.good ? '💚' : '🌧️'}</div>
        <div class="event-text">${c.feedback}</div>
      </div>`;
    setTimeout(() => {
      root.style.display = 'none';
      root.innerHTML = '';
      this.activeEvent = null;
      this.game.timescale = 1;
    }, 2600);
  }

  // ── 프레임 업데이트 ──
  update(dt) {
    const g = this.game;
    // 틸트 자연 감소
    let decay = 1.1;
    decay *= 1 + (g.player.itemStats?.tiltDecay || 0);
    if (g.player.buffs.some((b) => b.id === 'calmBuff')) decay *= 2.5;
    if (this.morale > 70) decay *= 1.3;
    this.tilt = clamp(this.tilt - decay * dt, 0, 100);
    if (this.tiltFlash > 0) this.tiltFlash -= dt;
    if (this.praiseCd > 0) this.praiseCd -= dt;

    // 틸트 페널티: 쿨다운 증가
    g.player.cdMul = this.tiltTier() === 2 ? 1.12 : 1;

    this.updateBreath(dt);

    // 핑 마커 수명
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].t -= dt;
      if (this.pings[i].t <= 0) this.pings.splice(i, 1);
    }
    if (this.rallyPoint && g.time > this.rallyPoint.until) this.rallyPoint = null;

    this.checkEvents();
  }

  // ── 성찰 결과 계산 (0~100) ──
  computeReflection() {
    const g = this.game;
    const p = g.player;
    const cs = this.choiceScores;
    const area = {};
    area['자기'] = clamp(50 + cs['자기'] * 9 + Math.min(15, p.cs * 0.3), 0, 100);
    area['마음건강'] = clamp(55 + cs['마음'] * 9 + this.breathCount * 7 - Math.max(0, this.maxTiltSeen - 60) * 0.4, 0, 100);
    area['대인관계'] = clamp(45 + cs['관계'] * 9 + this.pingCounts.praise * 6 + p.assists * 3, 0, 100);
    area['공동체'] = clamp(45 + cs['공동체'] * 9 + (this.pingCounts.danger + this.pingCounts.retreat + this.pingCounts.gather) * 3 + this.morale * 0.15, 0, 100);
    return area;
  }
}

// ─── SEL 이벤트 정의 ───
function buildEvents() {
  return [
    {
      id: 'ally-mistake',
      trigger: (g, sel) => {
        const fallen = g.heroesOfTeam(g.player.team).find((h) => !h.isPlayer && h.deaths >= 1);
        if (fallen) { sel._mistakeAlly = fallen; return true; }
        if (g.time > 100) {
          sel._mistakeAlly = g.heroesOfTeam(g.player.team).find((h) => !h.isPlayer);
          return true;
        }
        return false;
      },
      title: '팀원의 실수',
      speaker: (g, sel) => `💬 아군 ${sel._mistakeAlly?.name || '팀원'}`,
      text: (g, sel) => `무리하게 싸우다 ${sel._mistakeAlly?.name || '팀원'}이(가) 잡혔다.<br>채팅창에 메시지가 올라온다.<br><b>"아… 미안, 내가 무리했다 ㅠㅠ"</b><br><br>뭐라고 답할까?`,
      choices: [
        {
          label: '"괜찮아! 다음에 같이 갚아주자"',
          good: true,
          scores: { 관계: 2, 공동체: 1 },
          feedback: '팀원의 마음이 가벼워졌다. 실수한 팀원을 일으켜 세우는 한마디가 팀 전체를 강하게 만든다. (팀 사기 상승!)',
          effect: (g, sel) => {
            sel.addMorale(12);
            if (sel._mistakeAlly) addBuff(sel._mistakeAlly, { id: 'encouraged', dur: 20, dmgMul: 1.1 });
          },
        },
        {
          label: '"아니 뭐 함? 좀 똑바로 해"',
          good: false,
          scores: { 관계: -2 },
          feedback: '팀원이 위축됐다. 비난은 실수를 줄여주지 않는다. 오히려 몸을 굳게 만들 뿐. (팀 사기 하락, 팀원 위축)',
          effect: (g, sel) => {
            sel.addMorale(-14);
            sel.addTilt(6);
            if (sel._mistakeAlly) addBuff(sel._mistakeAlly, { id: 'discouraged', dur: 25, dmgMul: 0.88 });
          },
        },
        {
          label: '아무 말 없이 내 할 일에 집중한다',
          good: true,
          scores: { 자기: 1 },
          feedback: '나쁘지 않은 선택. 하지만 혼자 잘하는 것만으로는 팀이 강해지지 않는다. 다음엔 한마디 건네볼까?',
          effect: (g, sel) => sel.addMorale(-3),
        },
      ],
    },
    {
      id: 'provoke',
      trigger: (g) => g.time > 220,
      title: '상대의 도발',
      speaker: '💬 [전체] 그림자 냉소',
      text: '전체 채팅에 상대 팀의 메시지가 떴다.<br><b>"그 실력으로 게임 왜 함? ㅋㅋㅋ"</b><br><br>손이 근질거린다. 어떻게 할까?',
      choices: [
        {
          label: '무시하고 다음 웨이브에 집중한다',
          good: true,
          scores: { 자기: 2, 마음: 1 },
          feedback: '도발의 목적은 내 멘탈을 흔드는 것. 반응하지 않는 순간, 도발은 힘을 잃는다. (멘탈 회복!)',
          effect: (g, sel) => sel.addTilt(-12),
        },
        {
          label: '"너나 잘하셈 ㅋㅋ" 똑같이 받아친다',
          good: false,
          scores: { 관계: -1, 마음: -1 },
          feedback: '채팅 배틀이 시작됐다… 손은 키보드에, 눈은 채팅창에. 게임에 쓸 집중력이 새어나간다. (멘탈 요동, 냉소는 오히려 신남)',
          effect: (g, sel) => {
            sel.addTilt(16);
            const cynic = g.heroesOfTeam('red').find((h) => h.champ.id === 'moon');
            if (cynic) addBuff(cynic, { id: 'trollJoy', dur: 20, dmgMul: 1.1 });
          },
        },
        {
          label: '조용히 신고하고 채팅을 차단한다',
          good: true,
          scores: { 공동체: 2, 마음: 1 },
          feedback: '가장 어른스러운 대응. 나쁜 언어에 무대를 주지 않고, 시스템에 맡긴다. 이게 진짜 게임 문화를 지키는 법. (멘탈 안정 + 팀 사기 상승)',
          effect: (g, sel) => { sel.addTilt(-6); sel.addMorale(6); },
        },
      ],
    },
    {
      id: 'giveup',
      trigger: (g, sel) => {
        if (g.time <= 360) return false;
        const allies = g.heroesOfTeam(g.player.team).filter((h) => !h.isPlayer);
        sel._giveupAlly = allies.find((h) => h.champ.id === 'gale') || allies[0];
        return true;
      },
      title: '팀원의 포기 선언',
      speaker: (g, sel) => `💬 아군 ${sel._giveupAlly?.name || '팀원'}`,
      text: (g, sel) => `전세가 밀리는 것 같자 ${sel._giveupAlly?.name || '팀원'}이(가) 채팅을 쳤다.<br><b>"하… 이 판 진 듯. 나 그냥 라인에서 대기할래."</b><br><br>아직 넥서스는 무너지지 않았다.`,
      choices: [
        {
          label: '"아직 안 끝났어! 정령 한 번만 같이 가자"',
          good: true,
          scores: { 공동체: 2, 관계: 2 },
          feedback: '팀원이 다시 마우스를 잡았다. 포기하려는 팀원을 다시 일으키는 것 — 그것이 리더의 언어다. (팀 사기 대폭 상승!)',
          effect: (g, sel) => {
            sel.addMorale(16);
            for (const h of g.heroesOfTeam(g.player.team)) {
              if (!h.isPlayer && !h.dead) addBuff(h, { id: 'rallied', dur: 25, dmgMul: 1.1, msMul: 1.08 });
            }
          },
        },
        {
          label: '"아 진짜 짜증 나게 하네"',
          good: false,
          scores: { 관계: -2 },
          feedback: '팀원이 정말로 라인에 멈춰 섰다… 짜증은 포기를 되돌리지 못한다. (팀원 잠시 이탈, 팀 사기 하락)',
          effect: (g, sel) => {
            sel.addMorale(-15);
            sel.addTilt(10);
            if (sel._giveupAlly) sel._giveupAlly.afkT = 8;
          },
        },
        {
          label: '"지더라도 끝까지 해보는 거야"',
          good: true,
          scores: { 자기: 2, 공동체: 1 },
          feedback: '결과보다 태도. 끝까지 최선을 다하는 모습은 결과와 상관없이 남는다. (팀 사기 상승)',
          effect: (g, sel) => sel.addMorale(9),
        },
      ],
    },
    {
      id: 'self-talk',
      trigger: (g) => g.player.deaths >= 3,
      title: '내 안의 목소리',
      speaker: '🌫️ 마음속',
      text: '세 번째 죽음. 화면이 회색으로 변한 사이,<br>마음속에서 목소리가 들려온다.<br><b>"…나 오늘 왜 이러지."</b><br><br>스스로에게 뭐라고 말해줄까?',
      choices: [
        {
          label: '"괜찮아. 방금 실수에서 배웠으면 된 거야."',
          good: true,
          scores: { 마음: 3, 자기: 2 },
          feedback: '자기 자신에게 건네는 따뜻한 한마디 — 심리학자들은 이것을 "자기자비"라고 부른다. 멘탈이 크게 회복됐다!',
          effect: (g, sel) => sel.addTilt(-32),
        },
        {
          label: '"난 진짜 못하는 것 같아…"',
          good: false,
          scores: { 마음: -1 },
          feedback: '자기 비난은 가장 가까운 곳에서 날아오는 화살이다. 다음 판단까지 흐려지기 시작한다… (멘탈 악화)',
          effect: (g, sel) => sel.addTilt(12),
        },
        {
          label: '잠깐 숨을 고르고 미니맵 전체를 본다',
          good: true,
          scores: { 마음: 2, 자기: 1 },
          feedback: '감정에서 한 발 물러나 상황을 넓게 보기 — "조망하기"는 감정 조절의 핵심 기술이다. (멘탈 회복)',
          effect: (g, sel) => sel.addTilt(-22),
        },
      ],
    },
    {
      id: 'final-push',
      trigger: (g) => g.time > 520,
      title: '마지막 결전의 순간',
      speaker: '⚔️ 결단의 시간',
      text: '경기가 무르익었다. 다음 한타가 승부를 가른다.<br>팀에게 어떤 말을 남길까?',
      choices: [
        {
          label: '"다 같이 미드로! 흩어지지 말자!"',
          good: true,
          scores: { 공동체: 2, 관계: 1 },
          feedback: '명확한 목표 제시 + 함께라는 메시지. 팀이 하나로 뭉친다! (전원 결집 버프)',
          effect: (g, sel) => {
            sel.addMorale(12);
            for (const h of g.heroesOfTeam(g.player.team)) {
              if (!h.dead) addBuff(h, { id: 'finalRally', dur: 30, dmgMul: 1.12 });
            }
            sel.rallyPoint = { x: 1600, y: 1600, until: g.time + 8 };
          },
        },
        {
          label: '"각자 알아서 잘 하자"',
          good: false,
          scores: { 공동체: -1 },
          feedback: '따로 노는 다섯 명은 한 명씩 잡히기 마련. MOBA의 오래된 격언 — 흩어지면 진다.',
          effect: (g, sel) => sel.addMorale(-6),
        },
        {
          label: '"지금까지 다들 고생했어. 마지막이다!"',
          good: true,
          scores: { 관계: 2, 공동체: 1 },
          feedback: '인정과 격려로 마무리하는 리더십. 팀원들의 손끝에 힘이 들어간다. (팀 사기 상승)',
          effect: (g, sel) => sel.addMorale(14),
        },
      ],
    },
  ];
}
