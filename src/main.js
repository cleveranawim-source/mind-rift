// ─── 부트스트랩: 화면 흐름 관리 ───
import { Game } from './game.js';
import { showTitle, showPick, showEnd, clearScreen, initShop, destroyShop } from './ui/screens.js';
import { showClassJoin, showLobby, showClassResult, showTeacherDash, stopClassWatch } from './ui/classscreens.js';
import { initAudio, resumeAudio, startMusic } from './audio/audio.js';
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
  window.__game = game; // 개발·디버그용 핸들
}

function gotoPick() {
  if (game) { game.destroy(); game = null; }
  destroyShop();
  startMusic('title');
  showPick((champId) => startGame(champId), () => gotoTitle());
}

// ── 반 모드 흐름 ──
function gotoClass() {
  if (game) { game.destroy(); game = null; }
  destroyShop();
  startMusic('title');
  showClassJoin(
    (ctx) => showLobby(ctx, (champId) => startGame(champId, ctx), () => gotoTitle()),
    () => gotoTitle()
  );
}

function gotoTeacher() {
  if (game) { game.destroy(); game = null; }
  destroyShop();
  showTeacherDash(() => gotoTitle());
}

function gotoTitle() {
  if (game) { game.destroy(); game = null; }
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

// 교사용 바로가기: index.html#teacher
if (location.hash === '#teacher') gotoTeacher();
else {
  showTitle(() => gotoPick(), () => gotoClass(), () => gotoTeacher());
  const saved = loadClassSession();
  if (saved) offerResume(saved);
}
