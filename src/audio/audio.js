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
  attackMelee() { noise({ dur: 0.07, vol: 0.25, freq: 900 }); tone({ freq: 180, freqEnd: 90, type: 'triangle', dur: 0.08, vol: 0.2 }); },
  attackRanged() { tone({ freq: 700, freqEnd: 1400, type: 'sine', dur: 0.09, vol: 0.12 }); },
  hit() { noise({ dur: 0.06, vol: 0.3, freq: 1600 }); },
  abilityQ() { tone({ freq: 520, freqEnd: 980, type: 'sawtooth', dur: 0.18, vol: 0.14 }); noise({ dur: 0.12, vol: 0.1, freq: 2000 }); },
  abilityW() { tone({ freq: 330, freqEnd: 660, type: 'square', dur: 0.22, vol: 0.1 }); },
  dash() { noise({ dur: 0.18, vol: 0.18, freq: 3000 }); tone({ freq: 900, freqEnd: 300, type: 'sine', dur: 0.18, vol: 0.1 }); },
  heal() { tone({ freq: 520, type: 'sine', dur: 0.3, vol: 0.12 }); tone({ freq: 780, type: 'sine', dur: 0.3, vol: 0.1, delay: 0.08 }); },
  shield() { tone({ freq: 440, freqEnd: 880, type: 'triangle', dur: 0.25, vol: 0.12 }); },
  kill() { tone({ freq: 220, type: 'sawtooth', dur: 0.35, vol: 0.2 }); tone({ freq: 330, type: 'sawtooth', dur: 0.35, vol: 0.16, delay: 0.1 }); tone({ freq: 440, type: 'sawtooth', dur: 0.45, vol: 0.14, delay: 0.2 }); },
  death() { tone({ freq: 300, freqEnd: 60, type: 'sawtooth', dur: 0.6, vol: 0.2 }); },
  towerHit() { noise({ dur: 0.15, vol: 0.35, freq: 500 }); tone({ freq: 120, freqEnd: 60, type: 'triangle', dur: 0.2, vol: 0.3 }); },
  towerDown() { noise({ dur: 0.6, vol: 0.4, freq: 300 }); tone({ freq: 150, freqEnd: 40, type: 'sawtooth', dur: 0.8, vol: 0.3 }); },
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

// ─── 간단한 앰비언트 BGM (전투 분위기 패드) ───
let musicTimer = null;
const CHORDS = [
  [130.8, 196.0, 261.6], // Cm
  [155.6, 233.1, 311.1], // Eb
  [174.6, 261.6, 349.2], // Fm
  [116.5, 174.6, 233.1], // Bb
];
let chordIdx = 0;

function playChord() {
  if (!ctx || !enabled) return;
  const chord = CHORDS[chordIdx % CHORDS.length];
  chordIdx++;
  const t0 = now();
  chord.forEach((f) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 1.2);
    g.gain.linearRampToValueAtTime(0.02, t0 + 3.4);
    g.gain.linearRampToValueAtTime(0, t0 + 4.0);
    osc.connect(g).connect(musicGain);
    osc.start(t0);
    osc.stop(t0 + 4.2);
    // 옥타브 위 반짝임
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.value = f * 2;
    g2.gain.setValueAtTime(0, t0);
    g2.gain.linearRampToValueAtTime(0.012, t0 + 2.0);
    g2.gain.linearRampToValueAtTime(0, t0 + 4.0);
    osc2.connect(g2).connect(musicGain);
    osc2.start(t0);
    osc2.stop(t0 + 4.2);
  });
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  playChord();
  musicTimer = setInterval(playChord, 4000);
}
export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}
export function setMuted(m) {
  if (master) master.gain.value = m ? 0 : 0.55;
}
