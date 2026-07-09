// ─── Three.js 3D 렌더러 ───
// 게임 로직은 2D 좌표(x, y)를 그대로 쓰고, 여기서 XZ 평면(x→x, y→z)에 투영한다.
// 카메라는 LOL처럼 ~54° 기울어진 시점. 유닛은 빌보드 스프라이트(HD-2.5D).
import * as THREE from 'three';
import { WORLD, NEXUS_POS } from '../world/map.js';
import { ENV, MON, UNIT, loadImg } from '../ui/assets.js';
import { shake } from '../fx/fx.js';

const CAM_H = 820;   // 카메라 높이
const CAM_D = 580;   // 카메라 뒤 거리 (기울기 결정)

export class Renderer3D {
  constructor(canvas, terrainCanvas, fogCanvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050906);
    this.scene.fog = new THREE.Fog(0x050906, 1900, 3400); // 원거리 안개 (깊이감)

    this.camera = new THREE.PerspectiveCamera(44, 1, 10, 6000);
    this.camTarget = new THREE.Vector3(WORLD / 2, 0, WORLD / 2);

    // ── 지형 (페인팅 텍스처) ──
    this.terrainTex = new THREE.CanvasTexture(terrainCanvas);
    this.terrainTex.colorSpace = THREE.SRGBColorSpace;
    this.terrainTex.anisotropy = 4;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshBasicMaterial({ map: this.terrainTex })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD / 2, 0, WORLD / 2);
    this.scene.add(ground);
    this.ground = ground;

    // ── 전장의 안개 (지면 정렬, 항상 위에 그림) ──
    this.fogTex = new THREE.CanvasTexture(fogCanvas);
    this.fogPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthTest: false, depthWrite: false })
    );
    this.fogPlane.rotation.x = -Math.PI / 2;
    this.fogPlane.position.set(WORLD / 2, 4, WORLD / 2);
    this.fogPlane.renderOrder = 900;
    this.scene.add(this.fogPlane);

    // ── 넥서스: 진짜 3D 회전 크리스탈 ──
    this.nexusMeshes = {};
    for (const team of ['blue', 'red']) {
      const color = team === 'blue' ? 0x4a9eff : 0xff5555;
      const geo = new THREE.OctahedronGeometry(52);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(geo, mat);
      const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 }));
      mesh.add(wire);
      mesh.position.set(NEXUS_POS[team].x, 72, NEXUS_POS[team].y);
      this.scene.add(mesh);
      // 발밑 글로우 스프라이트
      const glow = this.makeGlowSprite(team === 'blue' ? '#4a9eff' : '#ff5555');
      glow.scale.set(360, 360, 1);
      glow.position.set(NEXUS_POS[team].x, 8, NEXUS_POS[team].y);
      this.scene.add(glow);
      this.nexusMeshes[team] = mesh;
    }

    // 유닛 빌보드 풀: unit.id → { sprite }
    this.pool = new Map();
    // 영웅 발밑 링: unit.id → mesh
    this.rings = new Map();
    this.texCache = new Map();

    this._v = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
  }

  makeGlowSprite(color) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  }

  getTexture(src) {
    if (this.texCache.has(src)) return this.texCache.get(src);
    const img = loadImg(src);
    if (!img.complete || !img.naturalWidth) return null;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.texCache.set(src, tex);
    return tex;
  }

  updateTerrain() {
    this.terrainTex.needsUpdate = true;
  }

  // 텍스처 지연 로드 후 새 지형 캔버스로 교체
  setTerrain(terrainCanvas) {
    this.terrainTex.dispose();
    this.terrainTex = new THREE.CanvasTexture(terrainCanvas);
    this.terrainTex.colorSpace = THREE.SRGBColorSpace;
    this.terrainTex.anisotropy = 4;
    this.ground.material.map = this.terrainTex;
    this.ground.material.needsUpdate = true;
  }

  resize(vw, vh) {
    this.renderer.setSize(vw, vh, false);
    this.camera.aspect = vw / vh;
    this.camera.updateProjectionMatrix();
    this.vw = vw; this.vh = vh;
  }

  // ── 좌표 변환 ──
  // 월드(x, y[, h]) → 화면 px. s = 그 지점의 원근 스케일 (월드 100px가 화면에서 차지하는 비율)
  project(x, y, h = 0) {
    this._v.set(x, h, y).project(this.camera);
    const sx = (this._v.x * 0.5 + 0.5) * this.vw;
    const sy = (-this._v.y * 0.5 + 0.5) * this.vh;
    return { x: sx, y: sy };
  }
  worldScaleAt(x, y) {
    const a = this.project(x - 50, y);
    const b = this.project(x + 50, y);
    return Math.hypot(b.x - a.x, b.y - a.y) / 100;
  }
  // 지면 원의 세로 눌림 비율 (원근 타원)
  foreshorten(x, y) {
    const a = this.project(x, y - 50);
    const b = this.project(x, y + 50);
    const sx = this.worldScaleAt(x, y);
    return sx > 0.0001 ? Math.hypot(b.x - a.x, b.y - a.y) / 100 / sx : 0.55;
  }
  screenToWorld(sx, sy) {
    this._ndc.set((sx / this.vw) * 2 - 1, -(sy / this.vh) * 2 + 1);
    this._ray.origin.setFromMatrixPosition(this.camera.matrixWorld);
    this._ray.direction.set(this._ndc.x, this._ndc.y, 0.5).unproject(this.camera).sub(this._ray.origin).normalize();
    const hit = new THREE.Vector3();
    this._ray.intersectPlane(this._plane, hit);
    return hit ? { x: hit.x, y: hit.z } : { x: 0, y: 0 };
  }

  // ── 유닛 빌보드 동기화 ──
  syncSprite(key, id, x, y, h, d, flip, dimmed = 0) {
    let entry = this.pool.get(id);
    const tex = this.getTexture(key);
    if (!tex) return;
    if (!entry) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      this.scene.add(sprite);
      entry = { sprite, key };
      this.pool.set(id, entry);
    }
    if (entry.key !== key) {
      entry.sprite.material.map = tex;
      entry.sprite.material.needsUpdate = true;
      entry.key = key;
    }
    entry.sprite.visible = true;
    entry.sprite.position.set(x, h, y);
    entry.sprite.scale.set(flip ? -d : d, d, 1);
    entry.sprite.material.color.setScalar(1 - dimmed * 0.6);
    entry.used = true;
  }

  syncRing(id, x, y, r, colorHex, dashed = false) {
    let ring = this.rings.get(id);
    if (!ring) {
      const geo = new THREE.RingGeometry(0.86, 1, 40);
      const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
      ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.rings.set(id, ring);
    }
    ring.visible = true;
    ring.position.set(x, 2.2, y);
    ring.scale.set(r, r, 1);
    ring.material.color.setHex(colorHex);
    ring.used = true;
  }

  // ── 프레임 렌더 ──
  render(game) {
    const p = game.player;
    // 카메라 추적 (부드럽게) + 셰이크
    this.camTarget.lerp(new THREE.Vector3(p.x, 0, p.y), 0.12);
    const zoomK = Math.max(0.9, Math.min(1.25, 1450 / this.vw));
    this.camera.position.set(
      this.camTarget.x + shake.x * 0.8,
      CAM_H * zoomK,
      this.camTarget.z + CAM_D * zoomK + shake.y * 0.8
    );
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);

    // 풀 리셋 플래그
    for (const e of this.pool.values()) e.used = false;
    for (const r of this.rings.values()) r.used = false;

    const t = game.time;

    // 영웅
    for (const h of game.heroes) {
      if (h.dead || !game.isVisible(h)) continue;
      const key = UNIT[h.team === 'red' ? `shadow_${h.champ.id}` : h.champ.id];
      const d = h.radius * 4.6;
      const bob = h.moving ? Math.abs(Math.sin(t * 9 + h.id)) * 6 : Math.sin(t * 2 + h.id) * 2;
      this.syncSprite(key, 'h' + h.id, h.x, h.y, d * 0.44 + bob, d, Math.cos(h.facing) < 0);
      this.syncRing('h' + h.id, h.x, h.y, h.radius * 1.5, h.isPlayer ? 0x3fe5a0 : (h.team === 'blue' ? 0x4a9eff : 0xff5555));
    }
    // 미니언
    for (const m of game.minions) {
      if (m.dead || !game.isVisible(m)) continue;
      const key = UNIT[m.team === 'blue' ? 'minion_blue' : 'minion_red'];
      const d = m.radius * (m.type === 'cannon' ? 4.0 : 3.4);
      const bob = Math.abs(Math.sin(t * 8 + m.id)) * 3;
      this.syncSprite(key, 'm' + m.id, m.x, m.y, d * 0.42 + bob, d, Math.cos(m.facing) < 0);
    }
    // 타워
    for (const tw of game.towers) {
      if (tw.dead) {
        const key = ENV[tw.team === 'blue' ? 'towerBlue' : 'towerRed'];
        this.syncSprite(key, 't' + tw.id, tw.x, tw.y, 34, 100, false, 1);
        continue;
      }
      const key = ENV[tw.team === 'blue' ? 'towerBlue' : 'towerRed'];
      this.syncSprite(key, 't' + tw.id, tw.x, tw.y, 62, 165, false, tw.invulnerable ? 0.55 : 0);
    }
    // 몬스터
    for (const mo of game.monsters) {
      if (mo.dead || !mo.def.id) continue;
      const d = mo.radius * 3.4;
      const isBig = mo.def.id === 'spirit' || mo.def.id === 'sage';
      const bob = isBig ? Math.sin(t * 1.8 + mo.id) * 7 : Math.abs(Math.sin(t * 5 + mo.id)) * 2;
      this.syncSprite(MON[mo.def.id], 'o' + mo.id, mo.x, mo.y, d * 0.42 + bob, d, Math.cos(mo.facing) < 0);
    }

    // 넥서스 회전·펄스
    for (const team of ['blue', 'red']) {
      const mesh = this.nexusMeshes[team];
      const nx = game.nexus[team];
      mesh.visible = !nx.dead;
      mesh.rotation.y = t * 0.7;
      mesh.position.y = 72 + Math.sin(t * 1.6) * 6;
      const s = nx.invulnerable ? 0.8 : 1;
      mesh.scale.set(s, s, s);
      mesh.material.opacity = nx.invulnerable ? 0.45 : 0.92;
    }

    // 안 쓴 풀 항목 숨김
    for (const e of this.pool.values()) if (!e.used) e.sprite.visible = false;
    for (const r of this.rings.values()) if (!r.used) r.visible = false;

    this.fogTex.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
