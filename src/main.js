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

function startGame(champId, classCtx = null) {
  lastChampId = champId;
  clearScreen();
  destroyShop();
  stopClassWatch();
  if (game) game.destroy();
  game = new Game(canvas, champId, {
    classCtx,
    onEnd: (g) => {
      destroyShop();
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
  showPick((champId) => startGame(champId));
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

// 교사용 바로가기: index.html#teacher
if (location.hash === '#teacher') gotoTeacher();
else showTitle(() => gotoPick(), () => gotoClass(), () => gotoTeacher());
