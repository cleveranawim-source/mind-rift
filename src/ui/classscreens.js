// ─── 반 모드 화면: 입장 · 로비 · 결과 · 교사 대시보드 ───
import { CHAMPIONS, champById } from '../data/champions.js';
import { champArt } from './assets.js';
import { SFX } from '../audio/audio.js';
import { WORLD, NEXUS_POS } from '../world/map.js';
import {
  createRoom, joinRoom, watchRoom, pickChamp, setReady,
  startMatch, leaveRoom, endRoom,
} from '../net/classroom.js';

const root = () => document.getElementById('ui-root');
let unwatch = null;
function stopWatch() { if (unwatch) { unwatch(); unwatch = null; } spectateClose(); }

// 관전 상태 (교사가 특정 학생 협곡을 실시간 미니맵으로 지켜봄)
let specPid = null;
let latestRoom = null;

const AREA_KEYS = ['자기', '마음건강', '대인관계', '공동체'];
const AREA_COLORS = { 자기: '#e8a33d', 마음건강: '#9b6dff', 대인관계: '#ffd93d', 공동체: '#4ad1e8' };

// 45초간 신호 없으면 이탈로 간주 (경기 중 + 미완료)
function isGone(p, room) {
  return room.status === 'playing' && !p.done && Date.now() - (p.seen || 0) > 45000;
}

// ═══ 학생: 입장 화면 ═══
export function showClassJoin(onEnterLobby, onBack) {
  stopWatch();
  root().innerHTML = `
    <div class="screen class-screen">
      <div class="class-card">
        <h2 class="class-heading">🏫 반 모드</h2>
        <p class="class-sub">친구들과 한 팀이 되어 그림자 군단에 맞서세요</p>
        <input id="cj-name" class="class-input" maxlength="8" placeholder="내 이름 (별명 OK)" autocomplete="off" />
        <div class="class-row">
          <input id="cj-code" class="class-input code" maxlength="4" placeholder="방 코드" autocomplete="off" />
          <button class="btn-primary sm" id="cj-join">입장</button>
        </div>
        <div class="class-or">— 또는 —</div>
        <button class="btn-ghost" id="cj-create">새 방 만들기 (팀장)</button>
        <div class="class-err" id="cj-err"></div>
        <button class="class-back" id="cj-back">← 돌아가기</button>
      </div>
    </div>`;

  const err = (m) => { document.getElementById('cj-err').textContent = m; };
  const nameOf = () => document.getElementById('cj-name').value.trim();

  document.getElementById('cj-join').addEventListener('click', async () => {
    const name = nameOf();
    const code = document.getElementById('cj-code').value.trim();
    if (!name) return err('이름을 입력해 주세요.');
    if (code.length !== 4) return err('4글자 방 코드를 입력해 주세요.');
    try {
      SFX.click();
      const { playerId } = await joinRoom(code, name);
      onEnterLobby({ code: code.toUpperCase(), playerId, name });
    } catch (e) { err(e.message || '입장에 실패했어요.'); }
  });
  document.getElementById('cj-create').addEventListener('click', async () => {
    const name = nameOf();
    if (!name) return err('이름을 입력해 주세요.');
    try {
      SFX.click();
      const { code, playerId } = await createRoom({ name });
      onEnterLobby({ code, playerId, name, isHost: true });
    } catch (e) { err('방 생성 실패: ' + (e.message || e)); }
  });
  document.getElementById('cj-back').addEventListener('click', onBack);
}

// ═══ 학생: 로비 ═══
export function showLobby(ctx, onStart, onLeave) {
  stopWatch();
  root().innerHTML = `
    <div class="screen class-screen">
      <div class="class-card wide">
        <div class="lobby-head">
          <div>
            <div class="lobby-label">방 코드</div>
            <div class="lobby-code">${ctx.code}</div>
          </div>
          <div class="lobby-hint">친구들에게 코드를 알려주세요 (최대 5명)</div>
        </div>
        <div class="lobby-players" id="lb-players"></div>
        <div class="lobby-label" style="margin-top:18px">수호자 선택 <span class="lobby-dim">— 한 명씩만 고를 수 있어요</span></div>
        <div class="lobby-champs" id="lb-champs"></div>
        <div class="lobby-actions">
          <button class="btn-ghost" id="lb-ready">준비 완료</button>
          <button class="btn-primary" id="lb-start" style="display:none">🚀 모두 출발!</button>
        </div>
        <div class="class-err" id="lb-err"></div>
        <button class="class-back" id="lb-leave">← 나가기</button>
      </div>
    </div>`;

  let myReady = false;
  let started = false;

  const render = (room) => {
    if (started) return;
    if (room.status === 'playing') {
      started = true;
      stopWatch();
      const me = room.players[ctx.playerId];
      onStart(me?.champ || 'flame', room);
      return;
    }
    const players = Object.entries(room.players || {});
    // 플레이어 슬롯
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const [pid, p] = players[i] || [null, null];
      if (p) {
        const champ = p.champ ? champById(p.champ) : null;
        slots.push(`
          <div class="lb-slot filled ${pid === ctx.playerId ? 'me' : ''}">
            ${champ ? `<img src="${champArt(champ.id)}" alt="" />` : '<div class="lb-noimg">?</div>'}
            <div class="lb-pname">${p.name}${pid === ctx.playerId ? ' (나)' : ''}</div>
            <div class="lb-pstate">${p.ready ? '✅ 준비' : champ ? champ.name : '고르는 중…'}</div>
          </div>`);
      } else {
        slots.push('<div class="lb-slot empty">빈 자리</div>');
      }
    }
    document.getElementById('lb-players').innerHTML = slots.join('');

    // 챔피언 그리드
    const taken = new Map(players.filter(([, p]) => p.champ).map(([pid, p]) => [p.champ, pid]));
    document.getElementById('lb-champs').innerHTML = CHAMPIONS.map((c) => {
      const owner = taken.get(c.id);
      const mine = owner === ctx.playerId;
      const disabled = owner && !mine;
      return `<button class="lb-champ ${mine ? 'mine' : ''} ${disabled ? 'taken' : ''}" data-id="${c.id}" ${disabled ? 'disabled' : ''}>
        <img src="${champArt(c.id)}" alt="${c.name}" />
        <span>${c.name}</span><small>${c.role}</small>
      </button>`;
    }).join('');
    document.getElementById('lb-champs').querySelectorAll('.lb-champ:not(.taken)').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try { SFX.click(); await pickChamp(ctx.code, ctx.playerId, btn.dataset.id); }
        catch (e) { document.getElementById('lb-err').textContent = e.message; }
      });
    });

    // 시작 버튼 (호스트만, 전원 준비 시)
    const allReady = players.length >= 1 && players.every(([, p]) => p.ready && p.champ);
    const isHost = room.hostId === ctx.playerId;
    const startBtn = document.getElementById('lb-start');
    startBtn.style.display = isHost ? 'inline-block' : 'none';
    startBtn.disabled = !allReady;
    startBtn.textContent = allReady ? '🚀 모두 출발!' : `대기 중 (${players.filter(([, p]) => p.ready && p.champ).length}/${players.length} 준비)`;
  };

  unwatch = watchRoom(ctx.code, render);

  document.getElementById('lb-ready').addEventListener('click', () => {
    myReady = !myReady;
    document.getElementById('lb-ready').textContent = myReady ? '준비 취소' : '준비 완료';
    setReady(ctx.code, ctx.playerId, myReady);
    SFX.click();
  });
  document.getElementById('lb-start').addEventListener('click', () => { SFX.click(); startMatch(ctx.code); });
  document.getElementById('lb-leave').addEventListener('click', () => {
    stopWatch();
    leaveRoom(ctx.code, ctx.playerId);
    onLeave();
  });
}

// ═══ 학생: 경기 후 팀 결과 대기 화면 ═══
export function showClassResult(ctx, onRestart) {
  stopWatch();
  root().innerHTML = `
    <div class="screen class-screen">
      <div class="class-card wide" id="cr-card">
        <h2 class="class-heading">📡 팀 결과</h2>
        <div id="cr-body">친구들의 경기가 끝나길 기다리는 중…</div>
        <div class="end-buttons" style="margin-top:22px">
          <button class="btn-ghost" id="cr-exit">처음으로</button>
        </div>
      </div>
    </div>`;

  unwatch = watchRoom(ctx.code, (room) => {
    const players = Object.values(room.players || {});
    const active = players.filter((p) => !isGone(p, room)); // 이탈자 집계 제외
    const doneCount = active.filter((p) => p.done).length;
    const rows = players.map((p) => {
      const champ = p.champ ? champById(p.champ) : null;
      const state = p.done ? (p.win ? '🏆 승리' : '🌧 패배') : isGone(p, room) ? '⚠️ 연결 끊김' : '⚔ 전투 중';
      return `<div class="cr-row">
        ${champ ? `<img src="${champArt(champ.id)}" alt="" />` : ''}
        <b>${p.name}</b>
        <span class="cr-stat">${state}</span>
        <span class="cr-stat">${p.k}/${p.d}/${p.a}</span>
        <span class="cr-stat">🌬${p.breaths} 💚${p.praises}</span>
      </div>`;
    }).join('');

    let summary = '';
    if (doneCount === active.length && doneCount > 0) {
      // 반 평균 SEL
      const avg = {};
      for (const k of AREA_KEYS) {
        const vals = active.filter((p) => p.ref).map((p) => p.ref[k] || 0);
        avg[k] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      }
      summary = `<div class="lobby-label" style="margin-top:16px">우리 팀 마음 리포트 (평균)</div>` +
        AREA_KEYS.map((k) => `
          <div class="ref-row">
            <div class="ref-label">${k}</div>
            <div class="ref-bar"><div class="ref-fill" style="width:${avg[k]}%;background:${AREA_COLORS[k]}"></div></div>
            <div class="ref-score">${avg[k]}</div>
          </div>`).join('');
    }
    document.getElementById('cr-body').innerHTML =
      `<div class="cr-list">${rows}</div>${summary}
       <p class="class-sub" style="margin-top:12px">${doneCount}/${active.length}명 완료 · 팀 사기 ${Math.round(Math.max(0, Math.min(100, room.morale)))}</p>`;
  });

  document.getElementById('cr-exit').addEventListener('click', () => {
    stopWatch();
    leaveRoom(ctx.code, ctx.playerId);
    onRestart();
  });
}

// ═══ 교사 대시보드 ═══
export function showTeacherDash(onBack) {
  stopWatch();
  root().innerHTML = `
    <div class="screen class-screen">
      <div class="class-card wide">
        <h2 class="class-heading">🧑‍🏫 교사 발표모드</h2>
        <p class="class-sub">방을 만들고 코드를 화면에 띄워 주세요. 학생들의 협곡이 실시간으로 보입니다.</p>
        <button class="btn-primary" id="td-create">새 방 만들기</button>
        <div class="class-row" style="margin-top:10px">
          <input id="td-code" class="class-input code" maxlength="4" placeholder="기존 방 코드" />
          <button class="btn-ghost sm" id="td-watch">지켜보기</button>
        </div>
        <div class="class-err" id="td-err"></div>
        <button class="class-back" id="td-back">← 돌아가기</button>
      </div>
    </div>`;

  const openDash = (code) => renderDash(code, onBack);
  document.getElementById('td-create').addEventListener('click', async () => {
    try {
      const { code } = await createRoom({ asTeacher: true });
      openDash(code);
    } catch (e) { document.getElementById('td-err').textContent = '생성 실패: ' + (e.message || e); }
  });
  document.getElementById('td-watch').addEventListener('click', () => {
    const code = document.getElementById('td-code').value.trim().toUpperCase();
    if (code.length === 4) openDash(code);
  });
  document.getElementById('td-back').addEventListener('click', onBack);
}

function renderDash(code, onBack) {
  stopWatch();
  root().innerHTML = `
    <div class="screen class-screen dash">
      <div class="dash-head">
        <div class="dash-code-wrap">
          <div class="lobby-label">방 코드</div>
          <div class="dash-code">${code}</div>
        </div>
        <div class="dash-morale-wrap">
          <div class="lobby-label">팀 사기</div>
          <div class="dash-morale"><div id="td-morale" class="dash-morale-fill"></div></div>
        </div>
        <button class="class-back" id="td-exit">닫기</button>
      </div>
      <div class="dash-grid">
        <div class="dash-panel">
          <div class="lobby-label">수호자들</div>
          <div id="td-players" class="dash-players"></div>
          <div id="td-summary"></div>
        </div>
        <div class="dash-panel">
          <div class="lobby-label">협곡 소식</div>
          <div id="td-feed" class="dash-feed"></div>
        </div>
      </div>
    </div>`;

  unwatch = watchRoom(code, (room) => {
    latestRoom = room;
    // 사기
    const m = Math.max(0, Math.min(100, room.morale || 0));
    const mf = document.getElementById('td-morale');
    if (mf) {
      mf.style.width = m + '%';
      mf.style.background = m > 65 ? 'var(--mint)' : m > 40 ? '#ffc247' : '#ff5544';
    }
    // 플레이어 카드
    const entries = Object.entries(room.players || {});
    const players = entries.map(([, p]) => p);
    const active = players.filter((p) => !isGone(p, room));
    document.getElementById('td-players').innerHTML = entries.map(([pid, p]) => {
      const champ = p.champ ? champById(p.champ) : null;
      const tiltPct = Math.min(100, p.tilt || 0);
      const playing = room.status === 'playing' && !p.done && !isGone(p, room);
      const state = p.done ? (p.win ? '🏆 완료' : '🌧 완료')
        : isGone(p, room) ? '⚠️ 연결 끊김'
        : room.status === 'playing' ? '⚔ 전투 중' : '대기';
      return `<div class="td-card ${isGone(p, room) ? 'gone' : ''}">
        ${champ ? `<img src="${champArt(champ.id)}" alt="" />` : '<div class="lb-noimg">?</div>'}
        <div class="td-info">
          <b>${p.name}</b> <small>Lv${p.lv} · ${p.k}/${p.d}/${p.a}</small>
          <div class="td-tilt"><div style="width:${tiltPct}%"></div></div>
          <small>🌬${p.breaths} 💚${p.praises} · ${state}</small>
        </div>
        ${p.snap ? `<button class="td-spectate" data-pid="${pid}">👁 관전</button>` : ''}
      </div>`;
    }).join('') || '<p class="class-sub">아직 입장한 학생이 없어요</p>';
    // 관전 중이면 최신 스냅샷으로 다시 그림
    if (specPid) spectateRedraw();

    // 피드 (최근 24개)
    const evs = (room.events || []).slice(-24).reverse();
    document.getElementById('td-feed').innerHTML = evs.map((e) =>
      `<div class="td-ev ${e.ty}"><b>${e.n}</b> ${e.tx}</div>`
    ).join('') || '<p class="class-sub">경기가 시작되면 소식이 올라와요</p>';

    // 전원 완료 (이탈자 제외) → 반 리포트
    if (active.length && active.every((p) => p.done)) {
      const avg = {};
      for (const k of AREA_KEYS) {
        const vals = active.filter((p) => p.ref).map((p) => p.ref[k] || 0);
        avg[k] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      }
      document.getElementById('td-summary').innerHTML =
        `<div class="lobby-label" style="margin-top:14px">반 마음 리포트 (평균)</div>` +
        AREA_KEYS.map((k) => `
          <div class="ref-row">
            <div class="ref-label">${k}</div>
            <div class="ref-bar"><div class="ref-fill" style="width:${avg[k]}%;background:${AREA_COLORS[k]}"></div></div>
            <div class="ref-score">${avg[k]}</div>
          </div>`).join('');
      if (room.status === 'playing') endRoom(code);
    } else {
      document.getElementById('td-summary').innerHTML = '';
    }
  });

  document.getElementById('td-players').addEventListener('click', (e) => {
    const btn = e.target.closest('.td-spectate');
    if (btn) spectateOpen(btn.dataset.pid);
  });

  document.getElementById('td-exit').addEventListener('click', () => { stopWatch(); onBack(); });
}

// ═══ 학생 경기 실시간 관전 (스냅샷 미니맵) ═══
const TAU = Math.PI * 2;
function spectateOpen(pid) {
  specPid = pid;
  let ov = document.getElementById('spectate');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'spectate';
    ov.className = 'spectate';
    ov.innerHTML = `
      <div class="spec-card">
        <div class="spec-head">
          <b id="spec-name">관전</b>
          <span class="spec-hint">2.5초 간격 실시간 갱신</span>
          <button class="spec-close" id="spec-close">✕</button>
        </div>
        <canvas id="spec-canvas" width="480" height="480"></canvas>
        <div class="spec-stats" id="spec-stats"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#spec-close').addEventListener('click', spectateClose);
    ov.addEventListener('click', (e) => { if (e.target === ov) spectateClose(); });
  }
  spectateRedraw();
}
function spectateClose() {
  specPid = null;
  const ov = document.getElementById('spectate');
  if (ov) ov.remove();
}
function spectateRedraw() {
  const ov = document.getElementById('spectate');
  if (!ov || !specPid || !latestRoom) return;
  const p = (latestRoom.players || {})[specPid];
  if (!p) { spectateClose(); return; }
  const champ = p.champ ? champById(p.champ) : null;
  ov.querySelector('#spec-name').textContent = `👁 ${p.name}${champ ? ' · ' + champ.name : ''}`;
  const canvas = ov.querySelector('#spec-canvas');
  drawSpectateMap(canvas.getContext('2d'), canvas.width, p.snap);
  // 하단 스탯
  const s = p.snap;
  const stale = s ? (Date.now() - (p.seen || 0) > 8000) : true;
  const stats = ov.querySelector('#spec-stats');
  if (!s) {
    stats.innerHTML = `<div class="spec-wait">스냅샷 대기 중… (학생이 경기를 시작하면 표시돼요)</div>`;
    return;
  }
  const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const finished = s.over === 'W' ? '🏆 승리로 종료' : s.over === 'L' ? '🌧 패배로 종료' : null;
  stats.innerHTML = `
    <div class="spec-line">
      <span class="spec-chip blue">우리 ${s.sc[0]}</span>
      <span class="spec-clock">${mmss(s.t)}</span>
      <span class="spec-chip red">그림자 ${s.sc[1]}</span>
    </div>
    <div class="spec-line small">
      <span>🏰 타워 ${s.tw[0]} : ${s.tw[1]}</span>
      <span>💎 넥서스 ${s.nx[0]}% : ${s.nx[1]}%</span>
    </div>
    <div class="spec-tiltrow"><span>멘탈</span><div class="spec-tiltbar"><div style="width:${Math.min(100, s.tl)}%;background:${s.tl > 66 ? '#ff5544' : s.tl > 33 ? '#ffc247' : '#3fe5a0'}"></div></div></div>
    ${s.ev ? '<div class="spec-ev">🧭 선택의 순간 진행 중</div>' : ''}
    ${finished ? `<div class="spec-ev done">${finished}</div>` : ''}
    ${stale && !finished ? '<div class="spec-stale">⏸ 신호 지연 중…</div>' : ''}`;
}
function drawSpectateMap(ctx, size, snap) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#0a1410';
  ctx.fillRect(0, 0, size, size);
  const T = (wx, wy) => [(wx / WORLD) * size, size - (wy / WORLD) * size]; // y반전: 블루 기지 좌하단
  // 강 (y=x 대각)
  ctx.strokeStyle = 'rgba(90,150,200,0.16)';
  ctx.lineWidth = size * 0.055;
  const a = T(0, 0), b = T(WORLD, WORLD);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  // 테두리
  ctx.strokeStyle = 'rgba(63,229,160,0.2)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  // 넥서스
  for (const [pos, col] of [[NEXUS_POS.blue, '#4a9eff'], [NEXUS_POS.red, '#ff5544']]) {
    const [cx, cy] = T(pos.x, pos.y);
    ctx.fillStyle = col;
    ctx.fillRect(cx - 7, cy - 7, 14, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 7, cy - 7, 14, 14);
  }
  if (!snap || !snap.h) return;
  // 영웅 점
  for (const h of snap.h) {
    const [cx, cy] = T(h.x, h.y);
    const isBlue = h.T === 'b';
    const col = isBlue ? '#3fe5a0' : '#ff6b6b';
    const me = h.me === 1;
    const r = me ? size * 0.025 : size * 0.016;
    if (h.hp <= 0) { // 사망: 흐린 원
      ctx.globalAlpha = 0.35; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      continue;
    }
    if (me) { // 학생 본인: 흰 링 강조
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    // HP 링
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * (h.hp / 100)); ctx.stroke();
  }
}

export function stopClassWatch() { stopWatch(); }
