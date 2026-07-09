// ─── 부트스트랩: 화면 흐름 관리 ───
import { Game } from './game.js';
import { showTitle, showPick, showEnd, clearScreen, initShop, destroyShop } from './ui/screens.js';
import { initAudio, resumeAudio } from './audio/audio.js';
import { preloadArt } from './ui/assets.js';

preloadArt();

let game = null;
let lastChampId = 'flame';

const canvas = document.getElementById('game');

// 첫 상호작용에서 오디오 활성화
window.addEventListener('pointerdown', () => { initAudio(); resumeAudio(); }, { once: true });
window.addEventListener('keydown', () => { initAudio(); resumeAudio(); }, { once: true });

function startGame(champId) {
  lastChampId = champId;
  clearScreen();
  destroyShop();
  if (game) game.destroy();
  game = new Game(canvas, champId, {
    onEnd: (g) => {
      destroyShop();
      showEnd(g, (backToTitle) => {
        if (backToTitle) gotoPick();
        else startGame(lastChampId);
      });
    },
  });
  initShop(game);
  game.start();
  window.__game = game; // 개발·디버그용 핸들
}

function gotoPick() {
  if (game) { game.destroy(); game = null; }
  destroyShop();
  showPick((champId) => startGame(champId));
}

showTitle(() => gotoPick());
