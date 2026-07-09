// ─── 챔피언 데이터 ───
// 각 챔피언 = SEL 강점의 의인화. 서울시교육청 SEL 4영역(자기·대인관계·공동체·마음건강) 매핑.

export const CHAMPIONS = [
  {
    id: 'guardian',
    name: '바위',
    title: '인내의 수호자',
    role: '탑', roleEn: 'TOP', lane: 'top',
    sel: '자기', selStrength: '끈기와 자기조절',
    selDesc: '힘든 순간에도 흔들리지 않고 버텨내는 힘. 라인에서 혼자 싸우는 시간이 바위를 더 단단하게 만든다.',
    color: '#e8a33d', colorDark: '#8a5f1e',
    kind: 'melee',
    stats: { hp: 780, hpPerLv: 102, mp: 260, mpPerLv: 30, ad: 64, adPerLv: 4.4, range: 150, ms: 345, as: 0.8, armor: 30, armorPerLv: 3.6, regen: 2.6 },
    Q: { name: '대지 강타', icon: 'Q', desc: '주변의 땅을 내리쳐 피해를 주고 적을 느리게 한다', cd: 7, mana: 45, type: 'selfAoe', radius: 230, dmg: 72, dmgPerLv: 15, slow: 0.4, slowDur: 1.4 },
    W: { name: '굳건한 의지', icon: 'W', desc: '마음을 다잡아 보호막을 얻는다', cd: 13, mana: 60, type: 'shieldSelf', amount: 140, perLv: 30, dur: 4 },
  },
  {
    id: 'fox',
    name: '그림자여우',
    title: '알아차림의 정찰자',
    role: '정글', roleEn: 'JUNGLE', lane: 'jungle',
    sel: '마음건강', selStrength: '마음의 신호 알아차리기',
    selDesc: '정글러가 맵 전체를 살피듯, 내 마음과 팀의 상태를 먼저 알아차리고 돌보러 가는 힘.',
    color: '#9b6dff', colorDark: '#5b3aa8',
    kind: 'melee',
    stats: { hp: 660, hpPerLv: 88, mp: 300, mpPerLv: 36, ad: 68, adPerLv: 4.6, range: 160, ms: 365, as: 0.95, armor: 25, armorPerLv: 3.0, regen: 2.2 },
    Q: { name: '그림자 습격', icon: 'Q', desc: '적에게 순식간에 파고들어 벤다', cd: 8, mana: 50, type: 'dashStrike', range: 500, dmg: 84, dmgPerLv: 17 },
    W: { name: '알아차림', icon: 'W', desc: '주변을 꿰뚫어 보고 발걸음이 빨라지며 기력을 회복한다', cd: 14, mana: 55, type: 'insight', msBoost: 0.4, dur: 3, heal: 60, healPerLv: 12 },
  },
  {
    id: 'flame',
    name: '불꽃',
    title: '열정의 마법사',
    role: '미드', roleEn: 'MID', lane: 'mid',
    sel: '자기', selStrength: '감정 에너지 다루기',
    selDesc: '뜨거운 감정은 태워버리는 불이 될 수도, 밝히는 빛이 될 수도 있다. 불꽃은 그 에너지를 다루는 법을 안다.',
    color: '#ff6b4a', colorDark: '#a83a22',
    kind: 'ranged',
    stats: { hp: 570, hpPerLv: 74, mp: 400, mpPerLv: 52, ad: 55, adPerLv: 3.2, range: 480, ms: 335, as: 0.7, armor: 20, armorPerLv: 2.5, regen: 2.0 },
    Q: { name: '화염구', icon: 'Q', desc: '직선으로 화염구를 날려 처음 맞은 적에게 큰 피해', cd: 6, mana: 55, type: 'skillshot', range: 880, speed: 950, dmg: 98, dmgPerLv: 21, radius: 55 },
    W: { name: '감정의 파동', icon: 'W', desc: '지정한 곳에 감정 에너지를 모아 폭발시킨다', cd: 11, mana: 75, type: 'groundAoe', range: 720, radius: 190, dmg: 86, dmgPerLv: 19, delay: 0.55 },
  },
  {
    id: 'gale',
    name: '바람살',
    title: '신뢰의 궁수',
    role: '원딜', roleEn: 'ADC', lane: 'bot',
    sel: '공동체', selStrength: '신뢰와 책임',
    selDesc: '팀의 화력을 책임지는 만큼 팀의 보호가 필요하다. 서로를 믿을 때 가장 강해지는 존재.',
    color: '#4ad1e8', colorDark: '#20798a',
    kind: 'ranged',
    stats: { hp: 585, hpPerLv: 80, mp: 320, mpPerLv: 40, ad: 62, adPerLv: 5.0, range: 525, ms: 340, as: 0.92, armor: 22, armorPerLv: 2.8, regen: 1.9 },
    Q: { name: '관통 화살', icon: 'Q', desc: '적들을 꿰뚫는 화살을 날린다', cd: 7, mana: 50, type: 'pierce', range: 920, speed: 1150, dmg: 86, dmgPerLv: 18, width: 75 },
    W: { name: '질풍의 집중', icon: 'W', desc: '숨을 고르고 목표에 집중해 공격이 빨라진다', cd: 15, mana: 45, type: 'frenzy', asBoost: 0.6, msBoost: 0.15, dur: 4 },
  },
  {
    id: 'moon',
    name: '달빛',
    title: '공감의 치유사',
    role: '서폿', roleEn: 'SUPPORT', lane: 'bot',
    sel: '대인관계', selStrength: '공감과 돌봄',
    selDesc: '다친 마음을 가장 먼저 알아보고 다가가는 존재. 달빛의 힘은 화려하지 않지만 팀을 지탱한다.',
    color: '#ffd93d', colorDark: '#a8861a',
    kind: 'ranged',
    stats: { hp: 610, hpPerLv: 82, mp: 430, mpPerLv: 56, ad: 50, adPerLv: 2.9, range: 500, ms: 340, as: 0.72, armor: 24, armorPerLv: 3.0, regen: 2.4 },
    Q: { name: '달빛 세례', icon: 'Q', desc: '가장 다친 아군을 치유한다', cd: 9, mana: 70, type: 'healAlly', range: 720, heal: 95, healPerLv: 21 },
    W: { name: '수호의 빛', icon: 'W', desc: '아군에게 보호막을 씌운다', cd: 12, mana: 65, type: 'shieldAlly', range: 720, amount: 115, perLv: 25, dur: 3.5 },
  },
];

// 공용 E 스킬 — 모든 챔피언
export const DASH = { name: '마음의 도약', icon: 'E', desc: '마음을 가다듬고 순간적으로 이동한다', cd: 16, mana: 40, dist: 300 };

// ─── 그림자 군단 (적팀) ───
// 마음을 무너뜨리는 다섯 가지 내면의 목소리. 같은 챔피언 키트를 사용하되 이름·색이 다르다.
export const SHADOWS = {
  guardian: { name: '비난', title: '깎아내리는 목소리', color: '#d84545', quote: '"넌 그것밖에 못 해?"' },
  fox:      { name: '불안', title: '흔드는 목소리', color: '#b04ad8', quote: '"분명 망칠 거야…"' },
  flame:    { name: '분노', title: '태우는 목소리', color: '#e83a2a', quote: '"다 쟤 때문이야!"' },
  gale:     { name: '조급', title: '재촉하는 목소리', color: '#d86b2a', quote: '"빨리빨리! 왜 이렇게 느려?"' },
  moon:     { name: '냉소', title: '차갑게 식히는 목소리', color: '#8a95a8', quote: '"해봤자 안 돼. 다 의미 없어."' },
};

// ─── 상점 아이템 ───
export const ITEMS = [
  { id: 'sword', name: '용기의 검', icon: '⚔️', cost: 500, desc: '공격력 +14', stats: { ad: 14 } },
  { id: 'armor', name: '수호의 갑옷', icon: '🛡️', cost: 500, desc: '방어력 +12, 체력 +90', stats: { armor: 12, hp: 90 } },
  { id: 'boots', name: '신속의 장화', icon: '👟', cost: 400, desc: '이동속도 +28 (1회만)', stats: { ms: 28 }, unique: true },
  { id: 'pendant', name: '회복의 목걸이', icon: '📿', cost: 450, desc: '초당 회복 +2.2', stats: { regen: 2.2 } },
  { id: 'orb', name: '지혜의 보주', icon: '🔮', cost: 600, desc: '스킬 쿨다운 -8%', stats: { cdr: 0.08 } },
  { id: 'crystal', name: '평온의 수정', icon: '💎', cost: 600, desc: '멘탈 게이지 회복속도 +60%', stats: { tiltDecay: 0.6 } },
];

export function champById(id) {
  return CHAMPIONS.find((c) => c.id === id);
}
