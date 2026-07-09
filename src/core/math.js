// ─── 수학 유틸 ───
export const TAU = Math.PI * 2;

export function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.hypot(dx, dy);
}
export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}
export function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}
export function rand(min, max) {
  return min + Math.random() * (max - min);
}
export function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// 점→선분 최단거리
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return dist(px, py, ax + dx * t, ay + dy * t);
}
// 부드러운 감쇠 (프레임레이트 독립)
export function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}
