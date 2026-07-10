// ─── WebAudio 신디사이저 SFX 시스템 ───
// 외부 파일 없이 코드로 합성한 효과음. 첫 사용자 입력 후 활성화.

let ctx = null;
let master = null;
let sfxGain = null;
let musicGain = null;
let enabled = true;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.35;
    musicGain.connect(master);
  } catch (e) {
    enabled = false;
  }
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function now() { return ctx ? ctx.currentTime : 0; }

// 기본 톤 발생기
function tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.15, vol = 0.3, attack = 0.005, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = now() + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// 노이즈 버스트 (타격감)
function noise({ dur = 0.1, vol = 0.2, freq = 1200, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = now() + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(sfxGain);
  src.start(t0);
}

// ─── 게임 SFX 카탈로그 ───
export const SFX = {
  attackMelee() {
    noise({ dur: 0.08, vol: 0.28, freq: 900 });
    noise({ dur: 0.05, vol: 0.18, freq: 2400 });          // 날카로운 크랙
    tone({ freq: 110, freqEnd: 48, type: 'sine', dur: 0.14, vol: 0.35 }); // 묵직한 저음 임팩트
    tone({ freq: 180, freqEnd: 90, type: 'triangle', dur: 0.08, vol: 0.18 });
  },
  attackRanged() { tone({ freq: 700, freqEnd: 1400, type: 'sine', dur: 0.09, vol: 0.12 }); noise({ dur: 0.06, vol: 0.08, freq: 3200 }); },
  hit() {
    noise({ dur: 0.07, vol: 0.3, freq: 1600 });
    tone({ freq: 220, freqEnd: 110, type: 'sine', dur: 0.1, vol: 0.2 }); // 몸에 맞는 둔탁함
  },
  abilityQ() { tone({ freq: 520, freqEnd: 980, type: 'sawtooth', dur: 0.18, vol: 0.14 }); noise({ dur: 0.12, vol: 0.1, freq: 2000 }); },
  abilityW() { tone({ freq: 330, freqEnd: 660, type: 'square', dur: 0.22, vol: 0.1 }); },
  dash() { noise({ dur: 0.18, vol: 0.18, freq: 3000 }); tone({ freq: 900, freqEnd: 300, type: 'sine', dur: 0.18, vol: 0.1 }); },
  heal() { tone({ freq: 520, type: 'sine', dur: 0.3, vol: 0.12 }); tone({ freq: 780, type: 'sine', dur: 0.3, vol: 0.1, delay: 0.08 }); },
  shield() { tone({ freq: 440, freqEnd: 880, type: 'triangle', dur: 0.25, vol: 0.12 }); },
  kill() {
    // 웅장한 처치 호른 (5도 스택 + 심벌)
    tone({ freq: 220, type: 'sawtooth', dur: 0.45, vol: 0.2 });
    tone({ freq: 330, type: 'sawtooth', dur: 0.45, vol: 0.16, delay: 0.08 });
    tone({ freq: 440, type: 'sawtooth', dur: 0.55, vol: 0.15, delay: 0.16 });
    tone({ freq: 110, type: 'sine', dur: 0.6, vol: 0.22 });
    noise({ dur: 0.5, vol: 0.1, freq: 6000, delay: 0.16 }); // 심벌 스월
  },
  death() { tone({ freq: 300, freqEnd: 60, type: 'sawtooth', dur: 0.6, vol: 0.2 }); tone({ freq: 90, freqEnd: 35, type: 'sine', dur: 0.7, vol: 0.25 }); },
  towerHit() { noise({ dur: 0.15, vol: 0.35, freq: 500 }); tone({ freq: 120, freqEnd: 60, type: 'triangle', dur: 0.2, vol: 0.3 }); },
  towerDown() {
    // 무너지는 굉음: 저음 럼블 + 잔해
    noise({ dur: 0.7, vol: 0.4, freq: 300 });
    noise({ dur: 1.1, vol: 0.25, freq: 140, delay: 0.15 });
    tone({ freq: 150, freqEnd: 34, type: 'sawtooth', dur: 1.0, vol: 0.3 });
    tone({ freq: 60, freqEnd: 28, type: 'sine', dur: 1.3, vol: 0.35 });
    noise({ dur: 0.25, vol: 0.15, freq: 900, delay: 0.5 }); // 돌조각
  },
  gold() { tone({ freq: 1200, type: 'sine', dur: 0.06, vol: 0.08 }); tone({ freq: 1600, type: 'sine', dur: 0.08, vol: 0.07, delay: 0.05 }); },
  levelUp() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.12, delay: i * 0.07 })); },
  ping() { tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.15 }); tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.12, delay: 0.15 }); },
  pingPraise() { [659, 784, 988].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.15, vol: 0.1, delay: i * 0.08 })); },
  breathe() { tone({ freq: 220, freqEnd: 330, type: 'sine', dur: 1.2, vol: 0.06, attack: 0.4 }); },
  breatheDone() { [392, 523, 659].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.4, vol: 0.1, delay: i * 0.12 })); },
  event() { tone({ freq: 440, type: 'triangle', dur: 0.3, vol: 0.14 }); tone({ freq: 554, type: 'triangle', dur: 0.4, vol: 0.12, delay: 0.15 }); },
  choiceGood() { [523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.25, vol: 0.1, delay: i * 0.09 })); },
  choiceBad() { tone({ freq: 260, freqEnd: 180, type: 'sawtooth', dur: 0.4, vol: 0.12 }); },
  click() { tone({ freq: 800, type: 'sine', dur: 0.05, vol: 0.1 }); },
  recall() { tone({ freq: 440, freqEnd: 880, type: 'sine', dur: 1.0, vol: 0.08, attack: 0.3 }); },
  victory() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.15, delay: i * 0.15 })); },
  defeat() { [440, 392, 330, 262].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.13, delay: i * 0.2 })); },
  minionDie() { noise({ dur: 0.08, vol: 0.12, freq: 700 }); },
  buff() { tone({ freq: 660, freqEnd: 1320, type: 'sine', dur: 0.4, vol: 0.1 }); },
};

// ═══════════════════════════════════════════════════════
// BGM 시스템
// 1) public/assets/audio/bgm_game.mp3 · bgm_title.mp3 파일이 있으면 그걸 루프 재생 (Suno 트랙 투입용)
// 2) 없으면 프로시저럴 작곡 엔진 — 코드 진행 + 하프 아르페지오 + 베이스 + 심장박동 + 플루트 모티프
// ═══════════════════════════════════════════════════════

const BGM_FILES = {
  title: './assets/audio/bgm_title.mp3',
  game: './assets/audio/bgm_game.mp3',
};
const fileBuffers = {}; // mode → AudioBuffer | 'missing'
let fileSource = null;

let currentMode = null;
let schedTimer = null;

// ── D 도리안 진행 (신비로운 숲 감성) — A/B 섹션 8마디 교차 ──
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz
const PROG_A = [
  { root: 38, chord: [50, 53, 57], scale: [50, 52, 53, 55, 57, 59, 60] }, // Dm
  { root: 34, chord: [46, 50, 53], scale: [46, 48, 50, 53, 55, 57, 58] }, // Bb
  { root: 41, chord: [53, 57, 60], scale: [53, 55, 57, 60, 62, 64, 65] }, // F
  { root: 36, chord: [48, 52, 55], scale: [48, 50, 52, 55, 57, 60, 62] }, // C
];
const PROG_B = [
  { root: 31, chord: [43, 46, 50], scale: [43, 45, 46, 48, 50, 53, 55] }, // Gm (긴장)
  { root: 34, chord: [46, 50, 53], scale: [46, 48, 50, 53, 55, 57, 58] }, // Bb
  { root: 38, chord: [50, 53, 57], scale: [50, 52, 53, 55, 57, 59, 60] }, // Dm
  { root: 33, chord: [45, 49, 52], scale: [45, 47, 49, 50, 52, 55, 57] }, // A (해결 유도)
];
const progFor = (bar) => ((bar % 8) < 4 ? PROG_A : PROG_B)[bar % 4];
const BPM = 82;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
let barCount = 0;
let nextBarTime = 0;

function pluck(midi, t, vol = 0.09, dur = 1.6) {
  // 하프/켈틱 현 소리: 트라이앵글 + 빠른 감쇠 + 에코
  const f = NOTE(midi);
  for (const [delay, v] of [[0, vol], [BEAT * 1.5, vol * 0.35]]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(v, t + delay + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + delay + dur);
    osc.connect(g).connect(musicGain);
    osc.start(t + delay);
    osc.stop(t + delay + dur + 0.1);
  }
}

function padNote(midi, t, dur, vol = 0.028) {
  const f = NOTE(midi);
  for (const det of [-4, 3]) { // 디튠 2보이스 (따뜻함)
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = det;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    osc.connect(filt).connect(g).connect(musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.2);
  }
}

function bassNote(midi, t, dur = BEAT * 1.6, vol = 0.11) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = NOTE(midi);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(musicGain);
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

function heartbeat(t, vol = 0.10) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(64, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(g).connect(musicGain);
  osc.start(t);
  osc.stop(t + 0.35);
}

function fluteNote(midi, t, dur, vol = 0.05) {
  const f = NOTE(midi);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const vib = ctx.createOscillator();
  const vibG = ctx.createGain();
  vib.frequency.value = 5.2;
  vibG.gain.value = 5;
  vib.connect(vibG).connect(osc.frequency);
  osc.type = 'sine';
  osc.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(g).connect(musicGain);
  osc.start(t); vib.start(t);
  osc.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
}

// 한 마디 스케줄링
function scheduleBar(t, mode) {
  const step = progFor(barCount);
  const isTitle = mode === 'title';

  // 패드 (코드 전체)
  for (const m of step.chord) padNote(m, t, BAR * 1.05, isTitle ? 0.034 : 0.026);
  padNote(step.chord[0] + 12, t, BAR, 0.012);

  // 베이스
  bassNote(step.root, t);
  if (!isTitle) bassNote(step.root, t + BEAT * 2.5, BEAT, 0.07);

  // 심장박동 퍼커션 (게임만, 2/4마디마다)
  if (!isTitle && barCount % 2 === 1) {
    heartbeat(t + BEAT * 1);
    heartbeat(t + BEAT * 1.4, 0.05);
  }

  // 하프 아르페지오 — 8분음표, 코드톤+스케일 랜덤워크
  const density = isTitle ? 0.55 : 0.75;
  let idx = Math.floor(Math.random() * 3);
  for (let e = 0; e < 8; e++) {
    if (Math.random() > density) continue;
    const useChord = e % 2 === 0;
    const src = useChord ? step.chord : step.scale;
    idx = Math.max(0, Math.min(src.length - 1, idx + (Math.random() < 0.5 ? -1 : 1)));
    pluck(src[idx] + 12, t + e * BEAT * 0.5, e === 0 ? 0.085 : 0.05 + Math.random() * 0.025);
  }

  // 플루트 모티프 (4마디마다 한 번, 은은하게)
  if (barCount % 4 === 2 && Math.random() < 0.8) {
    const s = step.scale;
    let mi = 3 + Math.floor(Math.random() * 3);
    let mt = t + BEAT * (Math.random() < 0.5 ? 0 : 1);
    for (let k = 0; k < 3 + Math.floor(Math.random() * 2); k++) {
      const d = BEAT * (Math.random() < 0.6 ? 1 : 1.5);
      fluteNote(s[mi] + 24, mt, d * 0.92, isTitle ? 0.055 : 0.04);
      mi = Math.max(0, Math.min(s.length - 1, mi + (Math.random() < 0.5 ? -1 : Math.random() < 0.5 ? 1 : 2)));
      mt += d;
    }
  }

  // 벨 반짝임
  if (Math.random() < 0.4) {
    pluck(step.chord[Math.floor(Math.random() * 3)] + 24, t + BEAT * (1 + Math.floor(Math.random() * 3)), 0.028, 2.2);
  }

  barCount++;
}

// 파일 BGM 시도 → 실패 시 프로시저럴
async function tryFileBGM(mode) {
  if (fileBuffers[mode] === 'missing') return false;
  if (fileBuffers[mode]) return playFileBGM(mode);
  try {
    const res = await fetch(BGM_FILES[mode]);
    if (!res.ok) throw 0;
    const buf = await res.arrayBuffer();
    fileBuffers[mode] = await ctx.decodeAudioData(buf);
    return playFileBGM(mode);
  } catch {
    fileBuffers[mode] = 'missing';
    return false;
  }
}

function playFileBGM(mode) {
  stopMusicInternal();
  const src = ctx.createBufferSource();
  src.buffer = fileBuffers[mode];
  src.loop = true;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now());
  g.gain.linearRampToValueAtTime(0.8, now() + 2);
  src.connect(g).connect(musicGain);
  src.start();
  fileSource = { src, g };
  return true;
}

function stopMusicInternal() {
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  if (fileSource) {
    try {
      fileSource.g.gain.linearRampToValueAtTime(0, now() + 1.2);
      fileSource.src.stop(now() + 1.3);
    } catch {}
    fileSource = null;
  }
}

export async function startMusic(mode = 'game') {
  if (!ctx || !enabled) return;
  if (currentMode === mode && (schedTimer || fileSource)) return;
  currentMode = mode;
  stopMusicInternal();

  if (await tryFileBGM(mode)) return; // Suno 등 외부 트랙 우선

  // 프로시저럴 엔진: 룩어헤드 스케줄러
  barCount = 0;
  nextBarTime = now() + 0.1;
  scheduleBar(nextBarTime, mode);
  nextBarTime += BAR;
  schedTimer = setInterval(() => {
    if (!ctx) return;
    while (nextBarTime < now() + BAR * 0.9) {
      scheduleBar(nextBarTime, currentMode);
      nextBarTime += BAR;
    }
  }, 250);
}

export function stopMusic() {
  currentMode = null;
  stopMusicInternal();
}

// 디버그·검증용 상태 조회
export function getMusicState() {
  return {
    ctxState: ctx ? ctx.state : 'none',
    mode: currentMode,
    procedural: !!schedTimer,
    file: !!fileSource,
    bars: barCount,
    fileCache: Object.fromEntries(Object.entries(fileBuffers).map(([k, v]) => [k, v === 'missing' ? 'missing' : 'loaded'])),
  };
}

let muted = false;
export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}
export function toggleMute() {
  setMuted(!muted);
  return muted;
}
