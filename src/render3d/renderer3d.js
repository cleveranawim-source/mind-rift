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
const MODEL_HEIGHT = 70; // 영웅 목표 신장 (월드 px) — 맵 대비 LOL 비율

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
// 4족은 몸이 전방축으로 길다 → 바운딩박스로 전방축(x/z) 자동 감지.
// 대각 게이트: (좌앞+우뒤) vs (우앞+좌뒤)가 반대 위상으로 스윙 = 트로트
function addGallopShader(mat, lib) {
  const minY = lib.rawMinY;
  const legTop = lib.rawMinY + lib.rawH * 0.38;
  const amp = lib.rawH * 0.24; // 보폭 크게 — 걸음이 확실히 보이도록
  const fwdIsX = lib.rawSizeX > lib.rawSizeZ; // 긴 축 = 전방
  const FWD = fwdIsX ? 'position.x' : 'position.z';
  const LAT = fwdIsX ? 'position.z' : 'position.x';
  const OUT = fwdIsX ? 'transformed.x' : 'transformed.z';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uGallop = { value: 0 };
    mat.userData.gallopU = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uGallop;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float legW = 1.0 - smoothstep(float(${minY.toFixed(4)}), float(${legTop.toFixed(4)}), position.y);
          legW = legW * legW; // 발끝일수록 크게
          float side = ${LAT} > 0.0 ? 1.0 : -1.0;
          float fore = ${FWD} > 0.0 ? 1.0 : -1.0;
          // 대각 다리 쌍이 같은 위상 (트로트 게이트)
          float phase = uTime * 11.5 + (side * fore > 0.0 ? 0.0 : 3.14159);
          ${OUT} += sin(phase) * legW * uGallop * float(${amp.toFixed(4)});
          transformed.y += max(0.0, sin(phase + 1.2)) * legW * uGallop * float(${(amp * 0.45).toFixed(4)});
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

const CAM_H = 1250;  // 카메라 높이 (LOL 비율로 줌아웃)
const CAM_D = 880;   // 카메라 뒤 거리 (기울기 결정)

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

    // ── 넥서스: 일러스트 크리스탈 빌보드 (타워와 같은 방식 — 도형 아님) ──
    this.nexusMeshes = {};
    for (const team of ['blue', 'red']) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      const D = 300;
      sprite.scale.set(D, D, 1);
      sprite.position.set(NEXUS_POS[team].x, D * 0.42, NEXUS_POS[team].y);
      sprite.userData.nexusKey = team === 'blue' ? 'nexusBlue' : 'nexusRed';
      this.scene.add(sprite);
      // 발밑 글로우
      const glow = this.makeGlowSprite(team === 'blue' ? '#4a9eff' : '#ff5555');
      glow.scale.set(420, 420, 1);
      glow.position.set(NEXUS_POS[team].x, 8, NEXUS_POS[team].y);
      this.scene.add(glow);
      this.nexusMeshes[team] = sprite;
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

  // 숲 — 정점 노이즈 캐노피(나무갓) + 구운 명암(정점 컬러, 언릿)
  // 매끈한 콘 대신 울퉁불퉁한 둥근 수관 덩어리가 페인팅 나무 위에 얹혀 입체 숲으로 보임
  buildForest() {
    // 캐노피 지오메트리 변형 3종: 이코사구를 노이즈로 변형 + y로 밝기 구움
    const makeCanopy = (seed, hueShift) => {
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cLow = new THREE.Color(0x0a1c10);  // 아래·그늘 (깊게)
      const cHigh = new THREE.Color(0x336339); // 위·빛
      cLow.offsetHSL(hueShift, 0, 0);
      cHigh.offsetHSL(hueShift, 0, 0);
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        // 다중 주파수 노이즈 변위 (잎덩어리 실루엣)
        const n1 = Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed * 1.7);
        const n2 = Math.sin(x * 7.9 + z * 6.3 + seed * 3.1) * Math.cos(y * 8.7 + seed);
        const nz = n1 * 0.6 + n2 * 0.4;
        const d = 1 + nz * 0.3;
        pos.setXYZ(i, x * d, y * d * 0.78, z * d);
        // 높이 명암 + 잎 반점 (정점 해시 스펙클)
        const speckle = (Math.sin(i * 127.1 + seed * 311.7) * 0.5 + 0.5) * 0.22 - 0.11;
        const t = Math.min(1, Math.max(0, (y * d * 0.78 + 1) / 2)) * 0.85 + nz * 0.1 + speckle;
        tmp.copy(cLow).lerp(cHigh, Math.min(1, Math.max(0, t)));
        colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    };
    const variants = [makeCanopy(1.3, -0.015), makeCanopy(4.7, 0), makeCanopy(8.2, 0.02)];
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });

    // 나무마다 작은 수관 5덩이 군집 (브로콜리) — 거대 단일 덩어리 금지
    const trees = [];
    for (const w of WALLS) {
      for (const t of w.trees) trees.push({ x: w.x + t.dx, z: w.y + t.dy, s: t.s });
    }
    const LOBES = 5;
    const meshes = variants.map((g) => new THREE.InstancedMesh(g, mat, trees.length * LOBES));
    const counts = [0, 0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    trees.forEach((tr, i) => {
      // 중앙 꼭대기 덩이
      const rTop = tr.s * 0.78;
      const vi0 = i % 3;
      q.setFromEuler(new THREE.Euler(0, i * 2.399, Math.sin(i * 5.1) * 0.08));
      m.compose(v.set(tr.x, tr.s * 1.25, tr.z), q, new THREE.Vector3(rTop, rTop, rTop));
      meshes[vi0].setMatrixAt(counts[vi0]++, m);
      // 둘레 덩이 4개 (높이·크기·각도 지터)
      for (let k = 0; k < LOBES - 1; k++) {
        const a = (k / (LOBES - 1)) * Math.PI * 2 + i * 0.9;
        const rl = tr.s * (0.52 + ((i * 7 + k * 13) % 10) * 0.028);
        const dist = tr.s * (0.62 + ((i + k) % 4) * 0.07);
        const hy = tr.s * (0.78 + ((i * 3 + k) % 5) * 0.09);
        const vi = (i + k + 1) % 3;
        q.setFromEuler(new THREE.Euler(Math.sin(a) * 0.1, a * 1.7, Math.cos(a) * 0.1));
        m.compose(
          v.set(tr.x + Math.cos(a) * dist, hy, tr.z + Math.sin(a) * dist),
          q, new THREE.Vector3(rl, rl * 0.9, rl)
        );
        meshes[vi].setMatrixAt(counts[vi]++, m);
      }
    });
    meshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      this.scene.add(mesh);
    });
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
        this.modelLib.set(key, {
          scene: gltf.scene, clips: gltf.animations, rawH, rawMinY: box.min.y,
          rawSizeX: box.max.x - box.min.x, rawSizeZ: box.max.z - box.min.z,
        });
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
        // 4족 캐릭터: 다리 스윙 셰이더 (전방축 자동 감지)
        if (isQuad) addGallopShader(n.material, lib);
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
    // atkBlend: 걷기↔공격 수동 블렌드(0~1). 합이 항상 1이라 rest 포즈(투명/납작) 불가
    a = { obj, mixer, action, key, yOff: -lib.rawMinY * scale, mats, baseScale: scale, atkBlend: 0, attacking: false };
    this.actors.set(id, a);
    return a;
  }

  // 공격 클립 준비 + 수동 가중치 블렌드 (dt 필요)
  syncAttackClip(actor, key, unit, dt) {
    // 공격 클립 1회 준비
    if (ATTACK_URLS[key] && actor.attackAction === undefined) {
      const atk = this.loadAttackClip(key);
      if (atk === 'missing') { actor.attackAction = null; }
      else if (typeof atk === 'object') {
        try {
          // 클립-본 호환성 검증 (80% 일치)
          const bones = new Set();
          actor.obj.traverse((n) => { if (n.isBone) bones.add(n.name); });
          const targets = [...new Set(atk.clip.tracks.map((tr) => tr.name.split('.')[0]))];
          const matched = targets.filter((n) => bones.has(n)).length;
          if (bones.size === 0 || matched < targets.length * 0.8) {
            actor.attackAction = null; // 폴백=런지
          } else {
            const act = actor.mixer.clipAction(atk.clip);
            act.setLoop(THREE.LoopRepeat); // 반복(수동 종료 제어), 항상 play + weight로만 제어
            act.play();
            act.setEffectiveWeight(0);
            act.setEffectiveTimeScale(1.6);
            actor.attackAction = act;
            actor.atkClipDur = atk.clip.duration;
          }
        } catch { actor.attackAction = null; }
      }
    }

    const hasClip = actor.attackAction && actor.attackAction !== null;

    // 새 공격 시작 (attackAnim 상승) → 클립 처음부터, 블렌드 목표 1
    if ((unit.attackAnim || 0) > (actor.prevAtk ?? 0)) {
      actor.attacking = true;
      actor.attackHold = 0.42; // 공격 포즈 유지 시간
      if (hasClip) actor.attackAction.time = 0;
    }
    actor.prevAtk = unit.attackAnim || 0;

    // 공격 유지 타이머
    if (actor.attacking) {
      actor.attackHold -= dt;
      if (actor.attackHold <= 0) actor.attacking = false;
    }

    // 블렌드 램프 (합=1 보장)
    const target = (actor.attacking && hasClip) ? 1 : 0;
    actor.atkBlend += (target - actor.atkBlend) * Math.min(1, dt * 14);
    if (actor.atkBlend < 0.01) actor.atkBlend = 0;
    if (hasClip) {
      actor.attackAction.setEffectiveWeight(actor.atkBlend);
      if (actor.action) actor.action.setEffectiveWeight(1 - actor.atkBlend);
    }
    // 클립 없는 캐릭터는 attacking을 절차 런지용으로만 사용 (걷기 가중치 항상 1)
    return hasClip;
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
        // 공격 클립 (리깅 캐릭터) — 수동 가중치 블렌드로 합=1 보장
        const hasAtkClip = this.syncAttackClip(actor, modelKey, h, dt);
        // 클립 없는 캐릭터(여우·비난)는 절차적 런지
        if (!hasAtkClip && h.attackAnim > 0) {
          const k = Math.sin(((0.22 - h.attackAnim) / 0.22) * Math.PI) * 13;
          actor.obj.position.x += Math.cos(h.facing) * k;
          actor.obj.position.z += Math.sin(h.facing) * k;
        }
        // 피격 넉백 + 휘청 (누적 금지 — rotation.z를 매 프레임 절대값으로 확정)
        const hitting = h.hitFlash > 0 && h.hitDir !== undefined;
        const kb = hitting ? (h.hitFlash / 0.13) : 0;
        const tilt = kb * 0.18;
        if (actor.action) {
          // 걷기 클립 캐릭터: obj.rotation.z를 아무도 재설정 안 하므로 절대값으로 확정
          actor.obj.rotation.z = tilt;
        } else {
          // 여우류: 위에서 rotation.z를 sin으로 매 프레임 설정했으므로 틸트만 가산(누적 X)
          actor.obj.rotation.z += tilt;
        }
        if (hitting) {
          actor.obj.position.x += Math.cos(h.hitDir) * kb * 7;
          actor.obj.position.z += Math.sin(h.hitDir) * kb * 7;
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

    // 넥서스 부유·상태
    for (const team of ['blue', 'red']) {
      const spr = this.nexusMeshes[team];
      const nx = game.nexus[team];
      spr.visible = !nx.dead;
      // 텍스처 지연 결착
      if (!spr.material.map) {
        const tex = this.getTexture(ENV[spr.userData.nexusKey]);
        if (tex) { spr.material.map = tex; spr.material.needsUpdate = true; }
      }
      spr.position.y = 300 * 0.42 + Math.sin(t * 1.6) * 7;
      spr.material.color.setScalar(nx.invulnerable ? 0.45 : 1);
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
