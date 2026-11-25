// Prepara os modelos 3D (KayKit, licença CC0) para o navegador:
//  - mantém só as animações usadas pelo jogo
//  - reduz as texturas embutidas para 256 px
//  - reempacota o buffer binário sem os dados descartados
// Uso: node scripts/prepare-assets.mjs <pasta-adventurers> <pasta-skeletons> <pasta-dungeon>
// (clones de github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0, ...-Skeletons-1.0, KayKit-Dungeon-Remastered-1.0)
// Requer o pacote opcional `sharp` para reduzir as texturas.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { try { sharp = require('/opt/npm-tools/node_modules/sharp'); } catch { sharp = null; } }

const [adv, skel, dun] = process.argv.slice(2);
if (!adv || !skel || !dun) { console.error('Uso: node scripts/prepare-assets.mjs <adventurers> <skeletons> <dungeon>'); process.exit(1); }
const OUT = path.resolve('client/assets/models');
fs.mkdirSync(OUT, { recursive: true });

const CHAR_ANIMS = [
  'Idle', '2H_Melee_Idle', 'Running_A', 'Walking_A', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '2H_Melee_Attack_Chop',
  '2H_Melee_Attack_Spin', '1H_Ranged_Shoot', '2H_Ranged_Shoot', 'Spellcast_Shoot', 'Spellcast_Raise', 'Death_A', 'Death_A_Pose', 'Hit_A',
  'Dodge_Forward', 'Cheer', 'Block', 'Interact', 'Spellcast_Summon', 'Skeletons_Awaken_Standing', 'Walking_D_Skeletons', 'Taunt',
];

function readGlb(file) {
  const b = fs.readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const binLen = b.readUInt32LE(binStart);
  const bin = b.subarray(binStart + 8, binStart + 8 + binLen);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const pad = (buf, ch) => { const r = (4 - (buf.length % 4)) % 4; return r ? Buffer.concat([buf, Buffer.alloc(r, ch)]) : buf; };
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, j, bh, b]));
}

async function prune(src, dst, keepAnims, texSize = 256) {
  const { json: j, bin } = readGlb(src);
  if (keepAnims) j.animations = (j.animations ?? []).filter((a) => keepAnims.includes(a.name));
  if (j.animations && !j.animations.length) delete j.animations;
  // acessores ainda usados
  const used = new Set();
  const add = (i) => i !== undefined && used.add(i);
  for (const m of j.meshes ?? []) for (const p of m.primitives) { Object.values(p.attributes).forEach(add); add(p.indices); for (const t of p.targets ?? []) Object.values(t).forEach(add); }
  for (const s of j.skins ?? []) add(s.inverseBindMatrices);
  for (const a of j.animations ?? []) for (const s of a.samplers) { add(s.input); add(s.output); }
  const accMap = new Map();
  const accessors = [];
  j.accessors.forEach((a, i) => { if (used.has(i)) { accMap.set(i, accessors.length); accessors.push(a); } });
  const ra = (i) => (i === undefined ? undefined : accMap.get(i));
  for (const m of j.meshes ?? []) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = ra(p.attributes[k]);
    if (p.indices !== undefined) p.indices = ra(p.indices);
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = ra(t[k]);
  }
  for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = ra(s.inverseBindMatrices);
  for (const a of j.animations ?? []) for (const s of a.samplers) { s.input = ra(s.input); s.output = ra(s.output); }
  j.accessors = accessors;
  // bufferViews usados (acessores + imagens), com redução das texturas
  const views = new Map(); // índice antigo -> Buffer
  for (const a of accessors) if (a.bufferView !== undefined && !views.has(a.bufferView)) { const v = j.bufferViews[a.bufferView]; views.set(a.bufferView, bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)); }
  for (const img of j.images ?? []) {
    if (img.bufferView === undefined) continue;
    const v = j.bufferViews[img.bufferView];
    let data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    if (sharp) {
      const meta = await sharp(data).metadata();
      if ((meta.width ?? 0) > texSize) data = await sharp(data).resize(texSize, texSize, { fit: 'inside', kernel: 'nearest' }).png({ compressionLevel: 9, palette: true }).toBuffer();
      img.mimeType = 'image/png';
    }
    views.set(img.bufferView, data);
  }
  const order = [...views.keys()].sort((a, b) => a - b);
  const viewMap = new Map();
  const chunks = [];
  let off = 0;
  const bufferViews = order.map((oldIdx, newIdx) => {
    viewMap.set(oldIdx, newIdx);
    const data = views.get(oldIdx);
    const v = { ...j.bufferViews[oldIdx], buffer: 0, byteOffset: off, byteLength: data.length };
    chunks.push(data);
    off += data.length;
    const padLen = (4 - (off % 4)) % 4;
    if (padLen) { chunks.push(Buffer.alloc(padLen)); off += padLen; }
    return v;
  });
  for (const a of accessors) if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
  for (const img of j.images ?? []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);
  j.bufferViews = bufferViews;
  j.buffers = [{ byteLength: off }];
  writeGlb(dst, j, Buffer.concat(chunks));
  return fs.statSync(dst).size;
}

const jobs = [];
const C = path.join(adv, 'addons/kaykit_character_pack_adventures/Characters/gltf');
for (const n of ['Knight', 'Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian']) jobs.push([path.join(C, `${n}.glb`), `${n}.glb`, CHAR_ANIMS]);
const S = path.join(skel, 'addons/kaykit_character_pack_skeletons/Characters/gltf');
for (const n of ['Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage']) jobs.push([path.join(S, `${n}.glb`), `${n}.glb`, CHAR_ANIMS]);
const W = path.join(adv, 'addons/kaykit_character_pack_adventures/Assets/gltf');
for (const n of ['sword_1handed', 'sword_2handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand', 'crossbow_1handed', 'crossbow_2handed', 'spellbook_open', 'spellbook_closed', 'shield_round', 'shield_badge', 'shield_spikes', 'arrow'])
  jobs.push([path.join(W, `${n}.gltf`), `${n}.glb`, null, 'gltf']);
const D = path.join(dun, 'addons/kaykit_dungeon_remastered/Assets/gltf');
for (const n of ['floor_tile_large', 'floor_tile_large_rocks', 'floor_tile_small_decorated', 'floor_dirt_large', 'floor_wood_large', 'wall', 'wall_half', 'wall_cracked', 'wall_corner', 'wall_pillar', 'pillar', 'pillar_decorated', 'column', 'torch_mounted', 'torch_lit',
  'stairs', 'floor_tile_big_spikes', 'barrel_small', 'barrel_large', 'box_stacked', 'crates_stacked', 'banner_patternA_red', 'banner_thin_blue', 'banner_shield_yellow', 'rubble_half', 'rubble_large', 'candle_triple',
  'table_medium_decorated_A', 'keg_decorated', 'coin_stack_small', 'chest', 'chest_gold', 'shelf_small_candles', 'sword_shield', 'bottle_A_green', 'trunk_large_A']) {
  const f = fs.existsSync(path.join(D, `${n}.gltf.glb`)) ? `${n}.gltf.glb` : `${n}.glb`;
  jobs.push([path.join(D, f), `${n}.glb`, null]);
}

let total = 0;
for (const [src, name, anims, kind] of jobs) {
  if (!fs.existsSync(src)) { console.warn('faltando', src); continue; }
  if (kind === 'gltf') {
    // .gltf com .bin externo: converte para .glb
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    const bin = fs.readFileSync(path.join(path.dirname(src), j.buffers[0].uri));
    for (const img of j.images ?? []) if (img.uri) {
      const data = fs.readFileSync(path.join(path.dirname(src), img.uri));
      j.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: data.length });
      img.bufferView = j.bufferViews.length - 1; img.mimeType = 'image/png'; delete img.uri;
      const merged = Buffer.concat([bin, data]);
      j.buffers = [{ byteLength: merged.length }];
      const tmp = path.join(OUT, `_tmp_${name}`);
      writeGlb(tmp, j, merged);
      total += await prune(tmp, path.join(OUT, name), anims);
      fs.unlinkSync(tmp);
    }
    continue;
  }
  total += await prune(src, path.join(OUT, name), anims);
}
console.log(`${jobs.length} modelos preparados em ${OUT} (${(total / 1024 / 1024).toFixed(2)} MB no total)`);
