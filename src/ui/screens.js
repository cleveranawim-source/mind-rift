// ─── DOM 화면: 타이틀 · 챔피언 선택 · 상점 · 결과/성찰 ───
import { CHAMPIONS, SHADOWS, ITEMS } from '../data/champions.js';
import { FOUNTAIN } from '../world/map.js';
import { dist } from '../core/math.js';
import { SFX } from '../audio/audio.js';
import { champArt, shadowArt, splashArt } from './assets.js';
import { setMuted } from '../audio/audio.js';

const root = () => document.getElementById('ui-root');

// ═══ 타이틀 ═══
export function showTitle(onStart, onClass = null, onTeacher = null) {
  root().innerHTML = `
    <div class="screen title-screen">
      <div class="title-splash" style="background-image:url('${splashArt}')"></div>
      <div class="title-fade"></div>
      <div class="title-content">
        <div class="title-tag">사회정서학습 × MOBA</div>
        <h1 class="game-title">마음의 협곡</h1>
        <div class="title-sub">MIND RIFT</div>
        <p class="title-desc">
          다섯 개의 그림자 — <b>비난 · 불안 · 분노 · 조급 · 냉소</b>가 협곡을 점령했다.<br>
          마음의 힘을 지닌 다섯 수호자와 함께 그림자 군단의 넥서스를 무너뜨려라.<br>
          진짜 승부는 <b>화면 밖, 너의 마음속</b>에서 벌어진다.
        </p>
        <div class="title-buttons">
          <button class="btn-primary" id="btn-start">협곡 입장</button>
          <button class="btn-ghost" id="btn-class">🏫 반 모드</button>
          <button class="btn-ghost" id="btn-teaser">▶ 티저 영상</button>
        </div>
        <button class="teacher-link" id="btn-teacher">🧑‍🏫 교사 발표모드</button>
        <div class="controls-guide">
          <div><kbd>우클릭</kbd> 이동 / 공격</div>
          <div><kbd>Q</kbd><kbd>W</kbd> 스킬 <kbd>E</kbd> 도약</div>
          <div><kbd>Space</kbd> 심호흡 (멘탈 회복)</div>
          <div><kbd>G</kbd> 핑 (팀 소통) <kbd>B</kbd> 귀환</div>
        </div>
        <div class="sel-badges">
          <span>자기</span><span>대인관계</span><span>공동체</span><span>마음건강</span>
        </div>
      </div>
    </div>`;
  document.getElementById('btn-start').addEventListener('click', () => {
    SFX.click();
    onStart();
  });
  if (onClass) document.getElementById('btn-class').addEventListener('click', () => { SFX.click(); onClass(); });
  if (onTeacher) document.getElementById('btn-teacher').addEventListener('click', () => { SFX.click(); onTeacher(); });
  document.getElementById('btn-teaser').addEventListener('click', () => { SFX.click(); showTeaserModal(); });
}

// ═══ 티저 영상 모달 ═══
export function showTeaserModal() {
  const layer = document.createElement('div');
  layer.className = 'teaser-modal';
  layer.innerHTML = `
    <div class="teaser-backdrop"></div>
    <div class="teaser-box">
      <button class="teaser-close" aria-label="닫기">✕</button>
      <video class="teaser-video" src="./assets/video/teaser.mp4" controls autoplay playsinline></video>
    </div>`;
  document.body.appendChild(layer);
  setMuted(true); // 게임 BGM 음소거 (티저 자체 음악과 겹치지 않게)
  const video = layer.querySelector('.teaser-video');
  const close = () => {
    try { video.pause(); } catch {}
    setMuted(false); // 게임 사운드 복구
    layer.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  layer.querySelector('.teaser-close').addEventListener('click', () => { SFX.click(); close(); });
  layer.querySelector('.teaser-backdrop').addEventListener('click', close);
  video.addEventListener('ended', close);
}

// ═══ 챔피언 선택 ═══
export function showPick(onPick, onBack = null) {
  const cards = CHAMPIONS.map((c) => {
    const shadow = SHADOWS[c.id];
    return `
    <div class="champ-card" data-id="${c.id}" style="--cc:${c.color};--cd:${c.colorDark}">
      <div class="champ-imgwrap">
        <img class="champ-img" src="${champArt(c.id)}" alt="${c.name}" draggable="false" />
      </div>
      <div class="champ-role">${c.role} · ${c.roleEn}</div>
      <div class="champ-name">${c.name}</div>
      <div class="champ-title">${c.title}</div>
      <div class="champ-sel"><b>${c.sel}</b> — ${c.selStrength}</div>
      <div class="champ-desc">${c.selDesc}</div>
      <div class="champ-skills">
        <span title="${c.Q.desc}">Q ${c.Q.name}</span>
        <span title="${c.W.desc}">W ${c.W.name}</span>
      </div>
      <div class="champ-vs">
        <img class="vs-img" src="${shadowArt(c.id)}" alt="${shadow.name}" draggable="false" />
        vs 그림자 <b style="color:${shadow.color}">${shadow.name}</b>
      </div>
    </div>`;
  }).join('');

  root().innerHTML = `
    <div class="screen pick-screen">
      <h2 class="pick-heading">너의 마음의 힘을 선택하라</h2>
      <p class="pick-sub">각 수호자는 하나의 사회정서 강점을 품고 있다 — 지금 너에게 필요한 힘은?</p>
      <div class="champ-grid">${cards}</div>
      <div class="pick-footer">카드를 클릭하면 바로 협곡에 입장합니다</div>
      ${onBack ? '<button class="class-back" id="pick-back">← 처음으로</button>' : ''}
    </div>`;

  root().querySelectorAll('.champ-card').forEach((card) => {
    card.addEventListener('click', () => {
      SFX.click();
      onPick(card.dataset.id);
    });
  });
  const backBtn = document.getElementById('pick-back');
  if (backBtn) backBtn.addEventListener('click', () => { SFX.click(); onBack(); });
}

// ═══ 인게임 상점 ═══
let shopTimer = null;
export function initShop(game) {
  const shop = document.getElementById('shop-layer');
  const render = () => {
    const p = game.player;
    const f = FOUNTAIN[p.team];
    const nearFountain = !p.dead && dist(p.x, p.y, f.x, f.y) < 320;
    if (!nearFountain || game.over) {
      shop.style.display = 'none';
      return;
    }
    shop.style.display = 'block';
    shop.innerHTML = `
      <div class="shop-panel">
        <div class="shop-title">🏪 상점 <span class="shop-gold">◆ ${Math.floor(p.gold)}G</span></div>
        <div class="shop-items">
          ${ITEMS.map((it) => {
            const owned = p.items.filter((x) => x.id === it.id).length;
            const disabled = p.gold < it.cost || (it.unique && owned > 0);
            return `<button class="shop-item ${disabled ? 'disabled' : ''}" data-id="${it.id}">
              <span class="item-icon">${it.icon}</span>
              <span class="item-info"><b>${it.name}</b>${owned ? ` ×${owned}` : ''}<small>${it.desc}</small></span>
              <span class="item-cost">${it.cost}G</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    shop.querySelectorAll('.shop-item:not(.disabled)').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = ITEMS.find((i) => i.id === btn.dataset.id);
        if (item && game.player.gold >= item.cost) {
          game.player.gold -= item.cost;
          game.player.addItem(item);
          SFX.gold();
          render();
        }
      });
    });
  };
  shopTimer = setInterval(render, 400);
}
export function destroyShop() {
  if (shopTimer) { clearInterval(shopTimer); shopTimer = null; }
  const shop = document.getElementById('shop-layer');
  shop.style.display = 'none';
  shop.innerHTML = '';
}

// ═══ 결과 + 성찰 ═══
const AREA_INFO = {
  '자기': { icon: '🪨', color: '#e8a33d', low: '이번 판은 마음이 자주 흔들렸다. 괜찮아, 흔들림을 아는 것이 첫걸음이다.', high: '흔들리는 순간에도 중심을 지켰다. 끈기와 자기조절의 힘이 빛났다.' },
  '마음건강': { icon: '🌿', color: '#9b6dff', low: '멘탈 게이지가 높이 치솟은 순간들이 있었다. 다음엔 심호흡 버튼을 기억하자.', high: '마음의 신호를 알아차리고 스스로를 돌봤다. 진짜 고수의 플레이.' },
  '대인관계': { icon: '💚', color: '#ffd93d', low: '팀원과의 연결이 조금 부족했다. "잘했어!" 핑 하나가 팀을 바꾼다.', high: '격려와 공감으로 팀원의 마음을 움직였다. 함께 강해지는 법을 안다.' },
  '공동체': { icon: '🏰', color: '#4ad1e8', low: '나 혼자의 게임이 되기 쉬웠다. 팀의 목표를 함께 외쳐보자.', high: '팀을 하나로 묶고 공동의 목표를 향해 이끌었다. 공동체의 수호자!' },
};

export function showEnd(game, onRestart, onTeamResult = null) {
  const p = game.player;
  const victory = game.result === 'victory';
  const area = game.sel.computeReflection();

  // 마음 MVP: 최고 영역
  const best = Object.entries(area).sort((a, b) => b[1] - a[1])[0];
  const mvpTitles = {
    '자기': '흔들리지 않는 바위상 🪨',
    '마음건강': '마음 지킴이상 🌿',
    '대인관계': '공감의 달빛상 💚',
    '공동체': '팀의 심장상 🏰',
  };

  const bars = Object.entries(area).map(([name, score]) => {
    const info = AREA_INFO[name];
    return `
      <div class="ref-row">
        <div class="ref-label">${info.icon} ${name}</div>
        <div class="ref-bar"><div class="ref-fill" style="width:${score}%;background:${info.color}"></div></div>
        <div class="ref-score">${Math.round(score)}</div>
      </div>
      <div class="ref-comment">${score >= 60 ? info.high : info.low}</div>`;
  }).join('');

  const choices = game.sel.choiceLog.map((c) =>
    `<li class="${c.good ? 'good' : 'bad'}"><b>${c.event}</b> — ${c.choice}</li>`
  ).join('') || '<li>이번 판에는 선택의 순간이 오지 않았다.</li>';

  root().innerHTML = `
    <div class="screen end-screen ${victory ? 'victory' : 'defeat'}">
      <div class="end-content">
        <img class="end-portrait" src="${champArt(p.champ.id)}" alt="${p.name}" style="border-color:${p.color}" />
        <div class="end-result">${victory ? '🏆 승리!' : '🌧️ 패배…'}</div>
        <div class="end-sub">${victory ? '그림자 군단의 넥서스가 무너졌다' : '오늘의 협곡은 그림자의 것. 하지만 진짜 성장은 지금부터'}</div>

        <div class="end-stats">
          <div><b>${p.kills}</b><span>처치</span></div>
          <div><b>${p.deaths}</b><span>죽음</span></div>
          <div><b>${p.assists}</b><span>도움</span></div>
          <div><b>${p.cs}</b><span>CS</span></div>
          <div><b>${game.sel.breathCount}</b><span>심호흡</span></div>
          <div><b>${game.sel.pingCounts.praise}</b><span>격려 핑</span></div>
        </div>

        <div class="mvp-badge">마음 MVP<br><b>${mvpTitles[best[0]]}</b></div>

        <h3 class="ref-heading">📋 마음 성찰 리포트</h3>
        <div class="ref-grid">${bars}</div>

        <details class="choice-log">
          <summary>이번 판의 마음의 순간들</summary>
          <ul>${choices}</ul>
        </details>

        <div class="ref-question">
          💭 <b>돌아보기</b> — 오늘 협곡에서 내 멘탈이 가장 크게 흔들린 순간은 언제였나?<br>
          현실의 나라면, 그 순간 나에게 뭐라고 말해줄까?
        </div>

        <div class="end-buttons">
          ${onTeamResult
            ? '<button class="btn-primary" id="btn-team">📡 팀 결과 보기</button><button class="btn-ghost" id="btn-title">처음으로</button>'
            : '<button class="btn-primary" id="btn-restart">다시 도전</button><button class="btn-ghost" id="btn-title">챔피언 다시 선택</button>'}
        </div>
      </div>
    </div>`;

  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) restartBtn.addEventListener('click', () => { SFX.click(); onRestart(false); });
  const teamBtn = document.getElementById('btn-team');
  if (teamBtn) teamBtn.addEventListener('click', () => { SFX.click(); onTeamResult(); });
  document.getElementById('btn-title').addEventListener('click', () => { SFX.click(); onRestart(true); });
}

export function clearScreen() {
  root().innerHTML = '';
}
