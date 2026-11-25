// Renderizador 3D (Three.js): câmera isométrica, masmorra instanciada, personagens animados,
// iluminação dinâmica com sombras, efeitos e textos sobrepostos num canvas 2D.
import * as THREE from 'three';
import { BIOMES, ELEMENT_COLOR, ELEMENTS, RANK_INFO, RANKS, TILE } from '../../../shared/constants';
import { T_FLOOR } from '../../../shared/dungeon';
import monsters from '../../../shared/data/monsters.json';
import bosses from '../../../shared/data/bosses.json';
import { buildTown } from '../../../shared/town';
import {
  aimFromFlags, F_DEAD, F_ELITE, F_POISON, F_SLOW, F_STEALTH, F_STUN, F_WINDUP, K_BOSS, K_LOOT, K_MINION, K_MONSTER, K_PLAYER, K_PROJ, MOD_PT,
  type Ent, type MapState,
} from './common';
import {
  animateProcedural, attach, CLASS_MODEL, getLoaded, KAY, load, makeCharacter, makeProcedural, mat, OFFHAND_MODEL, play, TWO_HANDED, WEAPON_MODEL,
  type CharView, type ProcView,
} from './models';

const U = 1 / TILE; // unidades do servidor → tiles (unidade 3D)
const DEF: Record<string, { id: string; shape: string; palette: string[] }> = Object.fromEntries(
  [...monsters, ...bosses].map((m) => [m.id, { id: m.id, shape: m.shape, palette: m.palette }]),
);
const elemColor = (i: number) => ELEMENT_COLOR[ELEMENTS[i] ?? 'physical'];
const BIOME_TINT = ['#d8d2e2', '#a9c4f0', '#b9d6a4', '#f0b49a', '#b8a2f0'];
const BIOME_LIGHT = ['#ffb46a', '#8fd8ff', '#c8ff9a', '#ff8a4a', '#ff6ad8'];

/** Monstros com forma humanoide usam os esqueletos animados do KayKit. */
function skeletonModel(defId: string, shape: string): { model: string; weapon?: string; offhand?: string; scale: number; tint?: boolean; ghost?: boolean } | null {
  if (shape === 'skeleton') {
    if (defId === 'skel_archer') return { model: 'Skeleton_Rogue', weapon: 'crossbow_1handed', scale: 1 };
    if (defId === 'obsidian_knight') return { model: 'Skeleton_Warrior', weapon: 'sword_1handed', offhand: 'shield_spikes', scale: 1.15, tint: true };
    if (defId === 'kragg') return { model: 'Skeleton_Warrior', weapon: 'sword_2handed', scale: 1, tint: true };
    return { model: 'Skeleton_Minion', weapon: 'axe_1handed', scale: 1 };
  }
  if (shape === 'imp') return { model: 'Skeleton_Rogue', weapon: 'dagger', scale: 0.9, tint: true };
  if (shape === 'wraith') return { model: 'Skeleton_Mage', weapon: 'staff', scale: 1, tint: true, ghost: true };
  return null;
}

interface View {
  key: string; root: any; char?: CharView; proc?: ProcView; mesh?: any; extra?: any;
  lx: number; ly: number; yaw: number; atkUntil: number; dead: boolean; scale: number; seenT: number; moving: boolean;
}

interface Txt { on: boolean; x: number; y: number; z: number; vy: number; life: number; max: number; text: string; color: string; size: number }
interface Fx { on: boolean; type: string; obj: any; life: number; max: number; data: any }

export class Renderer3D {
  r: any; scene: any; camera: any;
  w = 0; h = 0; dpr = 1;
  camX = 0; camY = 0; selfAim = 0; shake = 0; time = 0; zoom = 1;
  map: MapState | null = null;
  town = buildTown();
  private og: CanvasRenderingContext2D;
  private staticGroup: any = new THREE.Group();
  private hemi: any; private sun: any; private playerLight: any; private torchLights: any[] = [];
  private torches: { x: number; z: number; seed: number }[] = [];
  private views = new Map<number, View>();
  private pool = new Map<string, View[]>();
  private texts: Txt[] = [];
  private fxs: Fx[] = [];
  private chests: any[] = [];
  private stairsObj: any = null;
  private rubble: any = null;
  private portal: any = null;
  private npcViews: { name: string; root: any; char?: CharView; x: number; z: number }[] = [];
  private mapVersion = 0;
  private parts!: { geo: any; pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; base: Float32Array; n: number; points: any };
  private quality = { low: false, frames: 0, t: 0 };
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private v3 = new THREE.Vector3();

  constructor(public canvas: HTMLCanvasElement, public overlay: HTMLCanvasElement, public minimap: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 0.95;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 80);
    this.og = overlay.getContext('2d')!;
    this.scene.add(this.staticGroup);

    this.hemi = new THREE.HemisphereLight('#8a90b0', '#1a1420', 0.6);
    this.sun = new THREE.DirectionalLight('#c8d0ff', 1.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 50;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.playerLight = new THREE.PointLight('#ffc890', 14, 9, 1.6);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.playerLight);
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight('#ff9a4a', 0, 6, 1.8); this.torchLights.push(l); this.scene.add(l); }
    this.initParticles();
    this.resize();
    canvas.addEventListener('wheel', (e) => { this.zoom = Math.max(0.65, Math.min(1.4, this.zoom * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: true });
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  }

  resize() {
    this.dpr = Math.min(this.quality.low ? 1 : 1.5, window.devicePixelRatio || 1);
    const cw = this.canvas.clientWidth || innerWidth, ch = this.canvas.clientHeight || innerHeight;
    this.r.setPixelRatio(this.dpr);
    this.r.setSize(cw, ch, false);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
    const od = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(cw * od); this.overlay.height = Math.round(ch * od);
    this.w = cw; this.h = ch;
  }

  // ---------------- coordenadas ----------------
  screenToWorld(sx: number, sy: number): [number, number] {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return [this.camX, this.camY];
    return [hit.x * TILE, hit.z * TILE];
  }
  private project(x: number, y: number, z: number): [number, number, boolean] {
    this.v3.set(x, y, z).project(this.camera);
    const od = this.overlay.width / this.w;
    return [((this.v3.x + 1) / 2) * this.w * od, ((1 - this.v3.y) / 2) * this.h * od, this.v3.z < 1 && Math.abs(this.v3.x) < 1.2 && Math.abs(this.v3.y) < 1.2];
  }

  // ---------------- mapa estático ----------------
  setMap(m: MapState) {
    this.map = m;
    const version = ++this.mapVersion;
    for (const [id, v] of this.views) this.release(id, v);
    this.views.clear();
    for (const f of this.fxs) this.endFx(f);
    this.texts.length = 0;
    this.parts.n = 0;
    void this.buildStatic(m, version);
  }

  private disposeStatic() {
    this.staticGroup.traverse((o: any) => { if (o.isInstancedMesh) o.dispose(); });
    this.scene.remove(this.staticGroup);
    this.staticGroup = new THREE.Group();
    this.scene.add(this.staticGroup);
    this.chests = []; this.stairsObj = null; this.rubble = null; this.portal = null;
    for (const n of this.npcViews) n.char?.mixer.stopAllAction();
    this.npcViews = [];
    this.torches = [];
  }

  private async buildStatic(m: MapState, version: number) {
    const town = m.world === 'town';
    const names = ['floor_tile_large', 'floor_tile_large_rocks', 'wall', 'wall_cracked', 'torch_mounted', 'barrel_small', 'barrel_large', 'crates_stacked', 'box_stacked',
      'banner_patternA_red', 'banner_thin_blue', 'candle_triple', 'rubble_half', ...(town
        ? ['floor_dirt_large', 'table_medium_decorated_A', 'keg_decorated', 'banner_shield_yellow', 'sword_shield', 'shelf_small_candles', 'trunk_large_A', 'bottle_A_green']
        : ['chest', 'chest_gold', 'stairs', 'floor_tile_big_spikes', 'rubble_large', 'pillar', 'column'])];
    const g: Record<string, any> = {};
    await Promise.all(names.map((n) => load(n).then((x) => (g[n] = x)).catch(() => null)));
    if (version !== this.mapVersion) return;
    this.disposeStatic();
    const tint = town ? '#f4ecdc' : BIOME_TINT[m.biome] ?? '#ffffff';
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.tiles[y * m.w + x]);
    const hash = (x: number, y: number, s = 0) => (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) ^ s * 83492791) >>> 0;
    const batches = new Map<string, any[]>();
    // lotes por modelo e por bloco de 12×12 tiles: blocos fora da câmera não são desenhados (culling)
    const CH = 12;
    const put = (name: string, mtx: any) => {
      if (!g[name]) return;
      const e = mtx.elements;
      const key = `${name}|${Math.floor(e[12] / CH)}|${Math.floor(e[14] / CH)}`;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = []));
      b.push(mtx);
    };
    const M = (x: number, y: number, z: number, rot: number, sx = KAY, sy = KAY, sz = KAY) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(sx, sy, sz));
    const stairs = m.stairs;

    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (at(x, y) !== T_FLOOR) continue;
      const hsh = hash(x, y);
      if (!(stairs && stairs.x === x && stairs.y === y && !town)) {
        const floorName = town ? (hsh % 5 === 0 ? 'floor_dirt_large' : 'floor_tile_large') : hsh % 23 === 0 && !m.stairs?.open === !!m.stairs ? 'floor_tile_large_rocks' : 'floor_tile_large';
        put(floorName, M(x + 0.5, 0, y + 0.5, ((hsh >> 3) % 4) * (Math.PI / 2)));
      }
      // paredes nas bordas com tiles sólidos (a parede fica dentro do tile sólido)
      const edges: [number, number, number, number, number, boolean][] = [
        [x, y - 1, x + 0.5, y - 0.125, 0, false], [x, y + 1, x + 0.5, y + 1.125, Math.PI, true],
        [x - 1, y, x - 0.125, y + 0.5, Math.PI / 2, false], [x + 1, y, x + 1.125, y + 0.5, -Math.PI / 2, false],
      ];
      for (const [nx, ny, wx, wz, rot, south] of edges) {
        const t = at(nx, ny);
        if (t === T_FLOOR) continue;
        // paredes viradas para a câmera ficam baixas para não esconder o jogador
        put(t === 3 ? 'wall_cracked' : 'wall', M(wx, 0, wz, rot, KAY, south ? KAY * 0.28 : KAY, KAY));
        if (!south && rot === 0) {
          const h2 = hash(x, y, 7);
          if (h2 % (town ? 6 : 7) === 0 && !this.torches.some((tt) => Math.abs(tt.x - (x + 0.5)) < 4 && Math.abs(tt.z - y) < 3)) {
            put('torch_mounted', M(x + 0.5, 0.42, y - 0.02, 0));
            this.torches.push({ x: x + 0.5, z: y + 0.12, seed: h2 % 1000 });
          } else if (h2 % 13 === 1) put(town ? 'banner_shield_yellow' : h2 % 2 ? 'banner_patternA_red' : 'banner_thin_blue', M(x + 0.5, 0, y - 0.25, 0));
        }
      }
      // decoração junto às paredes (sem colisão, só visual)
      const nearWall = edges.some(([nx, ny]) => at(nx, ny) !== T_FLOOR);
      const h3 = hash(x, y, 3) % 100;
      if (nearWall && h3 < (town ? 6 : 5) && !(stairs && Math.abs(stairs.x - x) < 2 && Math.abs(stairs.y - y) < 2) && !m.objects.some((o) => o.x === x && o.y === y)) {
        const props = town ? ['barrel_large', 'crates_stacked', 'keg_decorated', 'box_stacked', 'trunk_large_A'] : ['barrel_small', 'crates_stacked', 'box_stacked', 'candle_triple', 'rubble_half', 'barrel_large'];
        const name = props[hash(x, y, 9) % props.length];
        put(name, M(x + 0.5 + ((hash(x, y, 4) % 5) - 2) * 0.06, 0, y + 0.5 + ((hash(x, y, 5) % 5) - 2) * 0.06, (hash(x, y, 6) % 8) * 0.785));
      }
    }

    // objetos do andar (armadilhas fixas; baús animados à parte)
    if (!town) {
      for (const o of m.objects) {
        if (o.k === 'trap') put('floor_tile_big_spikes', M(o.x + 0.5, 0.005, o.y + 0.5, 0, KAY, KAY * 0.18, KAY));
      }
    }

    // gera um InstancedMesh por malha de cada modelo
    const matCacheLocal = new Map<string, any>();
    for (const [key, mats] of batches) {
      const name = key.split('|')[0];
      const src = g[name];
      src.scene.updateMatrixWorld(true);
      src.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        const material = Array.isArray(o.material) ? o.material[0] : o.material;
        let mm = matCacheLocal.get(material.uuid);
        if (!mm) { mm = material.clone(); mm.color = new THREE.Color(tint); matCacheLocal.set(material.uuid, mm); }
        const im = new THREE.InstancedMesh(o.geometry, mm, mats.length);
        const local = o.matrixWorld;
        const tmp = new THREE.Matrix4();
        mats.forEach((mt, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mt, local)));
        im.instanceMatrix.needsUpdate = true;
        im.receiveShadow = true;
        im.castShadow = !name.startsWith('floor');
        im.computeBoundingSphere();
        this.staticGroup.add(im);
      });
    }

    if (!town) {
      // baús (cada um com tampa animável)
      for (const o of m.objects) {
        if (o.k !== 'chest' && o.k !== 'secretChest') { this.chests.push(null); continue; }
        const src = g[o.k === 'chest' ? 'chest' : 'chest_gold'];
        if (!src) { this.chests.push(null); continue; }
        const c = src.scene.clone();
        c.scale.setScalar(KAY * 1.3);
        c.position.set(o.x + 0.5, 0, o.y + 0.5);
        c.rotation.y = Math.PI;
        c.traverse((n: any) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
        const lid = c.getObjectByName(o.k === 'chest' ? 'chest_lid' : 'chest_gold_lid');
        if (lid && o.open) lid.rotation.x = -1.6;
        c.userData.lid = lid;
        this.staticGroup.add(c);
        this.chests.push(c);
      }
      // escada descendo (afundada no chão) + entulho quando fechada
      if (stairs && g.stairs) {
        const st = g.stairs.scene.clone();
        st.scale.setScalar(KAY * 0.8);
        st.position.set(stairs.x + 0.5, -1.02, stairs.y + 0.1);
        st.rotation.y = Math.PI;
        st.traverse((n: any) => { if (n.isMesh) { n.receiveShadow = true; n.material = n.material.clone(); n.material.color = new THREE.Color(tint); } });
        const pit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.2), mat('#050308'));
        pit.position.set(stairs.x + 0.5, -0.56, stairs.y + 0.5);
        this.staticGroup.add(pit, st);
        this.stairsObj = st;
        if (!stairs.open && g.rubble_large) {
          this.rubble = g.rubble_large.scene.clone();
          this.rubble.scale.setScalar(KAY * 0.9);
          this.rubble.position.set(stairs.x + 0.5, 0, stairs.y + 0.5);
          this.staticGroup.add(this.rubble);
        }
      }
    } else {
      this.buildTownExtras(g, tint);
    }

    // luz e névoa do ambiente
    const fogColor = town ? '#2a2620' : BIOMES[m.biome].fog;
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.Fog(fogColor, town ? 22 : 13, town ? 40 : 24);
    if (town) {
      this.hemi.color.set('#e8dcc8'); this.hemi.groundColor.set('#3a2e24'); this.hemi.intensity = 1.25;
      this.sun.color.set('#ffe2b8'); this.sun.intensity = 2.1;
      this.playerLight.intensity = 0;
    } else {
      this.hemi.color.set(BIOME_LIGHT[m.biome]); this.hemi.groundColor.set('#0a0810'); this.hemi.intensity = 0.42;
      this.sun.color.set('#9fb0ff'); this.sun.intensity = 0.75;
      this.playerLight.color.set('#ffc890'); this.playerLight.intensity = 16;
    }
    for (const l of this.torchLights) l.color.set(town ? '#ffb060' : BIOME_LIGHT[m.biome] === '#8fd8ff' ? '#8fd8ff' : '#ff9a4a');
  }

  private buildTownExtras(g: Record<string, any>, tint: string) {
    const m = this.map!;
    // telhados: um por construção (componentes de tiles sólidos que não são a borda)
    const seen = new Uint8Array(m.w * m.h);
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      if (m.tiles[y * m.w + x] === T_FLOOR || seen[y * m.w + x]) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y;
      const q = [[x, y]];
      seen[y * m.w + x] = 1;
      while (q.length) {
        const [cx, cy] = q.pop()!;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx <= 0 || ny <= 0 || nx >= m.w - 1 || ny >= m.h - 1) continue;
          const i = ny * m.w + nx;
          if (!seen[i] && m.tiles[i] !== T_FLOOR) { seen[i] = 1; q.push([nx, ny]); }
        }
      }
      const W = x1 - x0 + 1, D = y1 - y0 + 1;
      const wallH = 1.0;
      const roof = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, D), mat('#3a2418'));
      base.position.set(0, wallH, 0);
      // telhado de quatro águas: pirâmide de base quadrada esticada até o tamanho da casa
      const pyr = new THREE.CylinderGeometry(0, Math.SQRT1_2, 1, 4, 1);
      pyr.rotateY(Math.PI / 4);
      const prism = new THREE.Mesh(pyr, mat('#7a3024'));
      prism.scale.set(W + 0.35, Math.min(W, D) * 0.55, D + 0.35);
      prism.position.set(0, wallH + Math.min(W, D) * 0.275 + 0.04, 0);
      roof.add(base, prism);
      roof.position.set(x0 + W / 2, 0, y0 + D / 2);
      roof.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.staticGroup.add(roof);
    }
    // NPCs animados e portal
    const NPC_MODEL: Record<string, string> = { smith: 'Barbarian', alchemist: 'Mage', jeweler: 'Rogue', market: 'Knight' };
    for (const n of this.town.npcs) {
      const x = n.x, z = n.y;
      if (n.role === 'portal') {
        const grp = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.09, 10, 40), mat('#3d2a6e', { emissive: '#b07cff', ei: 1.5, flat: false }));
        const inner = new THREE.Mesh(new THREE.CircleGeometry(0.66, 40), new THREE.MeshBasicMaterial({ color: '#7a3aff', transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
        grp.add(ring, inner);
        grp.position.set(x, 0.95, z);
        const light = new THREE.PointLight('#b07cff', 12, 6, 1.6);
        light.position.set(x, 1.2, z + 0.6);
        this.staticGroup.add(grp, light);
        this.portal = grp;
        continue;
      }
      if (n.role === 'board') {
        for (const [name, dx] of [['table_medium_decorated_A', 0], ['banner_shield_yellow', 0]] as const) {
          if (!g[name]) continue;
          const o = g[name].scene.clone(); o.scale.setScalar(KAY); o.position.set(x + dx, 0, z); this.staticGroup.add(o);
        }
        continue;
      }
      const v = { name: n.name, root: new THREE.Group(), x, z } as (typeof this.npcViews)[number];
      v.root.position.set(x, 0, z);
      this.staticGroup.add(v.root);
      this.npcViews.push(v);
      load(NPC_MODEL[n.role]).then((gl) => {
        if (!this.npcViews.includes(v)) return;
        v.char = makeCharacter(gl, { keepAccessories: n.role === 'smith' || n.role === 'market' });
        v.root.add(v.char.root);
        play(v.char, 'Idle');
        v.char.mixer.update(Math.random() * 3);
      }).catch(() => {});
      // balcão com itens
      const stall = n.role === 'smith' ? 'sword_shield' : n.role === 'alchemist' ? 'shelf_small_candles' : 'table_medium_decorated_A';
      if (g[stall]) { const o = g[stall].scene.clone(); o.scale.setScalar(KAY); o.position.set(x + 0.9, 0, z - 0.2); o.traverse((k: any) => k.isMesh && (k.castShadow = true)); this.staticGroup.add(o); }
    }
    void tint;
  }

  setTile(x: number, y: number, v: number) {
    if (!this.map) return;
    this.map.tiles[y * this.map.w + x] = v;
    void this.buildStatic(this.map, ++this.mapVersion); // revelação de parede secreta: reconstrói (raro)
  }

  openChest(i: number) {
    const c = this.chests[i];
    if (c?.userData.lid) c.userData.opening = true;
  }
  openStairs() {
    if (this.rubble) { this.staticGroup.remove(this.rubble); this.rubble = null; }
    if (this.map?.stairs) this.burst((this.map.stairs.x + 0.5) * TILE, (this.map.stairs.y + 0.5) * TILE, '#ffd23f', 50, 3, 1.4);
  }

  // ---------------- entidades ----------------
  private viewKey(e: Ent): string {
    switch (e.kind) {
      case K_PLAYER: return `p:${CLASS_MODEL[e.meta.c]?.model ?? 'Knight'}:${CLASS_MODEL[e.meta.c]?.tint ?? ''}`;
      case K_MINION: return 'minion';
      case K_MONSTER: case K_BOSS: return `m:${e.meta.d}:${e.kind}:${e.meta.r ?? 6}`;
      case K_PROJ: return `j:${e.meta.s}:${e.meta.h ? 'h' : e.meta.e}`;
      case K_LOOT: return e.meta.trap ? 'l:trap' : e.meta.g ? 'l:gold' : e.meta.gem ? 'l:gem' : `l:item:${e.meta.r}`;
    }
    return 'x';
  }

  private getView(e: Ent): View {
    let v = this.views.get(e.id);
    if (v) return v;
    const key = this.viewKey(e);
    const pooled = this.pool.get(key)?.pop();
    v = pooled ?? this.createView(e, key);
    v.lx = e.x; v.ly = e.y; v.atkUntil = 0; v.dead = false; v.seenT = this.time; v.moving = false;
    v.yaw = e.kind === K_PLAYER ? 0 : Math.random() * Math.PI * 2;
    v.root.visible = true;
    if (v.char) { v.char.mixer.stopAllAction(); v.char.current = ''; play(v.char, 'Idle'); }
    this.scene.add(v.root);
    this.views.set(e.id, v);
    return v;
  }

  private release(id: number, v: View) {
    this.scene.remove(v.root);
    this.views.delete(id);
    let p = this.pool.get(v.key);
    if (!p) this.pool.set(v.key, (p = []));
    if (p.length < 40) p.push(v);
  }

  private createView(e: Ent, key: string): View {
    const root = new THREE.Group();
    const v: View = { key, root, lx: e.x, ly: e.y, yaw: 0, atkUntil: 0, dead: false, scale: 1, seenT: 0, moving: false };
    const asChar = (model: string, o: { tint?: string; opacity?: number; scale?: number; weapon?: string; offhand?: string }) => {
      load(model).then((g) => {
        v.char = makeCharacter(g, { tint: o.tint, opacity: o.opacity, scale: o.scale });
        root.add(v.char.root);
        if (o.weapon) attach(v.char, 'r', o.weapon);
        if (o.offhand) attach(v.char, 'l', o.offhand);
        play(v.char, 'Idle');
      }).catch(() => {});
    };
    switch (e.kind) {
      case K_PLAYER: {
        const cm = CLASS_MODEL[e.meta.c] ?? CLASS_MODEL.warrior;
        asChar(cm.model, { tint: cm.tint });
        break;
      }
      case K_MINION: asChar('Skeleton_Minion', { tint: '#b8e6a0', weapon: 'sword_1handed' }); break;
      case K_MONSTER: case K_BOSS: {
        const def = DEF[e.meta.d] ?? { id: '', shape: 'slime', palette: ['#888', '#444', '#fff'] };
        const scale = Math.max(0.7, (e.meta.r ?? 6) / 7) * (e.kind === K_BOSS ? 1.25 : 1);
        v.scale = scale;
        const sk = skeletonModel(def.id, def.shape);
        if (sk) {
          const tint = sk.tint ? lighten(def.palette[0], 0.35) : undefined;
          asChar(sk.model, { tint, opacity: sk.ghost ? 0.72 : 1, scale: sk.scale * scale, weapon: sk.weapon, offhand: sk.offhand });
          if (sk.ghost) v.extra = 'ghost';
        } else {
          v.proc = makeProcedural(def.shape, def.palette);
          v.proc.root.scale.setScalar(scale * (def.shape === 'golem' ? 0.9 : 1));
          root.add(v.proc.root);
        }
        if (e.kind === K_BOSS) {
          const aura = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
          aura.rotation.x = -Math.PI / 2; aura.position.y = 0.03; aura.scale.setScalar(scale * 0.42);
          root.add(aura);
          v.mesh = aura;
        }
        break;
      }
      case K_PROJ: {
        const col = e.meta.h ? '#ff5a3a' : elemColor(e.meta.e ?? 0);
        if (e.meta.s === 'arrow') {
          const arrow = new THREE.Group();
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 5), mat('#c8b08a'));
          shaft.rotation.x = Math.PI / 2;
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 5), mat(col, { emissive: col, ei: 0.6 }));
          tip.rotation.x = Math.PI / 2; tip.position.z = 0.26;
          arrow.add(shaft, tip);
          arrow.position.y = 0.45;
          root.add(arrow);
        } else {
          const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), new THREE.MeshBasicMaterial({ color: col }));
          const glow = new THREE.Sprite(glowMaterial(col));
          glow.scale.setScalar(0.7);
          orb.position.y = glow.position.y = 0.45;
          root.add(orb, glow);
        }
        break;
      }
      case K_LOOT: {
        if (e.meta.trap) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 24), new THREE.MeshBasicMaterial({ color: '#ff9a2e', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
          ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
          root.add(ring);
        } else if (e.meta.g) {
          load('coin_stack_small').then((g) => { const c = g.scene.clone(); c.scale.setScalar(KAY * 0.9); root.add(c); }).catch(() => {});
        } else {
          const rank = e.meta.gem ? null : RANKS[e.meta.r ?? 0];
          const c = e.meta.gem ? '#7fe3ff' : RANK_INFO[rank!].color === 'rainbow' ? '#ffd23f' : RANK_INFO[rank!].color;
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat(c, { emissive: c, ei: 0.7, rough: 0.2 }));
          gem.position.y = 0.3;
          root.add(gem);
          v.mesh = gem;
          if ((e.meta.r ?? 0) >= 4 || e.meta.gem) {
            const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 3, 8, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
            beam.position.y = 1.5;
            root.add(beam);
          }
        }
        break;
      }
    }
    return v;
  }

  // ---------------- partículas (um único draw call) ----------------
  private initParticles() {
    const N = 1500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: dotTexture(), sizeAttenuation: true });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.parts = { geo, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), base: new Float32Array(N * 3), n: 0, points };
  }

  burst(x: number, y: number, color: string, n: number, speed = 1.5, life = 0.7, height = 0.4, grav = -2) {
    const P = this.parts, c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      if (P.n >= P.life.length) return;
      const i = P.n++;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      P.pos.set([x * U, height + Math.random() * 0.2, y * U], i * 3);
      P.vel.set([Math.cos(a) * s, Math.random() * speed * 0.8 + 0.3, Math.sin(a) * s], i * 3);
      P.base.set([c.r, c.g, c.b], i * 3);
      P.life[i] = 0; P.max[i] = life * (0.6 + Math.random() * 0.6);
      P.vel[i * 3 + 1] *= grav < 0 ? 1 : -1;
    }
  }

  private updateParticles(dt: number) {
    const P = this.parts;
    let i = 0;
    while (i < P.n) {
      P.life[i] += dt;
      if (P.life[i] >= P.max[i]) {
        const last = --P.n; // troca com o último (sem alocar)
        P.pos.copyWithin(i * 3, last * 3, last * 3 + 3); P.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
        P.base.copyWithin(i * 3, last * 3, last * 3 + 3); P.life[i] = P.life[last]; P.max[i] = P.max[last];
        continue;
      }
      P.vel[i * 3 + 1] -= 2.5 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] = Math.max(0.02, P.pos[i * 3 + 1] + P.vel[i * 3 + 1] * dt); P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      P.vel[i * 3] *= 0.97; P.vel[i * 3 + 2] *= 0.97;
      const k = 1 - P.life[i] / P.max[i];
      P.col[i * 3] = P.base[i * 3] * k; P.col[i * 3 + 1] = P.base[i * 3 + 1] * k; P.col[i * 3 + 2] = P.base[i * 3 + 2] * k;
      i++;
    }
    P.geo.setDrawRange(0, P.n);
    P.geo.attributes.position.needsUpdate = true;
    P.geo.attributes.color.needsUpdate = true;
  }

  // ---------------- efeitos ----------------
  text(x: number, y: number, text: string, color: string, size = 1) {
    let t = this.texts.find((q) => !q.on);
    if (!t) { if (this.texts.length > 160) return; t = { on: false, x: 0, y: 0, z: 0, vy: 0, life: 0, max: 0, text: '', color: '', size: 0 }; this.texts.push(t); }
    t.on = true; t.x = x * U + (Math.random() - 0.5) * 0.3; t.z = y * U; t.y = 0.9; t.vy = 1.4 + size * 0.3; t.life = 0; t.max = 0.9 + size * 0.15; t.text = text; t.color = color; t.size = size;
  }

  private addFx(type: string, obj: any, max: number, data: any = {}) {
    let f = this.fxs.find((q) => !q.on && q.type === type);
    if (f) { f.obj.visible = true; }
    else {
      if (this.fxs.length > 300) return null;
      f = { on: true, type, obj, life: 0, max, data };
      this.fxs.push(f);
      this.scene.add(obj);
    }
    f.on = true; f.life = 0; f.max = max; f.data = data;
    return f;
  }
  private endFx(f: Fx) { f.on = false; f.obj.visible = false; }

  private fxMesh(type: string, make: () => any) {
    const f = this.fxs.find((q) => !q.on && q.type === type);
    return f ? f.obj : make();
  }

  private ring(x: number, y: number, r: number, color: string, max: number) {
    const obj = this.fxMesh('ring', () => new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
    obj.rotation.x = -Math.PI / 2; obj.position.set(x * U, 0.06, y * U);
    obj.material.color.set(color);
    this.addFx('ring', obj, max, { r: Math.max(0.2, r * U) });
  }

  serverFx(f: any[], _selfEid: number) {
    switch (f[0]) {
      case 'd': {
        const crit = f[5] === 1, toPlayer = f[6] === 1;
        this.text(f[1], f[2], String(f[3]), toPlayer ? '#ff5a4a' : crit ? '#ffe04a' : elemColor(f[4]), crit ? 1.6 : 1);
        if (!toPlayer) this.burst(f[1], f[2], elemColor(f[4]), crit ? 8 : 4, 1.2, 0.4, 0.5);
        if (toPlayer && f[3] > 0) this.shake = Math.min(0.25, this.shake + 0.08);
        break;
      }
      case 'tg': {
        const circle = f[3] === 0;
        const col = f[9] === 1 ? '#ff3b2a' : '#4aa0ff';
        if (circle) {
          const obj = this.fxMesh('tgc', () => {
            const grp = new THREE.Group();
            const edge = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
            const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
            const bg = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
            grp.add(bg, fill, edge); grp.rotation.x = -Math.PI / 2;
            return grp;
          });
          obj.position.set(f[1] * U, 0.04, f[2] * U);
          obj.scale.setScalar(Math.max(0.2, f[4] * U));
          for (const c of obj.children) c.material.color.set(col);
          this.addFx('tgc', obj, f[8] / 1000);
        } else {
          const obj = this.fxMesh('tgl', () => {
            const grp = new THREE.Group();
            const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0.5, 0, 0);
            const bg = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide }));
            const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
            grp.add(bg, fill);
            return grp;
          });
          obj.position.set(f[1] * U, 0.045, f[2] * U);
          obj.rotation.set(-Math.PI / 2, 0, -f[5]);
          obj.scale.set(f[6] * U, f[7] * U, 1);
          for (const c of obj.children) c.material.color.set(col);
          this.addFx('tgl', obj, f[8] / 1000);
        }
        break;
      }
      case 'ex': this.ring(f[1], f[2], f[3], elemColor(f[4]), 0.4); this.burst(f[1], f[2], elemColor(f[4]), Math.min(30, 8 + f[3] / 2), 1 + f[3] * U * 2, 0.6, 0.3); break;
      case 'bm': {
        const obj = this.fxMesh('beam', () => { const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0.5, 0, 0); return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); });
        obj.position.set(f[1] * U, 0.3, f[2] * U); obj.rotation.set(-Math.PI / 2, 0, -f[3]); obj.scale.set(f[4] * U, f[5] * U, 1);
        obj.material.color.set(elemColor(f[6]));
        this.addFx('beam', obj, 0.35);
        break;
      }
      case 'sw': {
        const arc = Math.round((f[4] as number) * 5) / 5;
        const key = `sw${arc}`;
        const obj = this.fxMesh(key, () => new THREE.Mesh(new THREE.RingGeometry(0.35, 1, 20, 1, -arc / 2, arc), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
        obj.position.set(f[1] * U, 0.35, f[2] * U);
        obj.rotation.set(-Math.PI / 2, 0, -f[3]);
        obj.scale.setScalar(Math.max(0.3, f[5] * U));
        obj.material.color.set(f[6] === 9 ? '#ff6a5a' : elemColor(f[6]));
        this.addFx(key, obj, 0.16);
        break;
      }
      case 'h': this.text(f[1], f[2], f[3] ? `+${f[3]}` : '♥', '#7aff8a', 1); this.burst(f[1], f[2], '#7aff8a', 14, 0.6, 0.9, 0.2); break;
      case 'lv': this.ring(f[1], f[2], 40, '#ffd23f', 0.9); this.burst(f[1], f[2], '#ffd23f', 60, 2, 1.3, 0.2); this.text(f[1], f[2], 'NÍVEL!', '#ffd23f', 2); break;
      case 'ch': case 'da': {
        const col = f[0] === 'ch' ? '#fff35c' : elemColor(f[5]);
        const n = 8;
        for (let i = 0; i <= n; i++) {
          const k = i / n;
          this.burst(f[1] + (f[3] - f[1]) * k, f[2] + (f[4] - f[2]) * k, col, 2, 0.3, f[0] === 'ch' ? 0.25 : 0.4, 0.4);
        }
        break;
      }
      case 'k': this.burst(f[1], f[2], '#8a7a9a', 16, 1.4, 0.7, 0.3); break;
      case 'tx': this.text(f[1], f[2], String(f[3]), '#cfe8ff', 1); break;
      case 'rr': {
        const c = RANK_INFO[RANKS[f[3] as number]].color;
        this.burst(f[1], f[2], c === 'rainbow' ? '#ffd23f' : c, 60, 1.8, 1.6, 0.3);
        this.ring(f[1], f[2], 30, c === 'rainbow' ? '#ffffff' : c, 1.2);
        break;
      }
      case 'at': {
        const v = this.views.get(f[3]);
        if (!v?.char) { if (v) v.atkUntil = this.time + 0.3; break; }
        const type = f[4] as number;
        const ent = v.char;
        const two = TWO_HANDED.has(Object.keys(WEAPON_MODEL).find((k) => WEAPON_MODEL[k] === ent.weapon.split('|')[0]) ?? '');
        const clip = type === 0 ? (two ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop') : type === 1 ? (two ? '2H_Ranged_Shoot' : '1H_Ranged_Shoot') : 'Spellcast_Shoot';
        play(ent, clip, { once: true, fade: 0.08, speed: 1.6 });
        v.atkUntil = this.time + 0.5;
        break;
      }
    }
  }

  private updateFx(dt: number) {
    for (const f of this.fxs) {
      if (!f.on) continue;
      f.life += dt;
      const k = f.life / f.max;
      if (k >= 1) { this.endFx(f); continue; }
      switch (f.type) {
        case 'ring': f.obj.scale.setScalar(f.data.r * (0.35 + k * 0.75)); f.obj.material.opacity = 1 - k; break;
        case 'tgc': f.obj.children[1].scale.setScalar(Math.max(0.01, k)); break;
        case 'tgl': f.obj.children[1].scale.set(Math.max(0.01, k), 1, 1); break;
        case 'beam': f.obj.material.opacity = 1 - k; break;
        default: if (f.type.startsWith('sw')) f.obj.material.opacity = 0.7 * (1 - k);
      }
    }
  }

  // ---------------- quadro ----------------
  draw(entsIt: Iterable<Ent>, selfId: number, dt: number, hoverId: number) {
    const ents = Array.from(entsIt); // percorrido duas vezes (3D e textos)
    this.time += dt;
    const m = this.map;
    const t = this.time;
    // câmera isométrica seguindo o jogador
    const tx = this.camX * U, tz = this.camY * U;
    const shake = this.shake > 0 ? (this.shake -= dt * 0.8, this.shake) : 0;
    const dist = 9.5 * this.zoom;
    this.camera.position.set(tx + (Math.random() - 0.5) * shake, dist * 0.92, tz + dist * 0.86 + (Math.random() - 0.5) * shake);
    (window as any).__gl = this.r.info.render;
    this.camera.lookAt(tx, 0, tz);
    this.sun.position.set(tx - 6, 14, tz + 4);
    this.sun.target.position.set(tx, 0, tz);
    this.playerLight.position.set(tx, 1.6, tz + 0.3);

    // tochas: as 6 mais próximas ganham luz real (tremulante)
    if (m) {
      const near = this.torches.map((q) => ({ q, d: (q.x - tx) ** 2 + (q.z - tz) ** 2 })).sort((a, b) => a.d - b.d).slice(0, this.torchLights.length);
      this.torchLights.forEach((l, i) => {
        const n = near[i];
        if (!n || n.d > 400) { l.intensity = 0; return; }
        const fl = 0.85 + Math.sin(t * 11 + n.q.seed) * 0.1 + Math.sin(t * 23 + n.q.seed * 1.7) * 0.06;
        l.position.set(n.q.x, 0.75, n.q.z);
        l.intensity = (m.world === 'town' ? 5 : 9) * fl;
        if (Math.random() < dt * 2) this.burst(n.q.x * TILE, n.q.z * TILE - 1, '#ffb04a', 1, 0.2, 0.9, 0.6);
      });
    }
    for (const c of this.chests) if (c?.userData.opening && c.userData.lid) { c.userData.lid.rotation.x = Math.max(-1.6, c.userData.lid.rotation.x - dt * 5); }
    if (this.portal) { this.portal.rotation.y = Math.sin(t * 0.8) * 0.3; this.portal.children[1].material.opacity = 0.45 + Math.sin(t * 3) * 0.12; if (Math.random() < 0.3) this.burst(this.portal.position.x * TILE + (Math.random() - 0.5) * 16, this.portal.position.z * TILE, '#b07cff', 1, 0.3, 1.2, 0.3); }
    for (const n of this.npcViews) n.char?.mixer.update(dt);

    // sincroniza entidades com objetos 3D
    const alive = new Set<number>();
    for (const e of ents) {
      alive.add(e.id);
      const v = this.getView(e);
      this.updateView(v, e, e.id === selfId, dt);
    }
    for (const [id, v] of this.views) if (!alive.has(id)) this.release(id, v);

    this.updateFx(dt);
    this.updateParticles(dt);
    this.autoQuality(dt);
    this.r.render(this.scene, this.camera);
    this.drawOverlay(ents, selfId, hoverId, dt);
  }

  private updateView(v: View, e: Ent, self: boolean, dt: number) {
    const x = e.x * U, z = e.y * U;
    const dx = e.x - v.lx, dy = e.y - v.ly;
    const speed = Math.hypot(dx, dy) / Math.max(dt, 0.001);
    v.lx = e.x; v.ly = e.y;
    const moving = speed > 6;
    v.moving = moving;
    v.root.position.set(x, 0, z);
    // direção: mira ao atacar, senão a direção do movimento
    let targetYaw = v.yaw;
    if (e.kind === K_PLAYER) {
      const aim = self ? this.selfAim : aimFromFlags(e.flags);
      if (this.time < v.atkUntil || (self && !moving)) targetYaw = Math.atan2(Math.cos(aim), Math.sin(aim));
      else if (moving) targetYaw = Math.atan2(dx, dy);
    } else if (e.kind === K_PROJ) {
      targetYaw = Math.atan2(Math.cos(e.meta.a ?? 0), Math.sin(e.meta.a ?? 0));
      v.yaw = targetYaw;
    } else if (moving) targetYaw = Math.atan2(dx, dy);
    let d = targetYaw - v.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.yaw += d * Math.min(1, dt * 14);
    v.root.rotation.y = v.yaw;

    const dead = (e.flags & F_DEAD) !== 0;
    if (v.char) {
      const c = v.char;
      if (e.kind === K_PLAYER) {
        const wr = e.meta.wr ?? 0;
        const rc = RANK_INFO[RANKS[wr] ?? 'F'].color;
        attach(c, 'r', WEAPON_MODEL[e.meta.w] ?? '', wr >= 5 ? (rc === 'rainbow' ? '#ffd23f' : rc) : '');
        attach(c, 'l', OFFHAND_MODEL[e.meta.o] ?? (e.meta.w === 'grimoire' ? '' : ''));
      }
      if (dead && !v.dead) { play(c, 'Death_A', { once: true, fade: 0.1 }); v.dead = true; }
      else if (!dead) {
        v.dead = false;
        if (this.time >= v.atkUntil) {
          const two = TWO_HANDED.has(e.meta.w);
          if (moving) play(c, 'Running_A', { speed: Math.min(1.6, Math.max(0.7, speed / 70)) });
          else play(c, two && e.kind === K_PLAYER ? '2H_Melee_Idle' : 'Idle');
        }
      }
      c.mixer.update(dt * ((e.flags & F_STUN) ? 0.1 : (e.flags & F_SLOW) ? 0.6 : 1));
      v.root.visible = !((e.flags & F_STEALTH) && !self);
      if (v.extra === 'ghost') v.root.position.y = 0.12 + Math.sin(this.time * 2 + e.id) * 0.05;
    } else if (v.proc) {
      const atk = this.time < v.atkUntil ? 1 - (v.atkUntil - this.time) / 0.3 : 0;
      animateProcedural(v.proc, dt, moving, (e.flags & F_WINDUP) ? 0.6 + Math.sin(this.time * 40) * 0.2 : atk > 0 ? Math.sin(atk * Math.PI) : 0);
    }
    if (e.kind === K_BOSS && v.mesh) { v.mesh.rotation.z += dt; v.mesh.material.opacity = 0.35 + Math.sin(this.time * 4) * 0.15; }
    if (e.kind === K_LOOT && v.mesh) { v.mesh.rotation.y += dt * 2; v.mesh.position.y = 0.3 + Math.sin(this.time * 3 + e.id) * 0.05; }
    if (e.flash > 0 && (e.kind === K_MONSTER || e.kind === K_BOSS) && Math.random() < 0.5) this.burst(e.x, e.y, '#ffffff', 1, 0.5, 0.2, 0.5);
    if (e.flags & F_POISON && Math.random() < dt * 6) this.burst(e.x, e.y, '#7ad84a', 1, 0.2, 0.7, 0.6);
    const cos = e.meta.cos as string | undefined;
    if (cos && e.kind === K_PLAYER && Math.random() < dt * 14) {
      const col = cos === 'aura_fire' ? '#ff7a2e' : cos === 'aura_void' ? '#b07cff' : cos === 'aura_gold' ? '#ffd23f' : `hsl(${(this.time * 120) % 360},90%,60%)`;
      this.burst(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 10, col, 1, 0.2, 1, 0.1);
    }
  }

  /** Reduz a qualidade se o FPS ficar baixo por alguns segundos (sombras e resolução). */
  private autoQuality(dt: number) {
    const q = this.quality;
    if (q.low) return;
    q.frames++; q.t += dt;
    if (q.t < 4) return;
    const fps = q.frames / q.t;
    q.frames = 0; q.t = 0;
    if (fps < 40) {
      q.low = true;
      this.r.shadowMap.enabled = false;
      this.sun.castShadow = false;
      this.scene.traverse((o: any) => { if (o.material) o.material.needsUpdate = true; });
      this.resize();
    }
  }

  // ---------------- textos, nomes e barras (canvas 2D por cima) ----------------
  private drawOverlay(ents: Iterable<Ent>, selfId: number, hoverId: number, dt: number) {
    const g = this.og, od = this.overlay.width / this.w;
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    g.textAlign = 'center';
    const label = (txt: string, x: number, y: number, color: string, size: number) => {
      g.font = `${Math.round(size * od)}px Georgia, serif`;
      g.fillStyle = '#000'; g.fillText(txt, x + od, y + od);
      g.fillStyle = color; g.fillText(txt, x, y);
    };
    const bar = (x: number, y: number, w: number, pct: number, color: string) => {
      g.fillStyle = '#000b'; g.fillRect(x - w / 2 - od, y - od, w + 2 * od, 5 * od);
      g.fillStyle = color; g.fillRect(x - w / 2, y, (w * pct) / 100, 3 * od);
    };
    for (const e of ents) {
      const v = this.views.get(e.id);
      if (!v) continue;
      if (e.kind === K_PLAYER) {
        const [sx, sy, on] = this.project(e.x * U, 1.0, e.y * U);
        if (!on || ((e.flags & F_STEALTH) && e.id !== selfId)) continue;
        label(e.meta.n ?? '', sx, sy - 10 * od, e.id === selfId ? '#f0d48a' : '#cfe8ff', 12);
        if (e.id !== selfId && e.hp < 100) bar(sx, sy - 4 * od, 36 * od, e.hp, '#5fbf6a');
      } else if (e.kind === K_MONSTER) {
        const elite = (e.flags & F_ELITE) !== 0;
        const [sx, sy, on] = this.project(e.x * U, 0.75 * v.scale + 0.1, e.y * U);
        if (!on) continue;
        if (e.hp < 100 || e.id === hoverId || elite) bar(sx, sy, 34 * od * Math.min(1.6, v.scale), e.hp, elite ? '#ffd23f' : '#d84a3a');
        if (e.id === hoverId || elite) {
          const mods = (e.meta.m ?? []) as string[];
          label(mods.length ? `${mods.map((x) => MOD_PT[x] ?? x).join(' ')} ${e.meta.n}` : e.meta.n, sx, sy - 6 * od, elite ? '#ffd23f' : '#e8dcc2', 11);
        }
      } else if (e.kind === K_LOOT && !e.meta.trap && (e.meta.n && ((e.meta.r ?? 0) >= 3 || e.id === hoverId))) {
        const [sx, sy, on] = this.project(e.x * U, 0.55, e.y * U);
        const c = RANK_INFO[RANKS[e.meta.r ?? 0]].color;
        if (on) label(e.meta.n, sx, sy, c === 'rainbow' ? `hsl(${(this.time * 180) % 360},90%,65%)` : c, 11);
      }
    }
    for (const n of this.npcViews) {
      const [sx, sy, on] = this.project(n.x, 1.25, n.z);
      if (on) label(n.name, sx, sy, '#f0d48a', 13);
    }
    if (this.portal) { const [sx, sy, on] = this.project(this.portal.position.x, 2, this.portal.position.z); if (on) label('Portal do Abismo', sx, sy, '#d8b8ff', 14); }
    // números de dano
    for (const t of this.texts) {
      if (!t.on) continue;
      t.life += dt;
      if (t.life >= t.max) { t.on = false; continue; }
      t.y += t.vy * dt; t.vy *= 0.93;
      const [sx, sy, on] = this.project(t.x, t.y, t.z);
      if (!on) continue;
      const a = Math.min(1, (t.max - t.life) / 0.3);
      const size = Math.round((12 + t.size * 6) * od * (t.life < 0.08 ? 1.3 : 1));
      g.globalAlpha = a;
      g.font = `bold ${size}px 'Courier New', monospace`;
      g.fillStyle = '#000'; g.fillText(t.text, sx + 1.5 * od, sy + 1.5 * od);
      g.fillStyle = t.color; g.fillText(t.text, sx, sy);
    }
    g.globalAlpha = 1;
  }

  /** Minimapa: tiles explorados + jogadores. */
  drawMinimap(ents: Iterable<Ent>, selfId: number, partyIds: Set<number>) {
    const m = this.map;
    if (!m) return;
    const c = this.minimap, g = c.getContext('2d')!;
    const scale = Math.max(1, Math.floor(Math.min(c.width / m.w, c.height / m.h)));
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const ox = (c.width - m.w * scale) / 2, oy = (c.height - m.h * scale) / 2;
    g.fillStyle = m.world === 'town' ? '#6a6050' : BIOMES[m.biome].floor2;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      if (m.tiles[i] === T_FLOOR && (m.world === 'town' || m.explored[i])) g.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
    if (m.stairs && m.explored[m.stairs.y * m.w + m.stairs.x]) { g.fillStyle = m.stairs.open ? '#ffd23f' : '#a83232'; g.fillRect(ox + m.stairs.x * scale - 1, oy + m.stairs.y * scale - 1, scale + 2, scale + 2); }
    for (const e of ents) {
      if (e.kind !== K_PLAYER && e.kind !== K_BOSS) continue;
      g.fillStyle = e.id === selfId ? '#fff' : e.kind === K_BOSS ? '#ff3b3b' : partyIds.has(e.id) ? '#5fbf6a' : '#7fb0ff';
      g.fillRect(ox + (e.x / TILE) * scale - 1.5, oy + (e.y / TILE) * scale - 1.5, 3, 3);
    }
  }
}

function lighten(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#ffffff'), k);
  return `#${c.getHexString()}`;
}

let dotTex: any = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
const glowCache = new Map<string, any>();
function glowMaterial(color: string) {
  let m = glowCache.get(color);
  if (!m) { m = new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); glowCache.set(color, m); }
  return m;
}
export { getLoaded };
