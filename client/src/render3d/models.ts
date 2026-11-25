// Carregamento preguiçoso dos modelos 3D (KayKit, CC0) e monstros procedurais low-poly.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SERVER } from '../api';

export const KAY = 0.25; // 4 unidades KayKit = 1 tile
/** Personagens um pouco maiores que a escala do cenário, para leitura na câmera isométrica. */
export const CHAR_SCALE = 1.5;

const loader = new GLTFLoader();
const cache = new Map<string, Promise<any>>();
const ready = new Map<string, any>();

/** Carrega (uma vez) um modelo .glb. Os modelos só são baixados quando aparecem pela primeira vez. */
export function load(name: string): Promise<any> {
  let p = cache.get(name);
  if (!p) {
    p = new Promise((res, rej) => loader.load(`${SERVER}/assets/models/${name}.glb`, (g: any) => {
      g.scene.traverse((o: any) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.side = THREE.FrontSide; }
      });
      ready.set(name, g);
      res(g);
    }, undefined, rej));
    cache.set(name, p);
  }
  return p;
}
export const getLoaded = (name: string) => ready.get(name);

// ---------- personagens ----------
export const CLASS_MODEL: Record<string, { model: string; tint?: string }> = {
  warrior: { model: 'Knight' }, mage: { model: 'Mage' }, archer: { model: 'Rogue' }, rogue: { model: 'Rogue_Hooded' },
  cleric: { model: 'Knight', tint: '#fff2c8' }, necro: { model: 'Mage', tint: '#9a86d0' },
};
export const WEAPON_MODEL: Record<string, string> = {
  sword: 'sword_1handed', axe: 'axe_1handed', spear: 'sword_2handed', bow: 'crossbow_1handed', crossbow: 'crossbow_2handed',
  staff: 'staff', wand: 'wand', dagger: 'dagger', hammer: 'axe_2handed', scythe: 'axe_2handed', grimoire: 'spellbook_open',
};
export const OFFHAND_MODEL: Record<string, string> = { shield: 'shield_round', orb: 'spellbook_closed' };
export const TWO_HANDED = new Set(['spear', 'bow', 'crossbow', 'staff', 'hammer', 'scythe']);
const ACCESSORY = /Sword|Shield|Spellbook|Wand|Staff|Knife|Crossbow|Throwable|Axe|Mug/i;

const tintCache = new Map<string, any>();
function tinted(mat: any, tint: string, opacity = 1) {
  const key = `${mat.uuid}|${tint}|${opacity}`;
  let m = tintCache.get(key);
  if (!m) {
    m = mat.clone();
    m.color = new THREE.Color(tint);
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    tintCache.set(key, m);
  }
  return m;
}

export interface CharView {
  root: any; mixer: any; actions: Record<string, any>; current: string; handR: any; handL: any;
  weapon: string; offhand: string; hover: number; flying: boolean;
}

/** Instancia um personagem animado (clonando o esqueleto). */
export function makeCharacter(gltf: any, opts: { tint?: string; opacity?: number; scale?: number; keepAccessories?: boolean } = {}): CharView {
  const scene = SkeletonUtils.clone(gltf.scene);
  let handR: any = null, handL: any = null;
  scene.traverse((o: any) => {
    // o GLTFLoader remove pontos dos nomes: 'handslot.r' vira 'handslotr'
    if (o.name === 'handslot.r' || o.name === 'handslotr') handR = o;
    if (o.name === 'handslot.l' || o.name === 'handslotl') handL = o;
    if (o.isMesh) {
      if (!opts.keepAccessories && ACCESSORY.test(o.name)) o.visible = false;
      if (opts.tint || (opts.opacity ?? 1) < 1) o.material = tinted(o.material, opts.tint ?? '#ffffff', opts.opacity ?? 1);
      o.frustumCulled = false; // malhas com esqueleto: o culling é feito por personagem
    }
  });
  const root = new THREE.Group();
  scene.scale.setScalar(KAY * CHAR_SCALE * (opts.scale ?? 1));
  root.add(scene);
  const mixer = new THREE.AnimationMixer(scene);
  const actions: Record<string, any> = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  return { root, mixer, actions, current: '', handR, handL, weapon: '', offhand: '', hover: 0, flying: false };
}

/** Coloca a arma do equipamento na mão do personagem. */
export function attach(view: CharView, hand: 'r' | 'l', model: string, glow = '') {
  const slot = hand === 'r' ? view.handR : view.handL;
  const key = hand === 'r' ? 'weapon' : 'offhand';
  const id = model ? `${model}|${glow}` : '';
  if (!slot || view[key] === id) return;
  view[key] = id;
  for (const c of [...slot.children]) if (c.userData.equip) slot.remove(c);
  if (!model) return;
  load(model).then((g) => {
    if (view[key] !== id) return;
    const w = g.scene.clone();
    w.userData.equip = true;
    w.traverse((o: any) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // armas de rank alto brilham na cor do rank
      if (glow) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(glow); o.material.emissiveIntensity = 0.55; }
    });
    slot.add(w);
  }).catch(() => {});
}

/** Troca de animação com transição suave. */
export function play(view: CharView, name: string, opts: { once?: boolean; fade?: number; speed?: number } = {}) {
  const a = view.actions[name] ?? view.actions.Idle;
  if (!a) return;
  if (view.current === name && !opts.once) { a.timeScale = opts.speed ?? 1; return; }
  const prev = view.actions[view.current];
  a.reset();
  a.timeScale = opts.speed ?? 1;
  a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = !!opts.once;
  a.enabled = true;
  if (prev && prev !== a) a.crossFadeFrom(prev, opts.fade ?? 0.15, false);
  a.play();
  view.current = name;
}

// ---------- monstros procedurais (formas sem modelo pronto) ----------
const geo = {
  sphere: new THREE.IcosahedronGeometry(1, 1),
  sphereHi: new THREE.SphereGeometry(1, 16, 12),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 7),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  tri: (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.2, 0.2, -0.5, 1.1, -0.1, 0.6], 3)); g.computeVertexNormals(); return g; })(),
};
const matCache = new Map<string, any>();
export function mat(color: string, o: { emissive?: string; ei?: number; opacity?: number; flat?: boolean; rough?: number } = {}) {
  const key = JSON.stringify([color, o]);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, flatShading: o.flat ?? true, roughness: o.rough ?? 0.75, metalness: 0.05,
      emissive: o.emissive ?? '#000000', emissiveIntensity: o.ei ?? 1,
      transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, side: THREE.DoubleSide,
    });
    matCache.set(key, m);
  }
  return m;
}
function part(g: any, m: any, s: [number, number, number], p: [number, number, number], r: [number, number, number] = [0, 0, 0]) {
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(...s); mesh.position.set(...p); mesh.rotation.set(...r);
  mesh.castShadow = true;
  return mesh;
}

export interface ProcView { root: any; body: any; parts: any[]; shape: string; t: number }

/** Monstro low-poly montado com primitivas, usando a paleta do JSON. Tamanho base ≈ 1 tile. */
export function makeProcedural(shape: string, pal: string[]): ProcView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const [c1, c2, c3] = pal;
  const parts: any[] = [];
  const eye = mat(c3, { emissive: c3, ei: 1.6 });
  switch (shape) {
    case 'slime': {
      body.add(part(geo.sphereHi, mat(c1, { opacity: 0.82, flat: false, rough: 0.2, emissive: c2, ei: 0.25 }), [0.36, 0.26, 0.36], [0, 0.24, 0]));
      body.add(part(geo.sphere, mat(c2), [0.16, 0.1, 0.16], [0, 0.17, 0]));
      body.add(part(geo.sphere, eye, [0.04, 0.05, 0.04], [-0.1, 0.32, 0.27]), part(geo.sphere, eye, [0.04, 0.05, 0.04], [0.1, 0.32, 0.27]));
      break;
    }
    case 'bat': {
      body.position.y = 0.55;
      body.add(part(geo.sphere, mat(c1), [0.14, 0.13, 0.16], [0, 0, 0]));
      body.add(part(geo.cone, mat(c1), [0.04, 0.1, 0.04], [-0.07, 0.15, 0]), part(geo.cone, mat(c1), [0.04, 0.1, 0.04], [0.07, 0.15, 0]));
      body.add(part(geo.sphere, eye, [0.03, 0.03, 0.03], [-0.05, 0.03, 0.13]), part(geo.sphere, eye, [0.03, 0.03, 0.03], [0.05, 0.03, 0.13]));
      const wl = part(geo.tri, mat(c2), [0.4, 0.4, 0.4], [0.08, 0, 0]);
      const wr = part(geo.tri, mat(c2), [-0.4, 0.4, 0.4], [-0.08, 0, 0]);
      body.add(wl, wr); parts.push(wl, wr);
      break;
    }
    case 'spider': {
      body.add(part(geo.sphere, mat(c1), [0.22, 0.15, 0.28], [0, 0.22, -0.08]));
      body.add(part(geo.sphere, mat(c2), [0.13, 0.11, 0.13], [0, 0.2, 0.2]));
      for (const x of [-0.05, 0.05]) body.add(part(geo.sphere, eye, [0.03, 0.03, 0.03], [x, 0.24, 0.32]));
      for (let i = 0; i < 8; i++) {
        const side = i < 4 ? 1 : -1, k = i % 4;
        const leg = part(geo.box, mat(c2), [0.36, 0.03, 0.03], [side * 0.22, 0.16, 0.12 - k * 0.09], [0, side * (0.4 - k * 0.25), side * -0.45]);
        body.add(leg); parts.push(leg);
      }
      break;
    }
    case 'mushroom': {
      body.add(part(geo.cyl, mat(c2), [0.11, 0.3, 0.11], [0, 0.15, 0]));
      body.add(part(geo.sphere, mat(c1), [0.32, 0.18, 0.32], [0, 0.34, 0]));
      for (const [x, z] of [[0.15, 0.1], [-0.12, 0.16], [0.02, -0.18], [-0.18, -0.06]]) body.add(part(geo.sphere, mat('#f4f0e0'), [0.05, 0.03, 0.05], [x, 0.44, z]));
      for (const x of [-0.05, 0.05]) body.add(part(geo.sphere, eye, [0.025, 0.035, 0.025], [x, 0.2, 0.1]));
      break;
    }
    case 'beetle': {
      body.add(part(geo.sphereHi, mat(c1, { flat: false, rough: 0.25 }), [0.26, 0.17, 0.32], [0, 0.18, 0]));
      body.add(part(geo.sphere, mat(c2), [0.12, 0.1, 0.11], [0, 0.15, 0.3]));
      body.add(part(geo.cone, mat(c3), [0.03, 0.18, 0.03], [0, 0.22, 0.43], [1.3, 0, 0]));
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? 1 : -1, k = i % 3;
        const leg = part(geo.box, mat(c2), [0.25, 0.025, 0.025], [side * 0.24, 0.07, 0.12 - k * 0.13], [0, side * 0.3, side * -0.5]);
        body.add(leg); parts.push(leg);
      }
      break;
    }
    case 'eye': {
      body.position.y = 0.5;
      body.add(part(geo.sphereHi, mat('#f0eef4', { flat: false, rough: 0.3 }), [0.24, 0.24, 0.24], [0, 0, 0]));
      body.add(part(geo.sphereHi, mat(c1, { flat: false, emissive: c1, ei: 0.4 }), [0.12, 0.12, 0.06], [0, 0, 0.2]));
      body.add(part(geo.sphereHi, mat('#05030a', { flat: false }), [0.05, 0.05, 0.03], [0, 0, 0.255]));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const t = part(geo.cone, mat(c2), [0.04, 0.3, 0.04], [Math.cos(a) * 0.12, -0.28, Math.sin(a) * 0.12 - 0.04], [Math.PI, 0, 0]);
        body.add(t); parts.push(t);
      }
      break;
    }
    case 'worm': {
      for (let i = 0; i < 6; i++) {
        const s = 0.16 - i * 0.017;
        const seg = part(geo.sphere, mat(i % 2 ? c2 : c1), [s, s, s], [0, s, 0.22 - i * 0.12]);
        body.add(seg); parts.push(seg);
      }
      for (const x of [-0.06, 0.06]) body.add(part(geo.sphere, eye, [0.03, 0.03, 0.03], [x, 0.22, 0.34]));
      break;
    }
    default: { // golem de pedra
      body.add(part(geo.box, mat(c1), [0.5, 0.45, 0.34], [0, 0.6, 0]));
      body.add(part(geo.box, mat(c1), [0.26, 0.22, 0.24], [0, 0.95, 0.03]));
      for (const x of [-0.07, 0.07]) body.add(part(geo.box, eye, [0.05, 0.04, 0.02], [x, 0.97, 0.16]));
      for (const x of [-0.35, 0.35]) { const arm = part(geo.box, mat(c2), [0.17, 0.5, 0.18], [x, 0.52, 0]); body.add(arm); parts.push(arm); }
      for (const x of [-0.13, 0.13]) body.add(part(geo.box, mat(c2), [0.17, 0.38, 0.2], [x, 0.19, 0]));
      body.add(part(geo.box, mat(c3, { emissive: c3, ei: 0.8 }), [0.14, 0.14, 0.02], [0, 0.62, 0.18]));
    }
  }
  return { root, body, parts, shape, t: Math.random() * 10 };
}

/** Anima monstros procedurais (asas, pernas, respiração). `moving` acelera o ciclo. */
export function animateProcedural(v: ProcView, dt: number, moving: boolean, attacking: number) {
  v.t += dt * (moving ? 2.2 : 1);
  const t = v.t;
  const b = v.body;
  switch (v.shape) {
    case 'slime': b.scale.set(1 + Math.sin(t * 5) * 0.08, 1 - Math.sin(t * 5) * 0.1 + attacking * 0.3, 1 + Math.sin(t * 5) * 0.08); break;
    case 'bat': v.parts[0].rotation.z = Math.sin(t * 18) * 0.7; v.parts[1].rotation.z = -Math.sin(t * 18) * 0.7; b.position.y = 0.55 + Math.sin(t * 3) * 0.06; break;
    case 'spider': case 'beetle': v.parts.forEach((l: any, i: number) => (l.rotation.x = Math.sin(t * 14 + i * 1.3) * (moving ? 0.35 : 0.05))); break;
    case 'eye': b.position.y = 0.5 + Math.sin(t * 2) * 0.06; v.parts.forEach((l: any, i: number) => (l.rotation.z = Math.sin(t * 3 + i) * 0.25)); break;
    case 'worm': v.parts.forEach((s: any, i: number) => (s.position.x = Math.sin(t * 6 - i * 0.9) * 0.05 * i)); break;
    case 'mushroom': b.scale.y = 1 + Math.sin(t * 4) * 0.04; break;
    default: v.parts.forEach((a: any, i: number) => (a.rotation.x = Math.sin(t * 6 + i * Math.PI) * (moving ? 0.5 : 0.08) - attacking * 1.4)); break;
  }
}
