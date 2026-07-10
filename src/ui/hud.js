// ─── HUD: 스킬바 · 체력 · 멘탈 게이지 · 미니맵 · 킬피드 · 아나운서 · 핑 휠 ───
import { clamp, TAU, dist } from '../core/math.js';
import { WORLD, LANES, NEXUS_POS } from '../world/map.js';
import { DASH } from '../data/champions.js';
import { TEAM_COLOR } from '../entities/units.js';
import { champArt, drawPortraitCircle } from './assets.js';

export const MINIMAP = { size: 210, pad: 14 }; // 우하단

export function minimapRect(game) {
  const s = MINIMAP.size;
  return { x: game.vw - s - MINIMAP.pad, y: game.vh - s - MINIMAP.pad, s };
}

export function drawHUD(ctx, game) {
  const p = game.player;
  const vw = game.vw, vh = game.vh;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  drawTiltGauge(ctx, game);
  drawTopBar(ctx, game);
  drawSkillBar(ctx, game);
  drawMinimap(ctx, game);
  drawKillFeed(ctx, game);
  drawAnnouncer(ctx, game);
  drawTiltVignette(ctx, game);
  if (game.sel.breathing) drawBreathOverlay(ctx, game);
  if (p.dead) drawDeathOverlay(ctx, game);
  if (game.sel.pingWheel) drawPingWheel(ctx, game);
  drawObjectiveBanner(ctx, game);

  ctx.restore();
}

// ── 멘탈 게이지 (좌상단) ──
function drawTiltGauge(ctx, game) {
  const sel = game.sel;
  const x = 18, y = 18, w = 230, h = 46;
  // 패널
  ctx.fillStyle = 'rgba(8,14,10,0.75)';
  roundRect(ctx, x, y, w, h, 10); ctx.fill();
  if (sel.tiltFlash > 0) {
    ctx.strokeStyle = `rgba(255,80,60,${sel.tiltFlash})`;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 10); ctx.stroke();
  }
  // 라벨
  ctx.font = 'bold 13px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9fb8a8';
  ctx.fillText('멘탈', x + 12, y + 19);
  const tier = sel.tiltTier();
  const tierText = tier === 2 ? '틸트!' : tier === 1 ? '흔들림' : '안정';
  const tierColor = tier === 2 ? '#ff5544' : tier === 1 ? '#ffc247' : '#3fe5a0';
  ctx.textAlign = 'right';
  ctx.fillStyle = tierColor;
  ctx.fillText(tierText, x + w - 12, y + 19);
  // 게이지 바 (낮을수록 좋음 → 채워지는 건 "동요")
  const bx = x + 12, by = y + 26, bw = w - 24, bh = 11;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, bx, by, bw, bh, 5); ctx.fill();
  const ratio = sel.tilt / 100;
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#3fe5a0');
  grad.addColorStop(0.45, '#ffc247');
  grad.addColorStop(1, '#ff5544');
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, 5); ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw * ratio, bh);
  // 틸트 높으면 게이지 진동
  if (tier === 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(bx + bw * ratio - 4 + Math.sin(game.time * 30) * 3, by, 4, bh);
  }
  ctx.restore();
  // 심호흡 힌트
  if (tier >= 1 && !sel.breathing) {
    ctx.font = '11px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(63,229,160,${0.6 + Math.sin(game.time * 4) * 0.35})`;
    ctx.fillText('[스페이스] 길게 눌러 심호흡', x + 2, y + h + 16);
  }
  // 팀 사기
  const my = y + h + 24;
  ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#9fb8a8';
  ctx.fillText('팀 사기', x + 2, my + 10);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, x + 52, my + 2, 120, 9, 4); ctx.fill();
  ctx.fillStyle = sel.morale > 65 ? '#3fe5a0' : sel.morale > 40 ? '#ffc247' : '#ff5544';
  roundRect(ctx, x + 52, my + 2, 120 * (sel.morale / 100), 9, 4); ctx.fill();
}

// ── 상단 바: 스코어 + 시간 ──
function drawTopBar(ctx, game) {
  const vw = game.vw;
  const w = 240, h = 40, x = vw / 2 - w / 2, y = 10;
  ctx.fillStyle = 'rgba(8,14,10,0.75)';
  roundRect(ctx, x, y, w, h, 10); ctx.fill();
  ctx.font = 'bold 19px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = TEAM_COLOR.blue;
  ctx.fillText(`${game.teamKills.blue}`, x + 50, y + 27);
  ctx.fillStyle = TEAM_COLOR.red;
  ctx.fillText(`${game.teamKills.red}`, x + w - 50, y + 27);
  ctx.fillStyle = '#e8f4ec';
  ctx.font = 'bold 15px "Noto Sans KR", sans-serif';
  const t = Math.floor(game.time);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  ctx.fillText(`${mm}:${ss}`, x + w / 2, y + 26);
  ctx.font = '10px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#7a9484';
  ctx.fillText('마음팀', x + 50, y + 38 + 2);
  ctx.fillText('그림자 군단', x + w - 50, y + 40);
}

// ── 스킬바 + 자원 (하단 중앙) ──
function drawSkillBar(ctx, game) {
  const p = game.player;
  const vw = game.vw, vh = game.vh;
  const slotW = 58, gap = 10;
  const totalW = slotW * 4 + gap * 3;
  const x0 = vw / 2 - totalW / 2, y0 = vh - 118;

  // 패널 배경
  ctx.fillStyle = 'rgba(8,14,10,0.8)';
  roundRect(ctx, x0 - 16, y0 - 44, totalW + 32, 152, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(63,229,160,0.15)';
  ctx.lineWidth = 1;
  roundRect(ctx, x0 - 16, y0 - 44, totalW + 32, 152, 14); ctx.stroke();

  // 초상 + 레벨 (왼쪽) — AI 아트 초상, 미로드 시 폴백
  const px = x0 - 70, py = y0 + 8;
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(px, py + 12, 30, 0, TAU); ctx.stroke();
  if (!drawPortraitCircle(ctx, champArt(p.champ.id), px, py + 12, 27)) {
    const grad = ctx.createRadialGradient(px - 8, py + 4, 5, px, py + 12, 30);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, p.champ.colorDark);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py + 12, 27, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name[0], px, py + 20);
  }
  // 레벨 뱃지
  ctx.fillStyle = '#0a120d';
  ctx.beginPath(); ctx.arc(px + 22, py + 32, 11, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd93d';
  ctx.font = 'bold 12px "Noto Sans KR", sans-serif';
  ctx.fillText(p.level, px + 22, py + 36);

  // HP / MP 바
  const barX = x0, barY = y0 - 34, barW = totalW, barH = 15;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, barX, barY, barW, barH, 6); ctx.fill();
  ctx.save();
  roundRect(ctx, barX, barY, barW, barH, 6); ctx.clip();
  const hpGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  hpGrad.addColorStop(0, '#2ecc71'); hpGrad.addColorStop(1, '#3fe5a0');
  ctx.fillStyle = hpGrad;
  ctx.fillRect(barX, barY, barW * clamp(p.hp / p.maxHp, 0, 1), barH);
  if (p.shield > 0) {
    ctx.fillStyle = 'rgba(200,230,255,0.85)';
    const hpr = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillRect(barX + barW * hpr, barY, barW * clamp(p.shield / p.maxHp, 0, 1 - hpr), barH);
  }
  ctx.restore();
  ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#08130c';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`, barX + barW / 2, barY + 12);
  // MP
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, barX, barY + 19, barW, 9, 4); ctx.fill();
  ctx.fillStyle = '#4a7dff';
  roundRect(ctx, barX, barY + 19, barW * clamp(p.mana / p.maxMana, 0, 1), 9, 4); ctx.fill();

  // 스킬 슬롯 Q W E + B(귀환)
  const slots = [
    { key: 'Q', def: p.champ.Q, cd: p.cooldowns.Q },
    { key: 'W', def: p.champ.W, cd: p.cooldowns.W },
    { key: 'E', def: DASH, cd: p.cooldowns.E },
    { key: 'B', def: { name: '귀환', mana: 0, cd: 0 }, cd: 0, recall: true },
  ];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const sx = x0 + i * (slotW + gap), sy = y0 + 6;
    // 슬롯 배경
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, sx, sy, slotW, slotW, 9); ctx.fill();
    ctx.strokeStyle = s.recall && game.player.recalling ? '#3fe5a0' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, sx, sy, slotW, slotW, 9); ctx.stroke();
    // 아이콘 (스킬명 첫 글자)
    ctx.font = 'bold 21px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    const noMana = !s.recall && p.mana < s.def.mana;
    ctx.fillStyle = noMana ? '#5577cc' : s.recall ? '#9fb8a8' : p.color;
    ctx.fillText(s.recall ? '⌂' : s.def.name[0], sx + slotW / 2, sy + 34);
    // 쿨다운 오버레이
    if (s.cd > 0) {
      const def = s.key === 'E' ? DASH : s.def;
      const frac = clamp(s.cd / def.cd, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.moveTo(sx + slotW / 2, sy + slotW / 2);
      ctx.arc(sx + slotW / 2, sy + slotW / 2, slotW * 0.75, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.closePath();
      ctx.save();
      roundRect(ctx, sx, sy, slotW, slotW, 9); ctx.clip();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
      ctx.fillText(Math.ceil(s.cd), sx + slotW / 2, sy + slotW / 2 + 6);
    }
    // 키 표시
    ctx.fillStyle = 'rgba(8,14,10,0.9)';
    roundRect(ctx, sx + slotW - 18, sy + slotW - 18, 16, 16, 4); ctx.fill();
    ctx.fillStyle = '#e8f4ec';
    ctx.font = 'bold 10px "Noto Sans KR", sans-serif';
    ctx.fillText(s.key, sx + slotW - 10, sy + slotW - 6);
  }

  // 스탯 줄 (골드 · KDA · CS)
  ctx.font = 'bold 12px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffcf40';
  ctx.fillText(`◆ ${Math.floor(p.gold)}G`, x0, y0 + 84);
  ctx.fillStyle = '#e8f4ec';
  ctx.textAlign = 'center';
  ctx.fillText(`${p.kills} / ${p.deaths} / ${p.assists}`, x0 + totalW / 2, y0 + 84);
  ctx.fillStyle = '#9fb8a8';
  ctx.textAlign = 'right';
  ctx.fillText(`CS ${p.cs}`, x0 + totalW, y0 + 84);
}

// ── 미니맵 (우하단) ──
function drawMinimap(ctx, game) {
  const { x, y, s } = minimapRect(game);
  const k = s / WORLD;
  ctx.save();
  ctx.fillStyle = 'rgba(8,14,10,0.85)';
  roundRect(ctx, x - 4, y - 4, s + 8, s + 8, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(63,229,160,0.25)';
  ctx.lineWidth = 1;
  roundRect(ctx, x - 4, y - 4, s + 8, s + 8, 8); ctx.stroke();
  ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  ctx.fillStyle = '#101f16';
  ctx.fillRect(x, y, s, s);

  // 실제 지형 축소판
  if (game.terrain) {
    ctx.drawImage(game.terrain, x, y, s, s);
    ctx.fillStyle = 'rgba(6,12,8,0.25)';
    ctx.fillRect(x, y, s, s);
  } else {
    ctx.strokeStyle = 'rgba(200,185,120,0.3)';
    ctx.lineWidth = 3;
    for (const pts of Object.values(LANES)) {
      ctx.beginPath();
      ctx.moveTo(x + pts[0][0] * k, y + pts[0][1] * k);
      for (const [wx, wy] of pts) ctx.lineTo(x + wx * k, y + wy * k);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(64,181,208,0.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + WORLD * 0.275 * k, y + WORLD * 0.275 * k);
    ctx.lineTo(x + WORLD * 0.725 * k, y + WORLD * 0.725 * k);
    ctx.stroke();
  }

  // 타워
  for (const t of game.towers) {
    if (t.dead) continue;
    ctx.fillStyle = TEAM_COLOR[t.team];
    ctx.fillRect(x + t.x * k - 3, y + t.y * k - 3, 6, 6);
  }
  // 넥서스
  for (const n of [game.nexus.blue, game.nexus.red]) {
    if (n.dead) continue;
    ctx.fillStyle = TEAM_COLOR[n.team];
    ctx.beginPath(); ctx.arc(x + n.x * k, y + n.y * k, 5, 0, TAU); ctx.fill();
  }
  // 오브젝트
  for (const m of [game.spirit, game.sage]) {
    if (m && !m.dead) {
      ctx.fillStyle = '#7ae8d0';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('◈', x + m.x * k, y + m.y * k + 3);
    }
  }
  // 미니언 (아군 팀만 점)
  ctx.globalAlpha = 0.7;
  for (const m of game.minions) {
    if (m.dead) continue;
    if (m.team !== game.player.team && !game.isVisible(m)) continue;
    ctx.fillStyle = TEAM_COLOR[m.team];
    ctx.fillRect(x + m.x * k - 1, y + m.y * k - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
  // 영웅
  for (const h of game.heroes) {
    if (h.dead) continue;
    if (h.team !== game.player.team && !game.isVisible(h)) continue;
    ctx.fillStyle = h.isPlayer ? '#fff' : TEAM_COLOR[h.team];
    ctx.beginPath(); ctx.arc(x + h.x * k, y + h.y * k, h.isPlayer ? 4.5 : 3.5, 0, TAU); ctx.fill();
    if (h.isPlayer) {
      ctx.strokeStyle = '#3fe5a0';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x + h.x * k, y + h.y * k, 6, 0, TAU); ctx.stroke();
    }
  }
  // 핑
  for (const ping of game.sel.pings) {
    const pulse = 1 + Math.sin(game.time * 8) * 0.4;
    ctx.strokeStyle = PING_TYPES[ping.type].color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + ping.x * k, y + ping.y * k, 6 * pulse, 0, TAU); ctx.stroke();
  }
  // 카메라 뷰포트 (3D 투영 근사)
  const ct = game.r3d.camTarget;
  const ws = Math.max(0.0001, game.r3d.worldScaleAt(ct.x, ct.z));
  const vwWorld = game.vw / ws, vhWorld = game.vh / (ws * 0.62);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + (ct.x - vwWorld / 2) * k, y + (ct.z - vhWorld / 2) * k, vwWorld * k, vhWorld * k);
  ctx.restore();
}

// ── 킬피드 (우상단) ──
function drawKillFeed(ctx, game) {
  const x = game.vw - 16, y0 = 60;
  ctx.font = 'bold 12px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'right';
  let i = 0;
  for (const f of game.killFeed) {
    const alpha = clamp(f.t / 1.5, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(8,14,10,0.75)';
    const w = ctx.measureText(f.text).width + 20;
    roundRect(ctx, x - w, y0 + i * 28 - 15, w, 22, 6); ctx.fill();
    ctx.fillStyle = f.color || '#e8f4ec';
    ctx.fillText(f.text, x - 10, y0 + i * 28);
    i++;
  }
  ctx.globalAlpha = 1;
}

// ── 아나운서 (중앙 대형 텍스트) ──
function drawAnnouncer(ctx, game) {
  const a = game.announcement;
  if (!a || a.t <= 0) return;
  const alpha = clamp(Math.min(a.t / 0.4, (a.dur - a.t) / 0.4 + 1), 0, 1);
  const scale = 1 + Math.max(0, (a.t - a.dur + 0.3)) * 0.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(game.vw / 2, game.vh * 0.26);
  ctx.scale(scale, scale);
  ctx.font = 'bold 34px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(a.text, 0, 0);
  ctx.fillStyle = a.color;
  ctx.fillText(a.text, 0, 0);
  if (a.sub) {
    ctx.font = 'bold 15px "Noto Sans KR", sans-serif';
    ctx.strokeText(a.sub, 0, 28);
    ctx.fillStyle = '#e8f4ec';
    ctx.fillText(a.sub, 0, 28);
  }
  ctx.restore();
}

// ── 틸트 비네트 ──
function drawTiltVignette(ctx, game) {
  const tier = game.sel.tiltTier();
  if (tier === 0) return;
  const vw = game.vw, vh = game.vh;
  const strength = tier === 2 ? 0.4 + Math.sin(game.time * 5) * 0.12 : 0.16;
  const color = tier === 2 ? '255,50,30' : '255,180,60';
  const grad = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.38, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
  grad.addColorStop(0, `rgba(${color},0)`);
  grad.addColorStop(1, `rgba(${color},${strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, vw, vh);
}

// ── 심호흡 오버레이 ──
function drawBreathOverlay(ctx, game) {
  const sel = game.sel;
  const t = sel.breathT / sel.breathDur;
  const cx = game.vw / 2, cy = game.vh / 2 - 40;
  ctx.fillStyle = 'rgba(5,12,8,0.35)';
  ctx.fillRect(0, 0, game.vw, game.vh);
  // 호흡 원 (들숨-날숨 리듬)
  const breathe = 60 + Math.sin(t * Math.PI * 2 - Math.PI / 2) * 26;
  ctx.strokeStyle = '#3fe5a0';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(cx, cy, breathe, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#3fe5a0';
  ctx.beginPath(); ctx.arc(cx, cy, breathe, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // 진행 링
  ctx.strokeStyle = 'rgba(63,229,160,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, 96, -Math.PI / 2, -Math.PI / 2 + TAU * t); ctx.stroke();
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8f4ec';
  const phase = (t * 2) % 1;
  ctx.fillText(t < 0.5 ? '천천히 들이쉬고…' : '천천히 내쉬고…', cx, cy + 140);
}

// ── 사망 오버레이 ──
function drawDeathOverlay(ctx, game) {
  const p = game.player;
  ctx.fillStyle = 'rgba(10,5,5,0.55)';
  ctx.fillRect(0, 0, game.vw, game.vh);
  ctx.font = 'bold 28px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff8877';
  ctx.fillText('쓰러졌다…', game.vw / 2, game.vh / 2 - 30);
  ctx.font = 'bold 48px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#e8f4ec';
  ctx.fillText(Math.ceil(p.respawnT), game.vw / 2, game.vh / 2 + 30);
  ctx.font = '14px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#9fb8a8';
  ctx.fillText('죽음도 게임의 일부. 이 시간에 무엇을 배울 수 있을까?', game.vw / 2, game.vh / 2 + 70);
}

// ── 핑 휠 ──
export const PING_TYPES = {
  danger: { label: '위험!', icon: '⚠️', color: '#ff5544', angle: -Math.PI / 2 },
  gather: { label: '집결!', icon: '🚩', color: '#4a9eff', angle: 0 },
  retreat: { label: '후퇴!', icon: '↩️', color: '#ffc247', angle: Math.PI / 2 },
  praise: { label: '잘했어!', icon: '💚', color: '#3fe5a0', angle: Math.PI },
};

function drawPingWheel(ctx, game) {
  const wheel = game.sel.pingWheel;
  const cx = wheel.sx, cy = wheel.sy;
  const R = 92;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(8,14,10,0.85)';
  ctx.beginPath(); ctx.arc(cx, cy, R + 26, 0, TAU); ctx.fill();
  // 선택 하이라이트
  const sel = pingWheelSelection(game);
  for (const [type, def] of Object.entries(PING_TYPES)) {
    const px = cx + Math.cos(def.angle) * R * 0.62;
    const py = cy + Math.sin(def.angle) * R * 0.62;
    if (sel === type) {
      ctx.fillStyle = def.color + '33';
      ctx.beginPath(); ctx.arc(px, py, 40, 0, TAU); ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 40, 0, TAU); ctx.stroke();
    }
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.icon, px, py - 2);
    ctx.font = 'bold 12px "Noto Sans KR", sans-serif';
    ctx.fillStyle = sel === type ? def.color : '#c8d8cc';
    ctx.fillText(def.label, px, py + 20);
  }
  ctx.restore();
}

export function pingWheelSelection(game) {
  const wheel = game.sel.pingWheel;
  if (!wheel) return null;
  const dx = game.input.mx - wheel.sx;
  const dy = game.input.my - wheel.sy;
  if (Math.hypot(dx, dy) < 24) return null;
  const a = Math.atan2(dy, dx);
  let best = null, bestDiff = Infinity;
  for (const [type, def] of Object.entries(PING_TYPES)) {
    let diff = Math.abs(a - def.angle);
    if (diff > Math.PI) diff = TAU - diff;
    if (diff < bestDiff) { bestDiff = diff; best = type; }
  }
  return best;
}

// ── 오브젝트 배너 (정령/수호자 등장) ──
function drawObjectiveBanner(ctx, game) {
  const b = game.objBanner;
  if (!b || b.t <= 0) return;
  const alpha = clamp(Math.min(b.t / 0.5, 1), 0, 1);
  ctx.globalAlpha = alpha;
  ctx.font = 'bold 15px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(b.text).width + 40;
  ctx.fillStyle = 'rgba(8,14,10,0.8)';
  roundRect(ctx, game.vw / 2 - w / 2, 58, w, 30, 15); ctx.fill();
  ctx.strokeStyle = 'rgba(122,232,208,0.4)';
  ctx.lineWidth = 1;
  roundRect(ctx, game.vw / 2 - w / 2, 58, w, 30, 15); ctx.stroke();
  ctx.fillStyle = '#7ae8d0';
  ctx.fillText(b.text, game.vw / 2, 78);
  ctx.globalAlpha = 1;
}

// ── 월드 핑 마커 (3D 투영) ──
export function drawWorldPings(ctx, game) {
  const FS = 0.62;
  for (const ping of game.sel.pings) {
    const def = PING_TYPES[ping.type];
    const age = 2.4 - ping.t;
    const pulse = 1 + (age % 0.6) * 1.2;
    const pt = game.r3d.project(ping.x, ping.y, 2);
    const sc = game.r3d.worldScaleAt(ping.x, ping.y);
    ctx.globalAlpha = clamp(ping.t / 0.5, 0, 1);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(pt.x, pt.y, 24 * pulse * sc, 24 * pulse * sc * FS, 0, 0, TAU);
    ctx.stroke();
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.icon, pt.x, pt.y - 34);
    ctx.font = 'bold 13px "Noto Sans KR", sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(def.label, pt.x, pt.y + 34);
    ctx.fillStyle = def.color;
    ctx.fillText(def.label, pt.x, pt.y + 34);
    ctx.globalAlpha = 1;
  }
}

// ── 유닛 체력바·이름표 오버레이 (3D 투영) ──
function bar(ctx, cx, topY, w, h, ratio, color, { shield = 0, mana = null, ticks = 0 } = {}) {
  const x = cx - w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(x - 1, topY - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(x, topY, w * clamp(ratio, 0, 1), h);
  if (ticks > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 1; i < ticks; i++) ctx.fillRect(x + (i / ticks) * w, topY, 1, h);
  }
  if (shield > 0) {
    ctx.fillStyle = 'rgba(200,230,255,0.9)';
    ctx.fillRect(x + w * clamp(ratio, 0, 1), topY, Math.min(w * shield, w - w * clamp(ratio, 0, 1)), h);
  }
  if (mana != null) {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x - 1, topY + h + 1, w + 2, 4);
    ctx.fillStyle = '#4a7dff';
    ctx.fillRect(x, topY + h + 1, w * clamp(mana, 0, 1), 3);
  }
}

function unitColor(u, game) {
  if (u === game.player) return '#3fe5a0';
  if (u.team === game.player.team) return '#4a9eff';
  if (u.team === 'neutral') return '#c8a44a';
  return '#ff5555';
}

export function drawUnitBars(ctx, game) {
  const P = (x, y, h) => game.r3d.project(x, y, h);
  const S = (x, y) => clamp(game.r3d.worldScaleAt(x, y), 0.5, 1.4);
  ctx.textAlign = 'center';

  // 영웅
  for (const u of game.heroes) {
    if (u.dead || !game.isVisible(u)) continue;
    const sc = S(u.x, u.y);
    const pt = P(u.x, u.y, u.radius * 3.8);
    // 이름표
    ctx.font = `bold ${Math.round(12 * sc)}px "Noto Sans KR", sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const label = `${u.name} · ${u.level}`;
    ctx.strokeText(label, pt.x, pt.y - 8);
    ctx.fillStyle = u.isPlayer ? '#3fe5a0' : (u.team === game.player.team ? '#bcd8ff' : '#ffb0a8');
    ctx.fillText(label, pt.x, pt.y - 8);
    bar(ctx, pt.x, pt.y - 2, 56 * sc, 6, u.hp / u.maxHp, unitColor(u, game), {
      shield: u.shield / u.maxHp,
      mana: u.maxMana ? u.mana / u.maxMana : null,
      ticks: Math.floor(u.maxHp / 200),
    });
    // 귀환 채널
    if (u.recalling) {
      const gp = P(u.x, u.y, 2);
      const t = u.recallT / 4.2;
      ctx.strokeStyle = TEAM_COLOR[u.team];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(gp.x, gp.y, 40 * sc, 40 * sc * 0.62, 0, -Math.PI / 2, -Math.PI / 2 + TAU * t);
      ctx.stroke();
    }
    // 보호막 시각화
    if (u.shield > 0) {
      const gp = P(u.x, u.y, 30);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#aaddff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(gp.x, gp.y, u.radius * 1.9 * sc, u.radius * 1.9 * sc * 0.75, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // 미니언 (다쳤을 때만)
  for (const u of game.minions) {
    if (u.dead || u.hp >= u.maxHp || !game.isVisible(u)) continue;
    const sc = S(u.x, u.y);
    const pt = P(u.x, u.y, u.radius * 2.9);
    bar(ctx, pt.x, pt.y, 26 * sc, 3.5, u.hp / u.maxHp, unitColor(u, game));
  }
  // 타워 / 넥서스
  for (const u of game.towers) {
    if (u.dead) continue;
    const sc = S(u.x, u.y);
    const pt = P(u.x, u.y, 150);
    bar(ctx, pt.x, pt.y, 60 * sc, 6, u.hp / u.maxHp, u.invulnerable ? '#8a95a0' : unitColor(u, game));
  }
  for (const team of ['blue', 'red']) {
    const n = game.nexus[team];
    if (n.dead) continue;
    const sc = S(n.x, n.y);
    const pt = P(n.x, n.y, 160);
    bar(ctx, pt.x, pt.y, 86 * sc, 7, n.hp / n.maxHp, n.invulnerable ? '#8a95a0' : unitColor(n, game));
  }
  // 몬스터
  for (const u of game.monsters) {
    if (u.dead) continue;
    const sc = S(u.x, u.y);
    const pt = P(u.x, u.y, u.radius * 3.1);
    if (u.hp < u.maxHp || u.def.big) {
      bar(ctx, pt.x, pt.y, (u.def.big ? 48 : 34) * sc, 5, u.hp / u.maxHp, '#c8a44a');
    }
    // 이름 (가까울 때)
    if (dist(u.x, u.y, game.player.x, game.player.y) < 520) {
      ctx.font = `bold ${Math.round(11 * sc)}px "Noto Sans KR", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(u.def.name, pt.x, pt.y - 6);
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText(u.def.name, pt.x, pt.y - 6);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
