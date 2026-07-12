// ─── 부트스트랩: 화면 흐름 관리 ───
import { Game } from './game.js';
import { showTitle, showPick, showEnd, clearScreen, initShop, destroyShop } from './ui/screens.js';
import { showClassJoin, showLobby, showClassResult, showTeacherDash, stopClassWatch } from './ui/classscreens.js';
import { initAudio, resumeAudio, startMusic, SFX, getAudioSettings, setSfxVolume, setMusicVolume, setSfxMuted, setMusicMuted } from './audio/audio.js';
import { preloadArt } from './ui/assets.js';

preloadArt();

let game = null;
let lastChampId = 'flame';

const canvas = document.getElementById('game');

// 첫 상호작용에서 오디오 활성화 + 타이틀 테마
const unlockAudio = () => {
  initAudio();
  resumeAudio();
  startMusic(game ? 'game' : 'title');
};
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('click', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// ── 반 모드 세션 저장 (튕김 복구용) ──
function saveClassSession(ctx, champId) {
  localStorage.setItem('rift_session', JSON.stringify({ ...ctx, champId, t: Date.now() }));
}
function loadClassSession() {
  try {
    const s = JSON.parse(localStorage.getItem('rift_session'));
    if (s && Date.now() - s.t < 30 * 60 * 1000) return s; // 30분 이내만
  } catch {}
  return null;
}
function clearClassSession() {
  localStorage.removeItem('rift_session');
}

function startGame(champId, classCtx = null) {
  lastChampId = champId;
  clearScreen();
  destroyShop();
  stopClassWatch();
  if (classCtx) saveClassSession(classCtx, champId);
  if (game) game.destroy();
  game = new Game(canvas, champId, {
    classCtx,
    onEnd: (g) => {
      destroyShop();
      removeExitButton();
      clearClassSession();
      showEnd(g, (backToTitle) => {
        if (backToTitle) gotoTitle();
        else if (classCtx) gotoClass();
        else gotoPick();
      }, classCtx ? () => showClassResult(classCtx, () => gotoTitle()) : null);
    },
  });
  initShop(game);
  game.start();
  installExitButton();
  window.__game = game; // 개발·디버그용 핸들
}

// ── 게임 중 나가기 (SEL: 홧김 이탈 방지를 위해 확인창을 한 번 거침) ──
let exitBtn = null;
function installExitButton() {
  removeExitButton();
  exitBtn = document.createElement('button');
  exitBtn.id = 'exit-btn';
  exitBtn.className = 'exit-btn';
  exitBtn.setAttribute('aria-label', '나가기');
  exitBtn.textContent = '☰';
  exitBtn.addEventListener('click', confirmExit);
  document.body.appendChild(exitBtn);
  if (settingsBtn) settingsBtn.style.display = 'none'; // 인게임엔 메뉴 기어 숨김(나가기 창에서 접근)
}
function removeExitButton() {
  if (exitBtn) { exitBtn.remove(); exitBtn = null; }
  const c = document.getElementById('exit-confirm');
  if (c) c.remove();
  if (settingsBtn) settingsBtn.style.display = '';
}
function confirmExit() {
  if (!game || game.over || document.getElementById('exit-confirm')) return;
  const savedTs = game.timescale;
  game.timescale = 0; // 결정하는 동안 협곡 일시정지
  const box = document.createElement('div');
  box.id = 'exit-confirm';
  box.className = 'exit-confirm';
  box.innerHTML = `
    <div class="exit-card">
      <div class="exit-emoji">🌙</div>
      <h3>협곡을 떠날까요?</h3>
      <p>지금 나가면 이번 판의 마음 여정과<br>성찰 리포트는 저장되지 않아요.</p>
      <div class="exit-actions">
        <button class="btn-ghost" id="exit-no">계속 할게요</button>
        <button class="btn-danger" id="exit-yes">나가기</button>
      </div>
      <button class="exit-sound-link" id="exit-sound">🎧 사운드 설정</button>
    </div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); if (game) game.timescale = savedTs; };
  box.querySelector('#exit-no').addEventListener('click', close);
  box.querySelector('#exit-yes').addEventListener('click', () => { box.remove(); gotoTitle(); });
  box.querySelector('#exit-sound').addEventListener('click', openSettings);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
}

// ── 사운드 설정 (⚙ 기어: 메뉴 화면 상시, 인게임은 나가기 창에서) ──
let settingsBtn = null;
function createSettingsButton() {
  if (settingsBtn) return;
  settingsBtn = document.createElement('button');
  settingsBtn.id = 'settings-btn';
  settingsBtn.className = 'settings-btn';
  settingsBtn.setAttribute('aria-label', '사운드 설정');
  settingsBtn.textContent = '⚙';
  settingsBtn.addEventListener('click', () => { initAudio(); resumeAudio(); openSettings(); });
  document.body.appendChild(settingsBtn);
}
function openSettings() {
  if (document.getElementById('settings-panel')) return;
  initAudio();
  const pct = (v) => Math.round(v * 100);
  const box = document.createElement('div');
  box.id = 'settings-panel';
  box.className = 'settings-panel';
  const row = (k, icon, label) => {
    const s = getAudioSettings();
    const muted = k === 'music' ? s.musicMuted : s.sfxMuted;
    const vol = k === 'music' ? s.musicVol : s.sfxVol;
    return `<div class="snd-row" data-k="${k}">
      <button class="snd-toggle ${muted ? 'off' : ''}" data-k="${k}">${muted ? '🔇' : icon}</button>
      <span class="snd-label">${label}</span>
      <input type="range" min="0" max="100" value="${pct(vol)}" data-k="${k}" class="snd-slider">
      <span class="snd-val" data-k="${k}">${muted ? '꺼짐' : pct(vol) + '%'}</span>
    </div>`;
  };
  box.innerHTML = `
    <div class="settings-card">
      <h3>🎧 사운드 설정</h3>
      ${row('music', '🎵', '배경음악')}
      ${row('sfx', '🔊', '효과음')}
      <button class="btn-ghost sm" id="settings-close">닫기</button>
    </div>`;
  document.body.appendChild(box);
  const refresh = (k) => {
    const s = getAudioSettings();
    const muted = k === 'music' ? s.musicMuted : s.sfxMuted;
    const vol = k === 'music' ? s.musicVol : s.sfxVol;
    const tog = box.querySelector(`.snd-toggle[data-k="${k}"]`);
    tog.classList.toggle('off', muted);
    tog.textContent = muted ? '🔇' : (k === 'music' ? '🎵' : '🔊');
    box.querySelector(`.snd-slider[data-k="${k}"]`).value = pct(vol);
    box.querySelector(`.snd-val[data-k="${k}"]`).textContent = muted ? '꺼짐' : pct(vol) + '%';
  };
  box.querySelectorAll('.snd-slider').forEach((sl) => {
    sl.addEventListener('input', () => {
      const k = sl.dataset.k, v = +sl.value / 100;
      if (k === 'music') setMusicVolume(v); else setSfxVolume(v);
      refresh(k);
      if (k === 'sfx' && +sl.value > 0) SFX.ping(); // 미리듣기
    });
  });
  box.querySelectorAll('.snd-toggle').forEach((tg) => {
    tg.addEventListener('click', () => {
      const k = tg.dataset.k, s = getAudioSettings();
      const nowMuted = !(k === 'music' ? s.musicMuted : s.sfxMuted);
      if (k === 'music') setMusicMuted(nowMuted); else setSfxMuted(nowMuted);
      refresh(k);
    });
  });
  const close = () => box.remove();
  box.querySelector('#settings-close').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
}

function gotoPick() {
  if (game) { game.destroy(); game = null; }
  removeExitButton();
  destroyShop();
  startMusic('title');
  showPick((champId) => startGame(champId), () => gotoTitle());
}

// ── 반 모드 흐름 ──
function gotoClass() {
  if (game) { game.destroy(); game = null; }
  removeExitButton();
  destroyShop();
  startMusic('title');
  showClassJoin(
    (ctx) => showLobby(ctx, (champId) => startGame(champId, ctx), () => gotoTitle()),
    () => gotoTitle()
  );
}

function gotoTeacher() {
  if (game) { game.destroy(); game = null; }
  removeExitButton();
  destroyShop();
  showTeacherDash(() => gotoTitle());
}

function gotoTitle() {
  if (game) { game.destroy(); game = null; }
  removeExitButton();
  destroyShop();
  stopClassWatch();
  startMusic('title');
  showTitle(() => gotoPick(), () => gotoClass(), () => gotoTeacher());
}

// ── 튕김 복구: 진행 중이던 반 모드 세션 이어하기 ──
function offerResume(saved) {
  const bar = document.createElement('div');
  bar.className = 'resume-bar';
  bar.innerHTML = `
    <span>🔄 진행 중이던 반 모드 경기가 있어요 (방 ${saved.code}, ${saved.name})</span>
    <button class="btn-primary sm" id="rs-yes">이어서 참가</button>
    <button class="btn-ghost sm" id="rs-no">버리기</button>`;
  document.body.appendChild(bar);
  document.getElementById('rs-yes').addEventListener('click', () => {
    bar.remove();
    startGame(saved.champId, { code: saved.code, playerId: saved.playerId, name: saved.name });
  });
  document.getElementById('rs-no').addEventListener('click', () => {
    clearClassSession();
    bar.remove();
  });
}

createSettingsButton(); // 메뉴 화면 상시 사운드 기어

// 교사용 바로가기: index.html#teacher
if (location.hash === '#teacher') gotoTeacher();
else {
  showTitle(() => gotoPick(), () => gotoClass(), () => gotoTeacher());
  const saved = loadClassSession();
  if (saved) offerResume(saved);
}
