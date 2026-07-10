// ─── Three.js 3D 렌더러 ───
// 게임 로직은 2D 좌표(x, y)를 그대로 쓰고, 여기서 XZ 평면(x→x, y→z)에 투영한다.
// 카메라는 LOL처럼 ~54° 기울어진 시점. 유닛은 빌보드 스프라이트(HD-2.5D).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WORLD, NEXUS_POS, WALLS } from '../world/map.js';
import { ENV, MON, UNIT, loadImg } from '../ui/assets.js';
import { shake } from '../fx/fx.js';

// 리깅된 3D 캐릭터 모델 (존재하는 것만 로드, 없으면 빌보드 폴백)
const MODEL_URLS = {
  flame: './assets/models/unit_flame.glb',
  guardian: './assets/models/unit_guardian.glb',
  fox: './assets/models/unit_fox.glb',
  gale: './assets/models/unit_gale.glb',
  moon: './assets/models/unit_moon.glb',
  shadow_guardian: './assets/models/unit_shadow_guardian.glb',
  shadow_fox: './assets/models/unit_shadow_fox.glb',
  shadow_flame: './assets/models/unit_shadow_flame.glb',
  shadow_gale: './assets/models/unit_shadow_gale.glb',
  shadow_moon: './assets/models/unit_shadow_moon.glb',
};
const MODEL_HEIGHT = 76; // 영웅 목표 신장 (월드 px) — 맵 대비 LOL 비율

// 정글 몬스터 3D 모델 (정령·수호자는 발광 부유체라 빌보드 유지)
const MON_MODEL_URLS = {
  mon_calm: './assets/models/mon3d_calm.glb',
  mon_wolf: './assets/models/mon3d_wolf.glb',
  mon_focus: './assets/models/mon3d_focus.glb',
  mon_boar: './assets/models/mon3d_boar.glb',
};

// 4족 보행 캐릭터 — 버텍스 셰이더 갤럽(다리 가위질) 적용 대상
const QUAD_KEYS = new Set(['fox', 'shadow_fox', 'mon_wolf', 'mon_focus', 'mon_boar']);

// 리깅 없는 4족 메시에 다리 스윙 착시를 주는 셰이더 패치.
// 하단(다리 영역) 버텍스를 좌/우(x부호)·앞/뒤(z위상) 반대 위상으로 전단 → 트로트 게이트처럼 보임
function addGallopShader(mat, minY, legTop, amp) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uGallop = { value: 0 };
    mat.userData.gallopU = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uGallop;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float legW = 1.0 - smoothstep(float(${minY.toFixed(4)}), float(${legTop.toFixed(4)}), position.y);
          float side = position.x > 0.0 ? 1.0 : -1.0;
          float phase = uTime * 13.0 + side * 3.14159 + position.z * 2.2;
          transformed.z += sin(phase) * legW * uGallop * float(${amp.toFixed(4)});
          transformed.y += abs(sin(phase)) * legW * uGallop * float(${(amp * 0.35).toFixed(4)});
        }
      `);
  };
  mat.needsUpdate = true;
}

// 공격 애니메이션 클립 (재리깅 GLB — 클립만 추출해 본 모델에 재생)
const ATTACK_URLS = {
  guardian: './assets/models/atk_guardian.glb',
  flame: './assets/models/atk_flame.glb',
  gale: './assets/models/atk_gale.glb',
  moon: './assets/models/atk_moon.glb',
  // shadow_guardian(비난)은 유령형 하체로 재리깅 실패 → 절차적 런지 폴백 사용
  shadow_flame: './assets/models/atk_shadow_flame.glb',
  shadow_gale: './assets/models/atk_shadow_gale.glb',
  shadow_moon: './assets/models/atk_shadow_moon.glb',
};

const CAM_H = 1080;  // 카메라 높이 (LOL 비율로 줌아웃)
const CAM_D = 760;   // 카메라 뒤 거리 (기울기 결정)

export class Renderer3D {
  constructor(canvas, terrainCanvas, fogCanvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

    // 맵 밖 스커트 지면 (검은 공허 방지)
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 4, WORLD * 4),
      new THREE.MeshBasicMaterial({ color: 0x08120c })
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.set(WORLD / 2, -2, WORLD / 2);
    this.scene.add(skirt);

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
      mesh.castShadow = true;
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

    // ── 조명 (GLB 모델용 — Basic 재질 지형에는 영향 없음) ──
    this.scene.add(new THREE.HemisphereLight(0xbfe8d0, 0x1a2a20, 1.35));
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.6);
    sun.position.set(-600, 1200, 400);
    // 실시간 그림자 (카메라 주변만 고해상도로)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -950;
    sun.shadow.camera.right = 950;
    sun.shadow.camera.top = 950;
    sun.shadow.camera.bottom = -950;
    sun.shadow.camera.near = 200;
    sun.shadow.camera.far = 3200;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // 그림자 수신 전용 투명 평면 (페인팅 지형 위에 그림자만 얹음)
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.ShadowMaterial({ opacity: 0.34 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.set(WORLD / 2, 1, WORLD / 2);
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    // 빌보드용 블롭 그림자 텍스처
    const bc = document.createElement('canvas');
    bc.width = bc.height = 64;
    const bg = bc.getContext('2d');
    const bgrad = bg.createRadialGradient(32, 32, 4, 32, 32, 30);
    bgrad.addColorStop(0, 'rgba(0,0,0,0.5)');
    bgrad.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = bgrad;
    bg.fillRect(0, 0, 64, 64);
    this.blobTex = new THREE.CanvasTexture(bc);
    // PBR 재질용 환경맵 (IBL) — 없으면 Meshy 모델이 시커멓게 나옴
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;

    // ── 3D 숲 + 절벽 (입체 환경) ──
    this.buildForest();
    this.buildCliffs();

    // 유닛 빌보드 풀: unit.id → { sprite }
    this.pool = new Map();
    // 영웅 발밑 링: unit.id → mesh
    this.rings = new Map();
    this.texCache = new Map();

    // ── 리깅 GLB 캐릭터 ──
    this.gltfLoader = new GLTFLoader();
    this.modelLib = new Map();   // key → { scene, clips } | 'loading' | 'missing'
    this.actors = new Map();     // unit.id → { obj, mixer, action, key }

    this._v = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
  }

  // 로우폴리 나무 숲 — 인스턴싱 2 드로콜
  buildForest() {
    const trees = [];
    for (const w of WALLS) {
      for (const t of w.trees) {
        trees.push({ x: w.x + t.dx, z: w.y + t.dy, s: t.s });
      }
    }
    const n = trees.length;
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1, 5);
    // 고정 색 2재질 (인스턴스 컬러의 흰색 누락 버그 회피) — 언릿으로 페인팅 지형과 톤 일치
    const lowMat = new THREE.MeshBasicMaterial({ color: 0x14301c });
    const topMat = new THREE.MeshBasicMaterial({ color: 0x1e4527 });
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x241a10 });
    const lows = new THREE.InstancedMesh(coneGeo, lowMat, n);
    const tops = new THREE.InstancedMesh(coneGeo, topMat, n);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3();
    trees.forEach((tr, i) => {
      const h = tr.s * 3.4;
      const r = tr.s * 1.5;
      const lean = (Math.sin(i * 7.3) * 0.05);
      q.setFromEuler(new THREE.Euler(lean, i * 1.7, 0));
      // 아래 콘 (몸통 숲)
      m.compose(up.set(tr.x, h * 0.42, tr.z), q, new THREE.Vector3(r, h * 0.6, r));
      lows.setMatrixAt(i, m);
      // 위 콘
      m.compose(up.set(tr.x, h * 0.74, tr.z), q, new THREE.Vector3(r * 0.66, h * 0.48, r * 0.66));
      tops.setMatrixAt(i, m);
      // 줄기
      m.compose(up.set(tr.x, h * 0.16, tr.z), new THREE.Quaternion(), new THREE.Vector3(tr.s, h * 0.34, tr.s));
      trunks.setMatrixAt(i, m);
    });
    lows.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    lows.castShadow = true;
    tops.castShadow = true;
    this.scene.add(lows, tops, trunks);
  }

  // 맵 가장자리 절벽 — 카메라가 남쪽에서 보므로 남쪽은 낮게, 나머지는 적당히
  buildCliffs() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x0a1410 });
    const T = 260;
    const mk = (w, d, x, z, H) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), mat);
      box.position.set(x, H / 2 - 6, z);
      this.scene.add(box);
    };
    mk(WORLD + T * 2, T, WORLD / 2, -T / 2 + 40, 120);          // 북 (원경 — 높아도 안 가림)
    mk(WORLD + T * 2, T, WORLD / 2, WORLD + T / 2 - 40, 14);    // 남 (근경 — 낮은 턱만)
    mk(T, WORLD + T * 2, -T / 2 + 40, WORLD / 2, 60);           // 서
    mk(T, WORLD + T * 2, WORLD + T / 2 - 40, WORLD / 2, 60);    // 동
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

  // ── GLB 모델 로드 (1회) ──
  loadModel(key) {
    const cached = this.modelLib.get(key);
    if (cached) return cached;
    const url = MODEL_URLS[key] || MON_MODEL_URLS[key];
    if (!url) { this.modelLib.set(key, 'missing'); return 'missing'; }
    this.modelLib.set(key, 'loading');
    this.gltfLoader.load(
      url,
      (gltf) => {
        // 금속성 과다 보정 (환경맵 없이도 살 수 있게)
        gltf.scene.traverse((n) => {
          if (n.isMesh && n.material) {
            if (n.material.metalness !== undefined) n.material.metalness = Math.min(n.material.metalness, 0.35);
            if (n.material.roughness !== undefined) n.material.roughness = Math.max(n.material.roughness, 0.55);
          }
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const rawH = Math.max(0.001, box.max.y - box.min.y);
        this.modelLib.set(key, { scene: gltf.scene, clips: gltf.animations, rawH, rawMinY: box.min.y });
      },
      undefined,
      () => this.modelLib.set(key, 'missing')
    );
    return 'loading';
  }

  // 공격 클립만 추출 (재리깅 GLB에서)
  loadAttackClip(key) {
    const k = 'atk_' + key;
    const cached = this.modelLib.get(k);
    if (cached) return cached;
    this.modelLib.set(k, 'loading');
    this.gltfLoader.load(
      ATTACK_URLS[key],
      (gltf) => {
        if (!gltf.animations?.length) return this.modelLib.set(k, 'missing');
        // 재리깅 스켈레톤은 본 길이가 달라서 position/scale 트랙이 몸을 왜곡시킴
        // → 회전(quaternion) 트랙만 남기는 리타겟 (본 이름은 동일한 오토리그라 호환)
        const clip = gltf.animations[0].clone();
        clip.tracks = clip.tracks.filter((tr) => tr.name.endsWith('.quaternion'));
        this.modelLib.set(k, { clip });
      },
      undefined,
      () => this.modelLib.set(k, 'missing')
    );
    return 'loading';
  }

  // ── 유닛별 액터 인스턴스 (스켈레톤 복제 + 애니메이션 믹서) ──
  getActor(id, key, height = MODEL_HEIGHT) {
    let a = this.actors.get(id);
    if (a && a.key === key) return a;
    const lib = this.loadModel(key);
    if (lib === 'loading' || lib === 'missing') return null;
    if (a) this.scene.remove(a.obj);
    const scale = height / lib.rawH;
    const obj = SkeletonUtils.clone(lib.scene);
    obj.scale.setScalar(scale);
    // 재질 복제 (피격 플래시가 서로 간섭하지 않게) + 발광 슬롯 수집 + 그림자 캐스팅
    const mats = [];
    const isQuad = QUAD_KEYS.has(key);
    obj.traverse((n) => {
      if (n.isMesh && n.material) {
        n.material = n.material.clone();
        n.frustumCulled = false; // 스킨 메시 컬링 버그 방지
        n.castShadow = true;
        // 4족 캐릭터: 다리 스윙 셰이더
        if (isQuad) {
          addGallopShader(
            n.material,
            lib.rawMinY,
            lib.rawMinY + lib.rawH * 0.42,
            lib.rawH * 0.10
          );
        }
        mats.push(n.material);
      }
    });
    const mixer = new THREE.AnimationMixer(obj);
    let action = null;
    if (lib.clips && lib.clips.length) {
      action = mixer.clipAction(lib.clips[0]);
      action.play();
    }
    this.scene.add(obj);
    a = { obj, mixer, action, key, yOff: -lib.rawMinY * scale, mats, baseScale: scale };
    this.actors.set(id, a);
    return a;
  }

  // 공격 클립 액션 준비 + 트리거 (같은 오토리그 스켈레톤이라 리타겟 없이 재생 가능)
  syncAttackClip(actor, key, unit) {
    if (!ATTACK_URLS[key] || actor.attackAction === 'fail') return;
    const atk = this.loadAttackClip(key);
    if (typeof atk === 'object' && !actor.attackAction) {
      try {
        const act = actor.mixer.clipAction(atk.clip);
        act.setLoop(THREE.LoopOnce);
        actor.attackAction = act;
        actor.mixer.addEventListener('finished', (e) => {
          if (e.action === actor.attackAction) {
            actor.attackAction.fadeOut(0.15);
            if (actor.action) actor.action.reset().fadeIn(0.15).play();
            actor.attacking = false;
          }
        });
      } catch {
        actor.attackAction = 'fail';
      }
    }
    // 새 공격 시작 감지 (attackAnim이 다시 차오름)
    if (actor.attackAction && actor.attackAction !== 'fail') {
      if ((unit.attackAnim || 0) > (actor.prevAtk ?? 0)) {
        actor.attacking = true;
        actor.attackAction.reset().setEffectiveTimeScale(1.7).fadeIn(0.06).play();
        if (actor.action) actor.action.fadeOut(0.06);
      }
      actor.prevAtk = unit.attackAnim || 0;
    }
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

  // ── 유닛 빌보드 동기화 (블롭 그림자 포함) ──
  syncSprite(key, id, x, y, h, d, flip, dimmed = 0) {
    let entry = this.pool.get(id);
    const tex = this.getTexture(key);
    if (!tex) return;
    if (!entry) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // 빌보드는 섀도우맵에 안 잡히므로 블롭 그림자로 접지감 부여
      const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false })
      );
      blob.rotation.x = -Math.PI / 2;
      this.scene.add(sprite, blob);
      entry = { sprite, blob, key };
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
    entry.blob.visible = true;
    entry.blob.position.set(x, 2, y);
    entry.blob.scale.set(d * 0.62, d * 0.62, 1);
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
    if (!this.clock) this.clock = new THREE.Clock();
    const dt = Math.min(this.clock.getDelta(), 0.05) * game.timescale;
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
    // 태양(그림자 카메라)이 화면을 따라다님
    this.sun.position.set(this.camTarget.x - 520, 1150, this.camTarget.z + 360);
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.sun.target.updateMatrixWorld();

    // 풀 리셋 플래그
    for (const e of this.pool.values()) e.used = false;
    for (const r of this.rings.values()) r.used = false;
    for (const a of this.actors.values()) a.used = false;

    const t = game.time;

    // 영웅 — 리깅 GLB 우선, 없으면 빌보드 폴백
    for (const h of game.heroes) {
      if (h.dead || !game.isVisible(h)) continue;
      const modelKey = h.team === 'red' ? `shadow_${h.champ.id}` : h.champ.id;
      const actor = MODEL_URLS[modelKey] ? this.getActor('h' + h.id, modelKey) : null;
      if (actor) {
        actor.used = true;
        actor.obj.visible = true;
        actor.obj.position.set(h.x, actor.yOff, h.y);
        // 이동 방향으로 몸 회전 (부드럽게)
        const targetYaw = Math.PI / 2 - h.facing;
        let dy = targetYaw - actor.obj.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        actor.obj.rotation.y += dy * Math.min(1, dt * 10);
        // 걷기 클립: 이동 시 재생, 정지 시 느린 숨쉬기
        if (actor.action) {
          if (!actor.attacking) actor.action.timeScale = h.moving ? 1.35 : 0.1;
        } else {
          // 클립 없는 모델(여우 등): 다리는 셰이더가 움직이므로 몸통은 절제된 바운스만
          actor.obj.position.y = actor.yOff
            + Math.sin(t * 2.4 + h.id) * 1.5
            + (h.moving ? Math.abs(Math.sin(t * 13 + h.id)) * 4 : 0);
          actor.obj.rotation.z = h.moving ? Math.sin(t * 13 + h.id) * 0.05 : Math.sin(t * 1.5 + h.id) * 0.025;
          actor.obj.rotation.x = h.moving ? Math.sin(t * 13 + h.id + 1.2) * 0.04 : 0;
        }
        // 갤럽 셰이더 유니폼 (4족)
        for (const m of actor.mats) {
          const gu = m.userData.gallopU;
          if (gu) {
            gu.uTime.value = t;
            gu.uGallop.value += ((h.moving ? 1 : 0) - gu.uGallop.value) * Math.min(1, dt * 9);
          }
        }
        // 공격 클립 (리깅 캐릭터)
        this.syncAttackClip(actor, modelKey, h);
        // 공격 클립이 없는 캐릭터(여우·비난)는 절차적 런지
        if ((!actor.attackAction || actor.attackAction === 'fail') && h.attackAnim > 0) {
          const k = Math.sin(((0.22 - h.attackAnim) / 0.22) * Math.PI) * 13;
          actor.obj.position.x += Math.cos(h.facing) * k;
          actor.obj.position.z += Math.sin(h.facing) * k;
        }
        // 피격 넉백 + 휘청
        if (h.hitFlash > 0 && h.hitDir !== undefined) {
          const kb = (h.hitFlash / 0.13);
          actor.obj.position.x += Math.cos(h.hitDir) * kb * 7;
          actor.obj.position.z += Math.sin(h.hitDir) * kb * 7;
          actor.obj.rotation.z += kb * 0.07;
          actor.obj.scale.set(actor.baseScale * (1 + kb * 0.05), actor.baseScale * (1 - kb * 0.07), actor.baseScale);
        } else {
          actor.obj.scale.setScalar(actor.baseScale);
        }
        actor.mixer.update(dt);
        // 피격 발광 플래시
        const flash = Math.max(0, h.hitFlash || 0) / 0.13;
        for (const m of actor.mats) {
          if (m.emissive) m.emissive.setScalar(flash * 0.85);
        }
      } else {
        const key = UNIT[modelKey];
        const d = h.radius * 3.7;
        const bob = h.moving ? Math.abs(Math.sin(t * 9 + h.id)) * 5 : Math.sin(t * 2 + h.id) * 2;
        this.syncSprite(key, 'h' + h.id, h.x, h.y, d * 0.44 + bob, d, Math.cos(h.facing) < 0);
      }
      this.syncRing('h' + h.id, h.x, h.y, h.radius * 1.25, h.isPlayer ? 0x3fe5a0 : (h.team === 'blue' ? 0x4a9eff : 0xff5555));
    }
    // 미니언 (공격 런지 + 피격 넉백)
    for (const m of game.minions) {
      if (m.dead || !game.isVisible(m)) continue;
      const key = UNIT[m.team === 'blue' ? 'minion_blue' : 'minion_red'];
      const d = m.radius * (m.type === 'cannon' ? 3.4 : 2.9);
      const bob = Math.abs(Math.sin(t * 8 + m.id)) * 2.5;
      let mx = m.x, mz = m.y;
      if (m.attackAnim > 0) {
        const k = Math.sin(((0.22 - m.attackAnim) / 0.22) * Math.PI) * 10;
        mx += Math.cos(m.facing) * k; mz += Math.sin(m.facing) * k;
      }
      if (m.hitFlash > 0 && m.hitDir !== undefined) {
        const kb = m.hitFlash / 0.13;
        mx += Math.cos(m.hitDir) * kb * 6; mz += Math.sin(m.hitDir) * kb * 6;
      }
      this.syncSprite(key, 'm' + m.id, mx, mz, d * 0.42 + bob, d, Math.cos(m.facing) < 0);
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
    // 몬스터 — 정글 캠프 4종은 3D 메시, 정령·수호자는 발광 빌보드
    for (const mo of game.monsters) {
      if (mo.dead || !mo.def.id) continue;
      const isBig = mo.def.id === 'spirit' || mo.def.id === 'sage';
      let ox = mo.x, oz = mo.y;
      if (mo.attackAnim > 0) {
        const k = Math.sin(((0.22 - mo.attackAnim) / 0.22) * Math.PI) * 12;
        ox += Math.cos(mo.facing) * k; oz += Math.sin(mo.facing) * k;
      }
      if (mo.hitFlash > 0 && mo.hitDir !== undefined) {
        const kb = mo.hitFlash / 0.13;
        ox += Math.cos(mo.hitDir) * kb * 7; oz += Math.sin(mo.hitDir) * kb * 7;
      }
      const monKey = 'mon_' + mo.def.id;
      const actor = MON_MODEL_URLS[monKey] ? this.getActor('o' + mo.id, monKey, mo.radius * 3.0) : null;
      if (actor) {
        actor.used = true;
        actor.obj.visible = true;
        // 절차적 4족 모션: 다리는 셰이더, 몸통은 절제된 바운스
        const active = mo.moving;
        actor.obj.position.set(ox, actor.yOff
          + Math.sin(t * 2 + mo.id) * 1.5
          + (active ? Math.abs(Math.sin(t * 13 + mo.id)) * 3.5 : 0), oz);
        const targetYaw = Math.PI / 2 - mo.facing;
        let dyw = targetYaw - actor.obj.rotation.y;
        while (dyw > Math.PI) dyw -= Math.PI * 2;
        while (dyw < -Math.PI) dyw += Math.PI * 2;
        actor.obj.rotation.y += dyw * Math.min(1, dt * 8);
        actor.obj.rotation.z = active ? Math.sin(t * 13 + mo.id) * 0.045 : Math.sin(t * 1.6 + mo.id) * 0.025;
        const flash = Math.max(0, mo.hitFlash || 0) / 0.13;
        for (const m of actor.mats) {
          if (m.emissive) m.emissive.setScalar(flash * 0.8);
          const gu = m.userData.gallopU;
          if (gu) {
            gu.uTime.value = t;
            gu.uGallop.value += ((active ? 1 : 0) - gu.uGallop.value) * Math.min(1, dt * 9);
          }
        }
      } else {
        const d = mo.radius * (isBig ? 3.4 : 3.0);
        const bob = isBig ? Math.sin(t * 1.8 + mo.id) * 7 : Math.abs(Math.sin(t * 5 + mo.id)) * 2;
        this.syncSprite(MON[mo.def.id], 'o' + mo.id, ox, oz, d * 0.42 + bob, d, Math.cos(mo.facing) < 0);
      }
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
    for (const e of this.pool.values()) if (!e.used) { e.sprite.visible = false; if (e.blob) e.blob.visible = false; }
    for (const r of this.rings.values()) if (!r.used) r.visible = false;
    for (const a of this.actors.values()) if (!a.used) a.obj.visible = false;

    this.fogTex.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
