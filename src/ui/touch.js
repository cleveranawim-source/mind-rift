// ─── 모바일 터치 컨트롤 ───
// 왼손: 가상 조이스틱(이동). 오른손: 스킬 버튼(Q/W/E) + 오토어택.
// 스킬 버튼은 탭=자동조준, 드래그=방향 조준(LOL 모바일 방식).
// 하단 유틸: 심호흡·핑·귀환.
import { DASH } from '../data/champions.js';

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

let root = null;
let raf = null;

export function initTouchControls(game) {
  destroyTouchControls();
  const p = game.player;
  const champ = p.champ;

  root = document.createElement('div');
  root.id = 'touch-layer';
  root.innerHTML = `
    <div id="tc-joy" class="tc-joy">
      <div class="tc-joy-base"><div class="tc-joy-knob"></div></div>
    </div>
    <div class="tc-skills">
      <button class="tc-skill tc-util" data-act="breath" title="심호흡">🫁</button>
      <button class="tc-skill tc-util" data-act="ping" title="격려 핑">💚</button>
      <div class="tc-skill-row">
        <button class="tc-skill" data-slot="E" style="--c:${champ.color}"><b>💨</b><small>도약</small></button>
        <button class="tc-skill" data-slot="W" style="--c:${champ.color}"><b>${champ.W.emoji || 'W'}</b><small>${champ.W.name}</small></button>
        <button class="tc-skill" data-slot="Q" style="--c:${champ.color}"><b>${champ.Q.emoji || 'Q'}</b><small>${champ.Q.name}</small></button>
        <button class="tc-skill tc-attack" data-slot="A"><b>⚔️</b><small>공격</small></button>
      </div>
      <button class="tc-skill tc-util tc-recall" data-act="recall" title="귀환">🏠</button>
    </div>
  `;
  document.body.appendChild(root);

  // ── 조이스틱 (이동) ──
  const joy = root.querySelector('#tc-joy');
  const knob = root.querySelector('.tc-joy-knob');
  const base = root.querySelector('.tc-joy-base');
  let joyId = null, joyCx = 0, joyCy = 0;
  const R = 52;
  game._stick = null;

  const joyStart = (e) => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    joyId = e.changedTouches ? t.identifier : 'mouse';
    // 조이스틱을 터치 지점으로 이동 (플로팅 조이스틱)
    joyCx = t.clientX; joyCy = t.clientY;
    base.style.left = (joyCx - joy.getBoundingClientRect().left) + 'px';
    base.style.top = (joyCy - joy.getBoundingClientRect().top) + 'px';
    base.classList.add('active');
    joyMove(e);
  };
  const joyMove = (e) => {
    if (joyId === null) return;
    let t = null;
    if (e.changedTouches) {
      for (const ct of e.changedTouches) if (ct.identifier === joyId) t = ct;
      if (!t) return;
    } else t = e;
    let dx = t.clientX - joyCx, dy = t.clientY - joyCy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (len > 8) {
      game._stick = { x: (t.clientX - joyCx) / Math.max(len, 1), y: (t.clientY - joyCy) / Math.max(len, 1) };
    } else game._stick = null;
  };
  const joyEnd = (e) => {
    if (e.changedTouches) {
      let matched = false;
      for (const ct of e.changedTouches) if (ct.identifier === joyId) matched = true;
      if (!matched) return;
    }
    joyId = null; game._stick = null;
    knob.style.transform = 'translate(0,0)';
    base.classList.remove('active');
  };
  joy.addEventListener('touchstart', (e) => { e.preventDefault(); joyStart(e); }, { passive: false });
  joy.addEventListener('touchmove', (e) => { e.preventDefault(); joyMove(e); }, { passive: false });
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);
  joy.addEventListener('mousedown', joyStart);
  window.addEventListener('mousemove', joyMove);
  window.addEventListener('mouseup', joyEnd);
  game._touchListeners = [
    [window, 'mousemove', joyMove], [window, 'mouseup', joyEnd],
  ];

  // ── 스킬 버튼 (드래그 조준) ──
  root.querySelectorAll('.tc-skill[data-slot]').forEach((btn) => {
    const slot = btn.dataset.slot;
    let sx = 0, sy = 0, dragging = false, sid = null;
    const bStart = (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      sid = e.changedTouches ? t.identifier : 'mouse';
      sx = t.clientX; sy = t.clientY; dragging = false;
      btn.classList.add('pressed');
    };
    const bMove = (e) => {
      if (sid === null) return;
      let t = null;
      if (e.changedTouches) { for (const ct of e.changedTouches) if (ct.identifier === sid) t = ct; if (!t) return; }
      else t = e;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.hypot(dx, dy) > 24) { dragging = true; btn.classList.add('aiming'); }
    };
    const bEnd = (e) => {
      if (sid === null) return;
      let t = null;
      if (e.changedTouches) { for (const ct of e.changedTouches) if (ct.identifier === sid) t = ct; if (!t) return; }
      else t = e;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sid = null; btn.classList.remove('pressed', 'aiming');
      if (game.over || game.sel.activeEvent) return;
      if (slot === 'A') { // 오토어택: 화면 방향으로 명령
        const dir = normDir(dx, dy);
        if (dragging && dir) {
          game.commandAt({ x: game.player.x + dir.x * 300, y: game.player.y + dir.y * 300 });
        } else {
          // 탭 = 가장 가까운 적 공격
          autoAttackNearest(game);
        }
        return;
      }
      const dir = (dragging) ? normDir(dx, dy) : null;
      game.castSkill(slot, dir);
    };
    btn.addEventListener('touchstart', bStart, { passive: false });
    btn.addEventListener('touchmove', bMove, { passive: false });
    btn.addEventListener('touchend', bEnd);
    btn.addEventListener('mousedown', bStart);
    btn.addEventListener('mousemove', bMove);
    btn.addEventListener('mouseup', bEnd);
  });

  // ── 유틸 버튼 ──
  root.querySelectorAll('.tc-skill[data-act]').forEach((btn) => {
    const act = btn.dataset.act;
    if (act === 'breath') {
      // 누르는 동안 심호흡
      const start = (e) => { e.preventDefault(); if (!game.over && !game.sel.activeEvent) game.sel.startBreath(); btn.classList.add('pressed'); };
      const end = () => { if (game.sel.breathing) game.sel.cancelBreath(); btn.classList.remove('pressed'); };
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end);
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', end);
    } else {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (game.over || game.sel.activeEvent) return;
        if (act === 'ping') game.sel.firePing('praise', game.player.x, game.player.y);
        else if (act === 'recall') game.startRecall();
      });
    }
  });

  // ── 쿨다운 시각화 루프 ──
  const skillBtns = [...root.querySelectorAll('.tc-skill[data-slot]')];
  const loop = () => {
    const pl = game.player;
    for (const btn of skillBtns) {
      const slot = btn.dataset.slot;
      if (slot === 'A') continue;
      const def = slot === 'E' ? DASH : pl.champ[slot];
      const cd = pl.cooldowns[slot] || 0;
      const frac = def.cd ? cd / def.cd : 0;
      btn.style.setProperty('--cd', `${Math.round(frac * 100)}%`);
      const noMana = pl.mana < def.mana;
      btn.classList.toggle('disabled', cd > 0 || noMana || pl.dead);
      const cdLabel = btn.querySelector('.tc-cd');
      if (cd > 0) {
        if (!cdLabel) { const s = document.createElement('span'); s.className = 'tc-cd'; btn.appendChild(s); s.textContent = Math.ceil(cd); }
        else cdLabel.textContent = Math.ceil(cd);
      } else if (cdLabel) cdLabel.remove();
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function normDir(dx, dy) {
  const l = Math.hypot(dx, dy);
  return l > 1 ? { x: dx / l, y: dy / l } : null;
}

function autoAttackNearest(game) {
  const p = game.player;
  const foes = [
    ...game.heroesOfTeam(p.team === 'blue' ? 'red' : 'blue'),
    ...game.minions.filter((m) => m.team !== p.team),
    ...game.monsters,
  ].filter((u) => !u.dead && !u.invulnerable);
  let best = null, bd = 700;
  for (const u of foes) { const d = Math.hypot(u.x - p.x, u.y - p.y); if (d < bd) { bd = d; best = u; } }
  if (best) { p.target = best; p.moveTarget = null; }
}

export function destroyTouchControls() {
  if (raf) cancelAnimationFrame(raf), raf = null;
  if (root) { root.remove(); root = null; }
}

// 조이스틱 이동을 매 프레임 게임에 반영 (game.update에서 호출)
export function applyStick(game) {
  if (game._stick && !game.player.dead) {
    game.moveByStick(game._stick.x, game._stick.y);
  }
}
