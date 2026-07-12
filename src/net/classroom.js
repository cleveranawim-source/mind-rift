// ─── 반 모드 네트워크 계층 (Firebase Firestore) ───
// 방 전체 = 문서 1개 (players 맵 + events 배열 + 공유 사기).
// 컬렉션: rift_rooms (규칙 추가 후) → 거부되면 emotion_release/riftroom_* 네임스페이스로 자동 폴백.
//
// rift_rooms 활성화용 Firestore 규칙 (Firebase 콘솔 → Firestore → 규칙에 추가):
//   match /rift_rooms/{room} {
//     allow read, write: if true;
//   }
import { initializeApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, arrayUnion, increment, runTransaction, deleteField,
} from 'firebase/firestore';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBc-66tIeGrGskzA_RJsEjFu_lPv925cBk',
  authDomain: 'lev-diary.firebaseapp.com',
  projectId: 'lev-diary',
  storageBucket: 'lev-diary.firebasestorage.app',
  messagingSenderId: '790116212067',
  appId: '1:790116212067:web:97bf5cdc3bb624737b8756',
};

let db = null;
function ensureDb() {
  if (!db) db = getFirestore(initializeApp(FIREBASE_CONFIG));
  return db;
}

// 컬렉션 자동 선택 (localStorage에 캐시)
let ns = localStorage.getItem('rift_ns') || null; // 'clean' | 'fallback'
function roomRef(code) {
  const d = ensureDb();
  return ns === 'fallback'
    ? doc(d, 'emotion_release', 'riftroom_' + code)
    : doc(d, 'rift_rooms', code);
}

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 혼동 문자 제외
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function genId() {
  return 'p' + Math.random().toString(36).slice(2, 10);
}

// ═══ 방 생성 (교사 또는 첫 학생) ═══
export async function createRoom({ asTeacher = false, name = '' } = {}) {
  const code = genCode();
  const playerId = asTeacher ? null : genId();
  const data = {
    v: 1, code,
    status: 'lobby',
    createdAt: serverTimestamp(),
    hostId: playerId, // 교사 방이면 null (교사가 시작 권한)
    teacherRoom: asTeacher,
    morale: 60,
    players: playerId ? { [playerId]: baseP(name) } : {},
    events: [],
  };
  // 1차: rift_rooms → 거부 시 emotion_release 폴백
  if (ns !== 'fallback') {
    try {
      await setDoc(roomRef(code), data);
      ns = 'clean';
      localStorage.setItem('rift_ns', 'clean');
      return { code, playerId };
    } catch (e) {
      if (String(e.code).includes('permission')) {
        ns = 'fallback';
        localStorage.setItem('rift_ns', 'fallback');
      } else throw e;
    }
  }
  await setDoc(roomRef(code), data);
  return { code, playerId };
}

function baseP(name) {
  return {
    name, champ: null, ready: false,
    joined: Date.now(), seen: Date.now(),
    lv: 1, k: 0, d: 0, a: 0, cs: 0, tilt: 0, breaths: 0, praises: 0,
    nexusPct: 100, done: false, win: null, ref: null,
  };
}

// ═══ 입장 ═══
export async function joinRoom(code, name) {
  code = code.toUpperCase().trim();
  // 네임스페이스 탐색: clean 우선 → 폴백
  let ref = null, snap = null;
  for (const tryNs of [ns || 'clean', ns === 'fallback' ? 'clean' : 'fallback']) {
    const prev = ns;
    ns = tryNs;
    try {
      const r = roomRef(code);
      const s = await getDoc(r);
      if (s.exists()) { ref = r; snap = s; localStorage.setItem('rift_ns', tryNs); break; }
    } catch { /* 권한 거부 → 다음 */ }
    ns = prev;
  }
  if (!ref) throw new Error('방을 찾을 수 없어요. 코드를 확인해 주세요.');
  const room = snap.data();
  if (room.status !== 'lobby') throw new Error('이미 시작된 방이에요.');
  const count = Object.keys(room.players || {}).length;
  if (count >= 5) throw new Error('방이 가득 찼어요 (최대 5명).');

  const playerId = genId();
  await updateDoc(ref, {
    [`players.${playerId}`]: baseP(name),
    ...(room.hostId ? {} : {}), // 교사 방이면 host는 교사(null 유지)
  });
  return { code, playerId };
}

// ═══ 실시간 구독 ═══
export function watchRoom(code, cb) {
  return onSnapshot(roomRef(code), (snap) => {
    if (snap.exists()) cb(snap.data());
  }, (err) => console.warn('[classroom] watch error', err));
}

// ═══ 로비 액션 ═══
export async function pickChamp(code, playerId, champId) {
  await runTransaction(ensureDb(), async (tx) => {
    const s = await tx.get(roomRef(code));
    if (!s.exists()) throw new Error('no room');
    const players = s.data().players || {};
    for (const [pid, p] of Object.entries(players)) {
      if (pid !== playerId && p.champ === champId) throw new Error('이미 선택된 수호자예요.');
    }
    tx.update(roomRef(code), { [`players.${playerId}.champ`]: champId });
  });
}

export function setReady(code, playerId, ready) {
  return updateDoc(roomRef(code), { [`players.${playerId}.ready`]: ready });
}

export function startMatch(code) {
  return updateDoc(roomRef(code), { status: 'playing', startAt: serverTimestamp() });
}

export function leaveRoom(code, playerId) {
  if (!playerId) return Promise.resolve();
  return updateDoc(roomRef(code), { [`players.${playerId}`]: deleteField() }).catch(() => {});
}

// ═══ 인게임 동기화 ═══
const statThrottle = { last: 0 };
export function updateStats(code, playerId, stats) {
  const now = Date.now();
  if (now - statThrottle.last < 5000) return Promise.resolve(); // 5초 스로틀
  statThrottle.last = now;
  const patch = { [`players.${playerId}.seen`]: now };
  for (const [k, v] of Object.entries(stats)) patch[`players.${playerId}.${k}`] = v;
  return updateDoc(roomRef(code), patch).catch(() => {});
}

// 관전용 경량 스냅샷 (2.5초 스로틀 — 영웅 위치·HP·점수 등 압축)
const snapThrottle = { last: 0 };
export function pushSnapshot(code, playerId, snap) {
  const now = Date.now();
  if (now - snapThrottle.last < 2500) return Promise.resolve();
  snapThrottle.last = now;
  return updateDoc(roomRef(code), {
    [`players.${playerId}.snap`]: snap,
    [`players.${playerId}.seen`]: now,
  }).catch(() => {});
}

// 이벤트 큐 (2초 배치 플러시 — 문서 쓰기 경합 완화)
const evQueue = [];
let evTimer = null;
export function pushEvent(code, name, type, text) {
  evQueue.push({ t: Date.now(), n: name, ty: type, tx: text });
  if (!evTimer) {
    evTimer = setTimeout(() => {
      const batch = evQueue.splice(0);
      evTimer = null;
      if (batch.length) {
        updateDoc(roomRef(code), { events: arrayUnion(...batch) }).catch(() => {});
      }
    }, 2000);
  }
}

// 공유 사기 (증분, 서버가 진실)
export function boostMorale(code, delta) {
  return updateDoc(roomRef(code), { morale: increment(delta) }).catch(() => {});
}

// 경기 종료 결과 제출
export function submitResult(code, playerId, { win, ref, k, d, a, cs, breaths, praises, lv }) {
  return updateDoc(roomRef(code), {
    [`players.${playerId}.lv`]: lv || 1,
    [`players.${playerId}.done`]: true,
    [`players.${playerId}.win`]: win,
    [`players.${playerId}.ref`]: ref,
    [`players.${playerId}.k`]: k,
    [`players.${playerId}.d`]: d,
    [`players.${playerId}.a`]: a,
    [`players.${playerId}.cs`]: cs,
    [`players.${playerId}.breaths`]: breaths,
    [`players.${playerId}.praises`]: praises,
  }).catch(() => {});
}

export function endRoom(code) {
  return updateDoc(roomRef(code), { status: 'ended' }).catch(() => {});
}

export function getNamespace() { return ns; }
