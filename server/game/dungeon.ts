import monstersData from '../../shared/data/monsters.json';
import bossesData from '../../shared/data/bosses.json';
import {
  BIOMES, CHECKPOINT_EVERY, ELEMENTS, RANKS, SKILL_UNLOCK_LEVELS, TICK_RATE, TILE, floorScaling, isBossFloor, skillUnlocked, type Element,
} from '../../shared/constants';
import { computeDamage } from '../../shared/combat';
import { encodeTiles, generateFloor, T_FLOOR, T_SECRET, type FloorMap } from '../../shared/dungeon';
import { rollChestLoot, rollMonsterLoot } from '../../shared/loot';
import { lineOfSight, moveWithCollision, type Grid } from '../../shared/movement';
import { hashSeed } from '../../shared/rng';
import type { SkillDef } from '../../shared/stats';
import type { Item } from '../../shared/types';
import { checkAchievements, ensureDaily, grantXp } from './character';
import { addToInventory } from './inventory';
import { newEntityId, type Player } from './player';
import type { Party } from './party';
import { F_DEAD, F_ELITE, F_POISON, F_SLOW, F_STUN, F_WINDUP, INTEREST, K_BOSS, K_LOOT, K_MINION, K_MONSTER, K_PROJ, World, type HubApi } from './world';

type MonsterDef = (typeof monstersData)[number];
type BossDef = (typeof bossesData)[number];
const MONSTER_BY_ID: Record<string, MonsterDef> = Object.fromEntries(monstersData.map((m) => [m.id, m]));
const ELEM_IDX = (e: string) => Math.max(0, ELEMENTS.indexOf(e as Element));
const MODS = ['elite', 'fast', 'poison', 'armored', 'vampiric', 'explosive'] as const;
export const MOD_LABEL: Record<string, string> = { elite: 'Elite', fast: 'Veloz', poison: 'Venenoso', armored: 'Blindado', vampiric: 'Vampírico', explosive: 'Explosivo' };

interface Monster {
  id: number; def: MonsterDef | BossDef; name: string; x: number; y: number; r: number;
  hp: number; maxHp: number; dmg: number; speed: number; ai: string; range: number; atkCd: number; element: Element; xp: number;
  mods: string[]; nextAtk: number; target: Player | null; stunUntil: number; slowUntil: number;
  poison: { dps: number; until: number; owner: Player | null } | null; tauntBy: Player | null; tauntUntil: number;
  state: 'idle' | 'chase' | 'windup' | 'dash' | 'fuse'; stateUntil: number; dirX: number; dirY: number;
  armor: number; projSpeed: number; boss?: { phase: number; nextAbility: number; active: boolean; adds: number };
  isAdd?: boolean; dashHit?: Set<number>; wanderAt: number; lastHitBy: Player | null; dead?: boolean;
}
interface Proj {
  id: number; owner: Player | null; src: Monster | null; x: number; y: number; vx: number; vy: number; left: number; r: number;
  element: Element; mult: number; dmg: number; pierce: number; hit: Set<number>; aoe: number; sprite: string;
  poison?: number; poisonDur?: number; skillId?: string; crit?: boolean;
}
interface Tele {
  at: number; x: number; y: number; shape: 'c' | 'l'; r: number; ang: number; len: number; wid: number;
  owner: Player | null; src: Monster | null; mult: number; dmg: number; element: Element; stun?: number; drain?: number; skillId?: string;
}
interface Minion { id: number; owner: Player; x: number; y: number; until: number; nextAtk: number; mult: number }
interface Loot { id: number; owner: Player; x: number; y: number; gold?: number; item?: Item; gems?: number }
interface PTrap { id: number; owner: Player; x: number; y: number; until: number; mult: number; r: number; skillId: string; element: Element }

type DmgOpts = { skillId?: string; crit?: boolean; poison?: number; poisonDur?: number; stun?: number; slow?: number; drain?: number; noProc?: boolean };
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const rnd = Math.random;

export class Dungeon extends World {
  kind = 'dungeon' as const;
  grid!: Grid;
  map!: FloorMap;
  seed = (Math.random() * 2 ** 31) | 0;
  monsters = new Map<number, Monster>();
  projs: Proj[] = [];
  teles: Tele[] = [];
  minions: Minion[] = [];
  loots: Loot[] = [];
  ptraps: PTrap[] = [];
  chestsOpen: boolean[] = [];
  trapCd: number[] = [];
  stairsOpen = true;
  descendAt = 0;
  bossName = '';
  closed = false;

  constructor(hub: HubApi, public party: Party | null, startFloor: number) {
    super(hub);
    this.loadFloor(startFloor, false);
  }

  // ---------------- andares ----------------
  loadFloor(floor: number, movePlayers = true) {
    this.floor = floor;
    this.map = generateFloor(hashSeed(this.seed, floor), floor);
    this.grid = { w: this.map.w, h: this.map.h, tiles: this.map.tiles };
    this.monsters.clear();
    this.projs = []; this.teles = []; this.loots = []; this.ptraps = [];
    this.minions = this.minions.filter(() => false);
    this.chestsOpen = this.map.objects.map(() => false);
    this.trapCd = this.map.objects.map(() => 0);
    this.descendAt = 0;
    this.stairsOpen = !this.map.boss;
    const biome = BIOMES[this.map.biome];
    const pool = monstersData.filter((m) => m.biome === biome.id);
    const fs = floorScaling(floor);
    for (const sp of this.map.spawns) this.spawnMonster(pool[(rnd() * pool.length) | 0], (sp.x + 0.5) * TILE, (sp.y + 0.5) * TILE, fs, true);
    if (this.map.boss) this.spawnBoss();
    if (movePlayers) {
      for (const p of [...this.players]) {
        p.char.data.phoenixUsed = false;
        this.add(p, (this.map.start.x + 0.5) * TILE + (rnd() - 0.5) * 20, (this.map.start.y + 0.5) * TILE + (rnd() - 0.5) * 20);
        this.onReachFloor(p);
      }
    }
  }

  onReachFloor(p: Player) {
    const c = p.char;
    ensureDaily(p.char);
    if (this.floor > c.maxFloor) {
      if (c.maxFloor > 0) c.data.daily.floors++;
      c.maxFloor = this.floor;
    }
    if (this.floor > 1 && (this.floor - 1) % CHECKPOINT_EVERY === 0 && this.floor > c.checkpoint) {
      c.checkpoint = this.floor;
      p.toast(`Checkpoint desbloqueado: andar ${this.floor}`, 'good');
    }
    this.hub.onAchievements(p);
    p.dirty = true;
  }

  mapMessage() {
    const pub = this.map.tiles.map((v) => (v === T_SECRET ? 3 : v));
    return {
      world: 'dungeon', w: this.map.w, h: this.map.h, tiles: encodeTiles(pub), biome: this.map.biome, floor: this.floor,
      objects: this.map.objects.map((o, i) => ({ k: o.kind, x: o.x, y: o.y, open: this.chestsOpen[i] })),
      stairs: { x: this.map.stairs.x, y: this.map.stairs.y, open: this.stairsOpen }, boss: this.bossName,
    };
  }

  private spawnMonster(def: MonsterDef, x: number, y: number, fs: ReturnType<typeof floorScaling>, rollMods: boolean, isAdd = false): Monster {
    const mods: string[] = [];
    if (rollMods) {
      const chance = Math.min(0.4, 0.06 + this.floor * 0.004);
      if (rnd() < chance) mods.push(MODS[(rnd() * MODS.length) | 0]);
      if (mods[0] === 'elite' && rnd() < 0.4) {
        const extra = MODS[1 + ((rnd() * (MODS.length - 1)) | 0)];
        if (!mods.includes(extra)) mods.push(extra);
      }
    }
    const elite = mods.includes('elite');
    const hp = Math.round(def.hp * fs.hp * (elite ? 2.6 : 1));
    const m: Monster = {
      id: newEntityId(), def, name: def.name, x, y, r: def.radius + (elite ? 2 : 0), hp, maxHp: hp,
      dmg: def.dmg * fs.dmg * (elite ? 1.4 : 1), speed: def.speed * (mods.includes('fast') ? 1.5 : 1), ai: def.ai, range: def.range,
      atkCd: def.atkCd * (mods.includes('fast') ? 0.75 : 1), element: def.element as Element, xp: Math.round(def.xp * (1 + this.floor * 0.12) * (elite ? 3 : 1)),
      mods, nextAtk: 0, target: null, stunUntil: 0, slowUntil: 0, poison: null, tauntBy: null, tauntUntil: 0, state: 'idle', stateUntil: 0,
      dirX: 0, dirY: 0, armor: this.floor * 3 + (mods.includes('armored') ? 40 + this.floor * 8 : 0), projSpeed: (def as MonsterDef).projSpeed ?? 160,
      isAdd, wanderAt: 0, lastHitBy: null,
    };
    this.monsters.set(m.id, m);
    return m;
  }

  private spawnBoss() {
    const idx = (Math.floor(this.floor / 10) - 1) % bossesData.length;
    const def = bossesData[idx];
    const tier = Math.floor((this.floor - 1) / 100);
    const fs = floorScaling(this.floor);
    const b = this.map.boss!;
    const m = this.spawnMonster(def as unknown as MonsterDef, (b.x + 0.5) * TILE, (b.y + 0.5) * TILE, fs, false);
    m.name = `${tier > 0 ? 'Ascendido ' : ''}${def.name}, ${def.title}`;
    m.r = 14;
    m.maxHp = m.hp = Math.round(def.hp * fs.hp);
    m.dmg = def.dmg * fs.dmg;
    m.ai = 'boss';
    m.range = 20;
    m.atkCd = 1.2;
    m.xp = Math.round(400 * (1 + this.floor * 0.15));
    m.armor = this.floor * 5;
    m.boss = { phase: 0, nextAbility: 0, active: false, adds: 0 };
    this.bossName = m.name;
  }

  // ---------------- tick ----------------
  protected update(dt: number) {
    const t = this.time;
    if (this.descendAt && t >= this.descendAt) {
      this.loadFloor(this.floor + 1);
      return;
    }
    for (const p of this.players) this.updatePlayerDungeon(p, dt);
    for (const m of this.monsters.values()) this.updateMonster(m, dt);
    this.updateProjectiles(dt);
    this.updateTeles();
    this.updateMinions();
    this.updatePlayerTraps();
  }

  private updatePlayerDungeon(p: Player, dt: number) {
    const t = this.time;
    if (p.dead) {
      if (t - p.deadAt > 3) this.hub.sendToTown(p);
      return;
    }
    if (p.poison && p.poison.until > t) this.hurtPlayer(p, p.poison.dps * dt, 'shadow', null, false, true);
    // armadilhas do andar
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    this.map.objects.forEach((o, i) => {
      if (o.kind === 'trap' && o.x === tx && o.y === ty && t > this.trapCd[i]) {
        this.trapCd[i] = t + 2.5;
        this.emit(['ex', (o.x + 0.5) * TILE, (o.y + 0.5) * TILE, 12, 0]);
        this.hurtPlayer(p, p.stats.maxHp * 0.12 + this.floor * 2, 'physical', null, false, true);
      }
    });
    // coleta automática de loot (somente o dono)
    for (let i = this.loots.length - 1; i >= 0; i--) {
      const l = this.loots[i];
      if (l.owner !== p || dist(l.x, l.y, p.x, p.y) > 16) continue;
      if (l.item) {
        if (!addToInventory(p.char, l.item)) { if (this.tick % 40 === 0) p.toast('Inventário cheio!', 'error'); continue; }
        this.onItemAcquired(p, l.item);
      }
      if (l.gold) p.char.gold += l.gold;
      if (l.gems) p.char.gems += l.gems;
      this.loots.splice(i, 1);
      p.dirty = true;
      p.send({ t: 'pickup', gold: l.gold ?? 0, gems: l.gems ?? 0, item: l.item ? { name: l.item.name, rank: l.item.rank } : null });
      p.sendChar();
    }
    // efeitos únicos passivos
    const u = p.stats.uniques;
    if (u.includes('frostAura') && this.tick % TICK_RATE === 0) {
      for (const m of this.monsters.values()) if (dist(m.x, m.y, p.x, p.y) < 56) { m.slowUntil = t + 1.2; this.damageMonster(p, m, 0.25, 'ice', {}); }
    }
    if (u.includes('starfall') && t >= p.starfallAt) {
      p.starfallAt = t + 3;
      const target = this.nearestMonster(p.x, p.y, 180);
      if (target) this.teles.push({ at: t + 0.5, x: target.x, y: target.y, shape: 'c', r: 30, ang: 0, len: 0, wid: 0, owner: p, src: null, mult: 2.2, dmg: 0, element: 'holy' }),
        this.emit(['tg', target.x, target.y, 0, 30, 0, 0, 0, 500, 0]);
    }
  }

  // ---------------- IA dos monstros ----------------
  private pickTarget(m: Monster): Player | null {
    const t = this.time;
    if (m.tauntBy && m.tauntUntil > t && !m.tauntBy.dead && m.tauntBy.world === this) return m.tauntBy;
    let best: Player | null = null, bd = m.boss ? 400 : m.target ? 220 : 150;
    for (const p of this.players) {
      if (p.dead || p.stealthUntil > t) continue;
      const d = dist(p.x, p.y, m.x, m.y);
      if (d < bd && (m.boss || lineOfSight(this.grid, m.x, m.y, p.x, p.y))) { bd = d; best = p; }
    }
    return best;
  }

  private moveMonster(m: Monster, dx: number, dy: number, speed: number, dt: number) {
    const len = Math.hypot(dx, dy) || 1;
    const sp = speed * dt * (m.slowUntil > this.time ? 0.5 : 1);
    const r = moveWithCollision(this.grid, m.x, m.y, (dx / len) * sp, (dy / len) * sp, Math.min(m.r, 6));
    m.x = r.x; m.y = r.y;
  }

  private updateMonster(m: Monster, dt: number) {
    const t = this.time;
    if (m.poison && m.poison.until > t) {
      this.applyDamageToMonster(m, m.poison.dps * dt, 'shadow', false, m.poison.owner, true);
      if (m.dead) return;
    }
    if (m.stunUntil > t) return;
    if (m.boss) return this.updateBoss(m, dt);
    const tgt = (m.target = this.pickTarget(m));
    if (m.state === 'windup') {
      if (t >= m.stateUntil) {
        if (m.ai === 'charger') { m.state = 'dash'; m.stateUntil = t + 0.45; m.dashHit = new Set(); }
        else if (m.ai === 'exploder') { this.explode(m, 34, 1.8); return; }
      }
      return;
    }
    if (m.state === 'dash') {
      this.moveMonster(m, m.dirX, m.dirY, m.speed * 4.2, dt);
      for (const p of this.players) if (!p.dead && !m.dashHit!.has(p.eid) && dist(p.x, p.y, m.x, m.y) < m.r + 7) {
        m.dashHit!.add(p.eid);
        this.monsterHit(m, p, 1.4, true);
      }
      if (t >= m.stateUntil) { m.state = 'chase'; m.nextAtk = t + m.atkCd; }
      return;
    }
    if (!tgt) {
      if (t > m.wanderAt) { m.wanderAt = t + 1.5 + rnd() * 2; const a = rnd() * Math.PI * 2; m.dirX = Math.cos(a) * 0.3; m.dirY = Math.sin(a) * 0.3; if (rnd() < 0.5) m.dirX = m.dirY = 0; }
      if (m.dirX || m.dirY) this.moveMonster(m, m.dirX, m.dirY, m.speed * 0.35, dt);
      return;
    }
    const d = dist(tgt.x, tgt.y, m.x, m.y);
    const dx = tgt.x - m.x, dy = tgt.y - m.y;
    switch (m.ai) {
      case 'ranged':
      case 'caster': {
        const want = m.range * 0.65;
        if (d > m.range * 0.9 || !lineOfSight(this.grid, m.x, m.y, tgt.x, tgt.y)) this.moveMonster(m, dx, dy, m.speed, dt);
        else if (d < want * 0.6) this.moveMonster(m, -dx, -dy, m.speed * 0.7, dt);
        if (d <= m.range && t >= m.nextAtk && lineOfSight(this.grid, m.x, m.y, tgt.x, tgt.y)) {
          m.nextAtk = t + m.atkCd * (0.85 + rnd() * 0.3);
          if (m.ai === 'ranged') {
            const a = Math.atan2(dy, dx);
            this.addMonsterProj(m, a, m.projSpeed, 1);
          } else {
            this.teles.push({ at: t + 0.9, x: tgt.x, y: tgt.y, shape: 'c', r: 26, ang: 0, len: 0, wid: 0, owner: null, src: m, mult: 1.3, dmg: m.dmg, element: m.element });
            this.emit(['tg', tgt.x, tgt.y, 0, 26, 0, 0, 0, 900, 1]);
          }
        }
        break;
      }
      case 'charger':
        if (d < 120 && d > 30 && t >= m.nextAtk) {
          m.state = 'windup'; m.stateUntil = t + 0.55; m.dirX = dx / d; m.dirY = dy / d;
          this.emit(['tg', m.x, m.y, 1, 0, Math.atan2(dy, dx), m.speed * 4.2 * 0.45 + 10, m.r * 2, 550, 1]);
          break;
        }
      // fallthrough → corpo a corpo
      case 'exploder':
        if (m.ai === 'exploder' && d < 18) {
          m.state = 'windup'; m.stateUntil = t + 0.6;
          this.emit(['tg', m.x, m.y, 0, 34, 0, 0, 0, 600, 1]);
          break;
        }
      // fallthrough
      default:
        if (d > m.range + m.r) this.moveMonster(m, dx, dy, m.speed, dt);
        else if (t >= m.nextAtk) {
          m.nextAtk = t + m.atkCd;
          this.emit(['sw', m.x, m.y, Math.atan2(dy, dx), 1.4, m.range + m.r, 9]);
          this.monsterHit(m, tgt, 1, true);
        }
    }
  }

  private addMonsterProj(m: Monster, a: number, speed: number, mult: number, sprite = 'orb') {
    this.projs.push({
      id: newEntityId(), owner: null, src: m, x: m.x, y: m.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, left: 320, r: 4,
      element: m.element, mult, dmg: m.dmg, pierce: 0, hit: new Set(), aoe: 0, sprite,
    });
  }

  private explode(m: Monster, r: number, mult: number) {
    this.emit(['ex', m.x, m.y, r, ELEM_IDX(m.element)]);
    for (const p of this.players) if (!p.dead && dist(p.x, p.y, m.x, m.y) < r + 5) this.monsterHit(m, p, mult, false);
    this.killMonster(m, m.lastHitBy);
  }

  // ---------------- chefes ----------------
  private updateBoss(m: Monster, dt: number) {
    const t = this.time, b = m.boss!;
    const def = m.def as BossDef;
    const tgt = (m.target = this.pickTarget(m));
    if (!b.active) {
      if (!tgt) return;
      b.active = true;
      // HP escala com o número de jogadores presentes
      const n = [...this.players].filter((p) => !p.dead).length;
      m.maxHp = m.hp = Math.round(m.maxHp * (1 + 0.75 * (n - 1)));
      b.nextAbility = t + 1.5;
      this.emit(['ph', `${m.name} desperta!`]);
    }
    const pct = m.hp / m.maxHp;
    const phase = pct <= 0.2 ? 2 : pct <= 0.5 ? 1 : 0;
    if (phase > b.phase) {
      b.phase = phase;
      this.emit(['ph', phase === 1 ? `${def.name} enfurece!` : `${def.name} entra em desespero!`]);
      b.nextAbility = t + 0.8;
    }
    if (m.state === 'windup') {
      if (t >= m.stateUntil) { m.state = 'dash'; m.stateUntil = t + 0.5; m.dashHit = new Set(); }
      return;
    }
    if (m.state === 'dash') {
      this.moveMonster(m, m.dirX, m.dirY, 330, dt);
      for (const p of this.players) if (!p.dead && !m.dashHit!.has(p.eid) && dist(p.x, p.y, m.x, m.y) < m.r + 8) { m.dashHit!.add(p.eid); this.monsterHit(m, p, 1.6, true); }
      if (t >= m.stateUntil) m.state = 'chase';
      return;
    }
    if (!tgt) return;
    const d = dist(tgt.x, tgt.y, m.x, m.y);
    const spdMul = 1 + b.phase * 0.15;
    if (d > m.range + m.r) this.moveMonster(m, tgt.x - m.x, tgt.y - m.y, m.speed * spdMul, dt);
    else if (t >= m.nextAtk) {
      m.nextAtk = t + m.atkCd / spdMul;
      this.emit(['sw', m.x, m.y, Math.atan2(tgt.y - m.y, tgt.x - m.x), 2, m.range + m.r + 6, 9]);
      this.monsterHit(m, tgt, 1.2, true);
    }
    if (t >= b.nextAbility) {
      const list = def.phases[b.phase];
      this.bossAbility(m, list[(rnd() * list.length) | 0], tgt);
      b.nextAbility = t + (2.8 - b.phase * 0.5) * (0.85 + rnd() * 0.3);
    }
  }

  private bossAbility(m: Monster, ab: string, tgt: Player): void {
    const t = this.time, def = m.def as BossDef, phase = m.boss!.phase;
    const tele = (x: number, y: number, shape: 'c' | 'l', r: number, ang: number, len: number, wid: number, delay: number, mult: number) => {
      this.teles.push({ at: t + delay, x, y, shape, r, ang, len, wid, owner: null, src: m, mult, dmg: m.dmg, element: m.element });
      this.emit(['tg', x, y, shape === 'c' ? 0 : 1, r, ang, len, wid, Math.round(delay * 1000), 1]);
    };
    switch (ab) {
      case 'nova': {
        const n = 12 + phase * 4, off = rnd() * Math.PI;
        this.emit(['ex', m.x, m.y, 20, ELEM_IDX(m.element)]);
        for (let i = 0; i < n; i++) this.addMonsterProj(m, off + (i / n) * Math.PI * 2, 120 + phase * 20, 0.8, 'nova');
        break;
      }
      case 'circle': tele(m.x, m.y, 'c', 70 + phase * 10, 0, 0, 0, 1.1, 2); break;
      case 'line': {
        const a = Math.atan2(tgt.y - m.y, tgt.x - m.x);
        tele(m.x, m.y, 'l', 0, a, 300, 26, 0.9, 2.2);
        if (phase >= 2) { tele(m.x, m.y, 'l', 0, a + 0.6, 300, 22, 1.1, 1.8); tele(m.x, m.y, 'l', 0, a - 0.6, 300, 22, 1.1, 1.8); }
        break;
      }
      case 'meteor':
        for (const p of this.players) if (!p.dead) for (let i = 0; i < 1 + phase; i++)
          tele(p.x + (rnd() - 0.5) * 50 * i, p.y + (rnd() - 0.5) * 50 * i, 'c', 36, 0, 0, 0, 1.2 + i * 0.25, 2);
        break;
      case 'summon': {
        const alive = [...this.monsters.values()].filter((x) => x.isAdd).length;
        const add = MONSTER_BY_ID[def.summon];
        if (!add || alive >= 8) return this.bossAbility(m, 'circle', tgt);
        const fs = floorScaling(this.floor);
        for (let i = 0; i < 2 + phase; i++) {
          const a = rnd() * Math.PI * 2;
          const r = moveWithCollision(this.grid, m.x, m.y, Math.cos(a) * 40, Math.sin(a) * 40, 6);
          this.spawnMonster(add, r.x, r.y, { ...fs, hp: fs.hp * 0.6 }, false, true);
        }
        this.emit(['ex', m.x, m.y, 40, 4]);
        break;
      }
      case 'charge': {
        const d = dist(tgt.x, tgt.y, m.x, m.y) || 1;
        m.dirX = (tgt.x - m.x) / d; m.dirY = (tgt.y - m.y) / d;
        m.state = 'windup'; m.stateUntil = t + 0.7;
        this.emit(['tg', m.x, m.y, 1, 0, Math.atan2(m.dirY, m.dirX), 330 * 0.5 + 16, m.r * 2, 700, 1]);
        break;
      }
    }
  }

  // ---------------- dano ----------------
  private monsterHit(m: Monster, p: Player, mult: number, melee: boolean) {
    const r = computeDamage(
      { min: m.dmg * 0.85, max: m.dmg * 1.15, critChance: m.mods.includes('elite') ? 0.1 : 0.05, critMult: 1.5, element: m.element, multiplier: mult, elementBonus: 0, level: this.floor },
      { armor: p.stats.armor * (1 + p.buffSum('armorPct', this.time)), level: this.floor, res: p.stats.res },
      rnd,
    );
    const dealt = this.hurtPlayer(p, r.amount, r.element, m, r.crit, false);
    if (dealt <= 0) return;
    if (m.mods.includes('poison')) p.poison = { dps: m.dmg * 0.3, until: this.time + 3 };
    if (m.mods.includes('vampiric')) m.hp = Math.min(m.maxHp, m.hp + dealt * 0.5);
    if (melee && p.stats.uniques.includes('thorns')) this.applyDamageToMonster(m, dealt * 0.6, 'physical', false, p);
  }

  /** Aplica dano final a um jogador. Retorna o dano efetivo. */
  hurtPlayer(p: Player, amount: number, element: Element, src: Monster | null, crit: boolean, silent: boolean): number {
    if (p.dead) return 0;
    const t = this.time;
    if (!silent && p.stats.uniques.includes('windwalk') && rnd() < 0.15) { this.emit(['tx', p.x, p.y - 10, 'Esquiva']); return 0; }
    const dr = Math.min(0.8, p.buffSum('dr', t));
    const dmg = amount * (1 - dr);
    p.hp -= dmg;
    if (!silent || dmg >= 1) this.emit(['d', Math.round(p.x), Math.round(p.y - 8), Math.round(dmg), ELEM_IDX(element), crit ? 1 : 0, 1]);
    if (src) p.lastHitBy = src.name;
    if (p.hp <= 0) {
      if (p.stats.uniques.includes('phoenix') && !p.char.data.phoenixUsed) {
        p.char.data.phoenixUsed = true;
        p.hp = p.stats.maxHp * 0.5;
        this.emit(['ex', p.x, p.y, 40, 1]);
        p.toast('O Coração de Brasa Eterna te trouxe de volta!', 'good');
      } else {
        p.hp = 0;
        p.dead = true;
        p.deadAt = t;
        p.char.data.stats.deaths++;
        p.toast(`Você foi derrotado${p.lastHitBy ? ` por ${p.lastHitBy}` : ''}. Voltando à cidade...`, 'error');
        if ([...this.players].every((x) => x.dead)) this.descendAt = 0;
      }
    }
    return dmg;
  }

  private nearestMonster(x: number, y: number, maxD: number, exclude?: Set<number>): Monster | null {
    let best: Monster | null = null, bd = maxD;
    for (const m of this.monsters.values()) {
      if (exclude?.has(m.id)) continue;
      const d = dist(m.x, m.y, x, y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /** Dano de jogador (ou de suas invocações) contra monstro, usando a fórmula compartilhada. */
  damageMonster(p: Player, m: Monster, mult: number, element: Element, o: DmgOpts) {
    if (m.dead) return 0;
    const t = this.time, s = p.stats;
    const skillBonus = o.skillId ? (this.talentSkillBonus(p, o.skillId)) : 0;
    const forceCrit = o.crit || p.nextCrit;
    const r = computeDamage(
      {
        min: s.minDmg, max: s.maxDmg, critChance: forceCrit ? 1 : s.crit, critMult: s.critMult, element, elementBonus: s.elemBonus[element],
        multiplier: mult * (1 + skillBonus) * (1 + s.dmgPct + p.buffSum('dmgPct', t)), level: p.char.level,
        executeBonus: s.uniques.includes('executioner') && m.hp < m.maxHp * 0.25 ? 1 : 0,
      },
      { armor: m.armor, level: p.char.level, res: { [m.element]: m.element === 'physical' ? 0 : 0.25 } },
      rnd,
    );
    if (p.nextCrit) { p.nextCrit = false; p.stealthUntil = 0; }
    if (o.stun) m.stunUntil = Math.max(m.stunUntil, t + o.stun * (m.boss ? 0.3 : 1));
    if (o.slow) m.slowUntil = t + o.slow;
    if (o.poison) m.poison = { dps: ((s.minDmg + s.maxDmg) / 2) * o.poison * (1 + s.dmgPct), until: t + (o.poisonDur ?? 3), owner: p };
    const dealt = this.applyDamageToMonster(m, r.amount, element, r.crit, p);
    const heal = dealt * (s.lifesteal + (o.drain ?? 0));
    if (heal > 0 && !p.dead) p.hp = Math.min(s.maxHp, p.hp + heal);
    if (!o.noProc && s.uniques.includes('chainLightning') && rnd() < 0.25) {
      const hit = new Set([m.id]);
      let from: { x: number; y: number } = m;
      for (let i = 0; i < 3; i++) {
        const n = this.nearestMonster(from.x, from.y, 90, hit);
        if (!n) break;
        hit.add(n.id);
        this.emit(['ch', from.x, from.y, n.x, n.y]);
        this.damageMonster(p, n, 0.6, 'lightning', { noProc: true });
        from = n;
      }
    }
    return dealt;
  }

  private talentSkillBonus(p: Player, skillId: string) {
    let b = 0;
    for (const t of p.cls.talents) if (t.skill === skillId) b += t.per * Math.min(t.max, p.char.data.talents[t.id] ?? 0);
    return b;
  }

  private applyDamageToMonster(m: Monster, amount: number, element: Element, crit: boolean, p: Player | null, silent = false): number {
    if (m.dead) return 0;
    const dmg = m.mods.includes('armored') && element === 'physical' ? amount * 0.75 : amount;
    m.hp -= dmg;
    if (p) m.lastHitBy = p;
    if (!m.target && p) m.target = p;
    if (!silent || dmg >= 1) this.emit(['d', Math.round(m.x), Math.round(m.y - m.r - 4), Math.round(dmg), ELEM_IDX(element), crit ? 1 : 0, 0]);
    if (m.hp <= 0) {
      if (m.mods.includes('explosive') && !m.dead) {
        m.mods = m.mods.filter((x) => x !== 'explosive');
        m.hp = 1;
        m.state = 'windup'; m.ai = 'exploder'; m.stateUntil = this.time + 0.6; m.stunUntil = 0;
        this.emit(['tg', m.x, m.y, 0, 40, 0, 0, 0, 600, 1]);
      } else this.killMonster(m, p);
    }
    return dmg;
  }

  private killMonster(m: Monster, killer: Player | null) {
    if (m.dead) return;
    m.dead = true;
    this.monsters.delete(m.id);
    this.emit(['k', m.x, m.y, m.r]);
    const alive = [...this.players].filter((p) => !p.dead && dist(p.x, p.y, m.x, m.y) < 700);
    if (killer && !alive.includes(killer) && !killer.dead && killer.world === this) alive.push(killer);
    for (const p of alive) {
      const c = p.char;
      ensureDaily(c);
      c.data.stats.kills++;
      c.data.daily.kills++;
      if (m.boss) c.data.stats.bossKills++;
      const before = c.level;
      const ups = grantXp(c, m.xp * (m.isAdd ? 0.3 : 1));
      if (ups) {
        p.skills.forEach((sk, i) => {
          if (before < SKILL_UNLOCK_LEVELS[i] && c.level >= SKILL_UNLOCK_LEVELS[i]) p.toast(`Nova habilidade: ${sk.name}!`, 'good');
        });
        p.recompute();
        p.hp = p.stats.maxHp; p.mana = p.stats.maxMana;
        this.emit(['lv', p.x, p.y]);
        p.toast(`Nível ${c.level}! +${ups} ponto(s) de talento.`, 'good');
      }
      if (p === killer && p.stats.uniques.includes('soulHarvest')) {
        p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * 0.08);
        p.mana = Math.min(p.stats.maxMana, p.mana + p.stats.maxMana * 0.1);
      }
      if (!m.isAdd || rnd() < 0.3) {
        const loot = rollMonsterLoot(rnd, { floor: this.floor, boss: !!m.boss, elite: m.mods.includes('elite'), magicFind: p.stats.magicFind, goldFind: p.stats.goldFind });
        this.dropLoot(p, m.x, m.y, loot.gold, loot.items, loot.gems);
      }
      this.hub.onAchievements(p);
      p.dirty = true;
    }
    if (m.boss) {
      this.stairsOpen = true;
      for (const p of this.players) p.send({ t: 'obj', stairs: true });
      this.emit(['ph', `${m.name} foi derrotado!`]);
      const names = alive.map((p) => p.name).join(', ');
      this.hub.announce(`⚔ ${names || 'Aventureiros'} derrotaram ${m.name} no andar ${this.floor}!`, 'boss');
      for (const x of [...this.monsters.values()]) if (x.isAdd) this.killMonster(x, null);
    }
  }

  private dropLoot(p: Player, x: number, y: number, gold: number, items: Item[], gems: number) {
    const spread = () => (rnd() - 0.5) * 22;
    if (gold > 0) this.loots.push({ id: newEntityId(), owner: p, x: x + spread(), y: y + spread(), gold });
    if (gems > 0) this.loots.push({ id: newEntityId(), owner: p, x: x + spread(), y: y + spread(), gems });
    for (const it of items) {
      this.loots.push({ id: newEntityId(), owner: p, x: x + spread(), y: y + spread(), item: it });
      const ri = RANKS.indexOf(it.rank);
      if (ri >= 5) p.send({ t: 'fx', fx: [['rr', x, y, ri]] });
    }
  }

  private onItemAcquired(p: Player, it: Item) {
    const ri = RANKS.indexOf(it.rank);
    const st = p.char.data.stats;
    if (ri > st.bestRank) { st.bestRank = ri; st.bestItem = `${it.name} [${it.rank}]`; }
    if (it.rank === 'SSS') this.hub.announce(`✦ ${p.name} encontrou o item lendário ${it.name} [SSS] no andar ${this.floor}!`, 'sss');
    else if (it.rank === 'SS') this.hub.announce(`${p.name} encontrou ${it.name} [SS] no andar ${this.floor}.`, 'rare');
  }

  // ---------------- projéteis, telegrafias, invocações ----------------
  private updateProjectiles(dt: number) {
    const keep: Proj[] = [];
    for (const pr of this.projs) {
      let alive = true;
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 6));
      for (let s = 0; s < steps && alive; s++) {
        pr.x += (pr.vx * dt) / steps;
        pr.y += (pr.vy * dt) / steps;
        pr.left -= (Math.hypot(pr.vx, pr.vy) * dt) / steps;
        const tx = Math.floor(pr.x / TILE), ty = Math.floor(pr.y / TILE);
        const tile = this.map.tiles[ty * this.map.w + tx];
        if (tile !== T_FLOOR) {
          if (tile === T_SECRET && pr.owner) this.revealSecret(tx, ty);
          if (pr.aoe && pr.owner) this.aoeFromPlayer(pr.owner, pr.x, pr.y, pr.aoe, pr.mult, pr.element, { skillId: pr.skillId });
          alive = false; break;
        }
        if (pr.left <= 0) { if (pr.aoe && pr.owner) this.aoeFromPlayer(pr.owner, pr.x, pr.y, pr.aoe, pr.mult, pr.element, { skillId: pr.skillId }); alive = false; break; }
        if (pr.owner) {
          for (const m of this.monsters.values()) {
            if (pr.hit.has(m.id) || dist(m.x, m.y, pr.x, pr.y) > m.r + pr.r) continue;
            pr.hit.add(m.id);
            if (pr.aoe) { this.aoeFromPlayer(pr.owner, pr.x, pr.y, pr.aoe, pr.mult, pr.element, { skillId: pr.skillId }); alive = false; break; }
            this.damageMonster(pr.owner, m, pr.mult, pr.element, { skillId: pr.skillId, poison: pr.poison, poisonDur: pr.poisonDur });
            if (pr.pierce-- <= 0) { alive = false; break; }
          }
        } else if (pr.src) {
          for (const p of this.players) {
            if (p.dead || dist(p.x, p.y, pr.x, pr.y) > 6 + pr.r) continue;
            this.monsterHit(pr.src, p, pr.mult, false);
            alive = false; break;
          }
        }
      }
      if (alive) keep.push(pr);
    }
    this.projs = keep;
  }

  private aoeFromPlayer(p: Player, x: number, y: number, r: number, mult: number, element: Element, o: DmgOpts) {
    this.emit(['ex', x, y, r, ELEM_IDX(element)]);
    let total = 0;
    for (const m of [...this.monsters.values()]) if (dist(m.x, m.y, x, y) <= r + m.r) total += this.damageMonster(p, m, mult, element, o);
    return total;
  }

  private updateTeles() {
    const t = this.time;
    const keep: Tele[] = [];
    for (const tl of this.teles) {
      if (t < tl.at) { keep.push(tl); continue; }
      const inShape = (x: number, y: number, rad: number) => {
        if (tl.shape === 'c') return dist(x, y, tl.x, tl.y) <= tl.r + rad;
        const dx = x - tl.x, dy = y - tl.y;
        const along = dx * Math.cos(tl.ang) + dy * Math.sin(tl.ang);
        const perp = Math.abs(-dx * Math.sin(tl.ang) + dy * Math.cos(tl.ang));
        return along >= -rad && along <= tl.len + rad && perp <= tl.wid / 2 + rad;
      };
      if (tl.shape === 'c') this.emit(['ex', tl.x, tl.y, tl.r, ELEM_IDX(tl.element)]);
      else this.emit(['bm', tl.x, tl.y, tl.ang, tl.len, tl.wid, ELEM_IDX(tl.element)]);
      if (tl.owner) {
        const p = tl.owner;
        if (p.world !== this) continue;
        for (const m of [...this.monsters.values()]) if (inShape(m.x, m.y, m.r))
          this.damageMonster(p, m, tl.mult, tl.element, { skillId: tl.skillId, stun: tl.stun, drain: tl.drain });
      } else if (tl.src) {
        for (const p of this.players) if (!p.dead && inShape(p.x, p.y, 5)) this.monsterHit(tl.src, p, tl.mult, false);
      }
    }
    this.teles = keep;
  }

  private updateMinions() {
    const t = this.time;
    this.minions = this.minions.filter((mi) => mi.until > t && mi.owner.world === this && !mi.owner.dead);
    for (const mi of this.minions) {
      const target = this.nearestMonster(mi.x, mi.y, 170);
      let gx = mi.owner.x + 18, gy = mi.owner.y + 10;
      if (target) { gx = target.x; gy = target.y; }
      const d = dist(gx, gy, mi.x, mi.y);
      if (d > (target ? target.r + 8 : 24)) {
        const sp = 95 / TICK_RATE;
        const r = moveWithCollision(this.grid, mi.x, mi.y, ((gx - mi.x) / d) * sp, ((gy - mi.y) / d) * sp, 5);
        mi.x = r.x; mi.y = r.y;
      } else if (target && t >= mi.nextAtk) {
        mi.nextAtk = t + 1;
        this.emit(['sw', mi.x, mi.y, Math.atan2(target.y - mi.y, target.x - mi.x), 1.2, 16, 4]);
        this.damageMonster(mi.owner, target, mi.mult, 'shadow', { skillId: 'raise', noProc: true });
      }
    }
  }

  private updatePlayerTraps() {
    const t = this.time;
    this.ptraps = this.ptraps.filter((tr) => {
      if (tr.until < t || tr.owner.world !== this) return false;
      for (const m of this.monsters.values()) if (dist(m.x, m.y, tr.x, tr.y) < 14 + m.r) {
        this.aoeFromPlayer(tr.owner, tr.x, tr.y, tr.r, tr.mult, tr.element, { skillId: tr.skillId });
        return false;
      }
      return true;
    });
  }

  private revealSecret(tx: number, ty: number) {
    if (this.map.tiles[ty * this.map.w + tx] !== T_SECRET) return;
    this.map.tiles[ty * this.map.w + tx] = T_FLOOR;
    for (const p of this.players) { p.send({ t: 'tile', x: tx, y: ty, v: T_FLOOR }); p.toast('Uma passagem secreta se abriu!', 'good'); }
    this.emit(['ex', (tx + 0.5) * TILE, (ty + 0.5) * TILE, 16, 0]);
  }

  private revealNearbySecrets(p: Player, r: number) {
    const x0 = Math.floor((p.x - r) / TILE), x1 = Math.floor((p.x + r) / TILE);
    const y0 = Math.floor((p.y - r) / TILE), y1 = Math.floor((p.y + r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if (this.map.tiles[y * this.map.w + x] === T_SECRET) this.revealSecret(x, y);
  }

  // ---------------- ações do jogador ----------------
  basicAttack(p: Player, a: number) {
    const t = this.time;
    if (p.dead || p.stunUntil > t || t < p.atkReady || !Number.isFinite(a)) return;
    const s = p.stats;
    p.atkReady = t + 1 / (s.atkSpd * (1 + p.buffSum('atkSpd', t)));
    const times = s.uniques.includes('doubleStrike') ? 2 : 1;
    const w = s.weapon;
    for (let i = 0; i < times; i++) {
      if (w.attack === 'melee') {
        this.emit(['sw', p.x, p.y, a, w.arc, w.range, ELEM_IDX(w.element)]);
        for (const m of [...this.monsters.values()]) {
          const d = dist(m.x, m.y, p.x, p.y);
          if (d <= w.range + m.r + 4 && (d < m.r + 4 || angDiff(Math.atan2(m.y - p.y, m.x - p.x), a) <= w.arc / 2))
            this.damageMonster(p, m, 1, w.element, {});
        }
      } else {
        const sp = w.projSpeed;
        const aa = a + (i ? 0.08 : 0);
        this.projs.push({ id: newEntityId(), owner: p, src: null, x: p.x, y: p.y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, left: w.range, r: 4, element: w.element, mult: 1, dmg: 0, pierce: 0, hit: new Set(), aoe: 0, sprite: w.attack === 'magic' ? 'orb' : 'arrow' });
      }
    }
    this.revealNearbySecrets(p, 26);
  }

  useSkill(p: Player, idx: number, a: number, tx: number, ty: number) {
    const t = this.time;
    const sk = p.skills[idx] as SkillDef | undefined;
    if (!sk || p.dead || p.stunUntil > t || !Number.isFinite(a)) return;
    if (!skillUnlocked(p.char.level, idx)) { p.toast(`${sk.name} é liberada no nível ${SKILL_UNLOCK_LEVELS[idx]}.`, 'error'); return; }
    if ((p.cds[sk.id] ?? 0) > t) return;
    if (p.mana < sk.mana) { p.toast('Mana insuficiente.', 'error'); return; }
    p.mana -= sk.mana;
    const cd = sk.cd * (1 - p.stats.cdr);
    p.cds[sk.id] = t + cd;
    p.send({ t: 'cd', id: sk.id, ms: Math.round(cd * 1000) });
    if (p.stealthUntil > t && sk.type !== 'stealth') p.stealthUntil = 0;
    const el = (sk.element ?? 'physical') as Element;
    const mult = sk.mult ?? 1;
    const o = { skillId: sk.id, stun: sk.stun, slow: sk.slowDur ? sk.slowDur : undefined, poison: sk.poison, poisonDur: sk.poisonDur, crit: sk.guaranteedCrit, drain: sk.drain };
    const applyBuff = (target: Player) => sk.buff && target.buffs.push({ stats: sk.buff, until: t + (sk.duration ?? 5), source: sk.id });
    const allies = () => [...this.players].filter((x) => !x.dead && dist(x.x, x.y, p.x, p.y) <= (sk.radius ?? 200));
    p.buffs = p.buffs.filter((b) => b.until > t);

    switch (sk.type) {
      case 'aoe_self':
        if (mult > 0) this.aoeFromPlayer(p, p.x, p.y, sk.radius ?? 40, mult, el, o);
        else this.emit(['ex', p.x, p.y, sk.radius ?? 40, 0]);
        if (sk.taunt) for (const m of this.monsters.values()) if (dist(m.x, m.y, p.x, p.y) < (sk.radius ?? 100)) { m.tauntBy = p; m.tauntUntil = t + 4; m.target = p; }
        applyBuff(p);
        break;
      case 'arc':
        this.emit(['sw', p.x, p.y, a, sk.arc ?? 1.6, sk.radius ?? 26, ELEM_IDX(el)]);
        for (const m of [...this.monsters.values()]) {
          const d = dist(m.x, m.y, p.x, p.y);
          if (d <= (sk.radius ?? 26) + m.r + 4 && (d < m.r + 4 || angDiff(Math.atan2(m.y - p.y, m.x - p.x), a) <= (sk.arc ?? 1.6) / 2)) this.damageMonster(p, m, mult, el, o);
        }
        break;
      case 'dash': {
        const fx = p.x, fy = p.y;
        const r = moveWithCollision(this.grid, p.x, p.y, Math.cos(a) * (sk.dist ?? 80), Math.sin(a) * (sk.dist ?? 80), 5);
        p.x = r.x; p.y = r.y;
        p.inputs = [];
        this.emit(['da', fx, fy, p.x, p.y, ELEM_IDX(el)]);
        if (mult > 0) {
          // atinge inimigos ao longo do caminho
          const len = dist(fx, fy, p.x, p.y) || 1, ux = (p.x - fx) / len, uy = (p.y - fy) / len;
          for (const m of [...this.monsters.values()]) {
            const dx = m.x - fx, dy = m.y - fy, along = dx * ux + dy * uy;
            const perp = Math.abs(-dx * uy + dy * ux);
            if (along >= -8 && along <= len + 8 && perp <= (sk.radius ?? 20) + m.r) this.damageMonster(p, m, mult, el, o);
          }
        }
        p.send({ t: 'pos', x: p.x, y: p.y, seq: p.lastSeq });
        break;
      }
      case 'projectile': {
        const n = sk.count ?? 1, spread = sk.spread ?? 0;
        for (let i = 0; i < n; i++) {
          const aa = n === 1 ? a : spread >= 6 ? a + (i / n) * Math.PI * 2 : a - spread / 2 + (spread * i) / (n - 1);
          const sp = sk.speed ?? 250;
          this.projs.push({
            id: newEntityId(), owner: p, src: null, x: p.x, y: p.y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, left: sk.range ?? 200, r: 5,
            element: el, mult, dmg: 0, pierce: sk.pierce ?? 0, hit: new Set(), aoe: sk.radius ?? 0, sprite: el === 'physical' ? 'arrow' : 'orb',
            poison: sk.poison, poisonDur: sk.poisonDur, skillId: sk.id,
          });
        }
        break;
      }
      case 'aoe_target': {
        let dx = tx - p.x, dy = ty - p.y;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) { dx = Math.cos(a) * 80; dy = Math.sin(a) * 80; }
        const d = Math.hypot(dx, dy), max = sk.range ?? 180;
        if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
        const x = p.x + dx, y = p.y + dy;
        const delay = sk.delay ?? 0.4;
        this.teles.push({ at: t + delay, x, y, shape: 'c', r: sk.radius ?? 40, ang: 0, len: 0, wid: 0, owner: p, src: null, mult, dmg: 0, element: el, stun: sk.stun, drain: sk.drain, skillId: sk.id });
        this.emit(['tg', x, y, 0, sk.radius ?? 40, 0, 0, 0, Math.round(delay * 1000), 0]);
        break;
      }
      case 'buff':
        if (sk.party) allies().forEach(applyBuff); else applyBuff(p);
        this.emit(['ex', p.x, p.y, sk.radius ?? 30, 5]);
        break;
      case 'heal':
        for (const al of allies()) {
          const amt = al.stats.maxHp * (sk.heal ?? 0.3);
          al.hp = Math.min(al.stats.maxHp, al.hp + amt);
          this.emit(['h', al.x, al.y, Math.round(amt)]);
          applyBuff(al);
        }
        break;
      case 'summon': {
        const cap = sk.id === 'army' ? 12 : 6;
        for (let i = 0; i < (sk.count ?? 2); i++) {
          const mine = this.minions.filter((m) => m.owner === p);
          if (mine.length >= cap) this.minions.splice(this.minions.indexOf(mine[0]), 1);
          const ang = rnd() * Math.PI * 2;
          const r = moveWithCollision(this.grid, p.x, p.y, Math.cos(ang) * 20, Math.sin(ang) * 20, 5);
          this.minions.push({ id: newEntityId(), owner: p, x: r.x, y: r.y, until: t + (sk.duration ?? 20), nextAtk: t + 0.5, mult: (sk.mult ?? 0.5) });
        }
        this.emit(['ex', p.x, p.y, 30, 4]);
        break;
      }
      case 'trap':
        this.ptraps.push({ id: newEntityId(), owner: p, x: p.x, y: p.y, until: t + (sk.duration ?? 20), mult, r: sk.radius ?? 40, skillId: sk.id, element: el });
        p.send({ t: 'fx', fx: [['tx', p.x, p.y - 12, 'Armadilha armada']] });
        break;
      case 'stealth':
        p.stealthUntil = t + (sk.duration ?? 4);
        p.nextCrit = true;
        for (const m of this.monsters.values()) if (m.target === p) m.target = null;
        break;
    }
    this.revealNearbySecrets(p, 30);
  }

  interact(p: Player) {
    if (p.dead) return;
    const t = this.time;
    // escada
    const s = this.map.stairs;
    if (dist((s.x + 0.5) * TILE, (s.y + 0.5) * TILE, p.x, p.y) < 26) {
      if (!this.stairsOpen) return p.toast('Derrote o chefe para liberar a escada.', 'error');
      if (!this.descendAt) {
        this.descendAt = t + 3;
        this.emit(['ph', `${p.name} encontrou a escada. Descendo em 3 s...`]);
      }
      return;
    }
    // baús
    this.map.objects.forEach((o, i) => {
      if ((o.kind !== 'chest' && o.kind !== 'secretChest') || this.chestsOpen[i]) return;
      if (dist((o.x + 0.5) * TILE, (o.y + 0.5) * TILE, p.x, p.y) > 26) return;
      this.chestsOpen[i] = true;
      for (const pl of this.players) {
        pl.send({ t: 'obj', i, open: true });
        if (pl.dead) continue;
        const loot = rollChestLoot(rnd, this.floor, o.kind === 'secretChest', pl.stats.magicFind, pl.stats.goldFind);
        if (pl.stats.uniques.includes('goldenTouch')) loot.gold *= 2;
        this.dropLoot(pl, (o.x + 0.5) * TILE, (o.y + 0.5) * TILE + 10, loot.gold, loot.items, loot.gems);
        ensureDaily(pl.char);
        pl.char.data.stats.chestsOpened++;
        pl.char.data.daily.chests++;
      }
      this.emit(['ex', (o.x + 0.5) * TILE, (o.y + 0.5) * TILE, 18, 5]);
    });
  }

  // ---------------- snapshot ----------------
  protected extraEntities(p: Player, out: unknown[]) {
    const r = INTEREST, t = this.time;
    const near = (x: number, y: number) => Math.abs(x - p.x) < r && Math.abs(y - p.y) < r;
    for (const m of this.monsters.values()) {
      if (!near(m.x, m.y)) continue;
      let f = 0;
      if (m.stunUntil > t) f |= F_STUN;
      if (m.slowUntil > t) f |= F_SLOW;
      if (m.poison && m.poison.until > t) f |= F_POISON;
      if (m.mods.includes('elite')) f |= F_ELITE;
      if (m.state === 'windup' || m.state === 'dash') f |= F_WINDUP;
      const row: unknown[] = [m.id, m.boss ? K_BOSS : K_MONSTER, Math.round(m.x * 10), Math.round(m.y * 10), Math.max(1, Math.round((m.hp / m.maxHp) * 100)), f];
      if (this.isNew(p, m.id)) row.push({ d: m.def.id, n: m.name, m: m.mods, r: m.r, hp: m.boss ? m.maxHp : undefined });
      else if (m.boss) row.push({ hp: m.maxHp, cur: Math.round(m.hp) });
      out.push(row);
    }
    for (const pr of this.projs) {
      if (!near(pr.x, pr.y)) continue;
      const row: unknown[] = [pr.id, K_PROJ, Math.round(pr.x * 10), Math.round(pr.y * 10), 0, 0];
      if (this.isNew(p, pr.id)) row.push({ s: pr.sprite, e: ELEM_IDX(pr.element), a: Math.round(Math.atan2(pr.vy, pr.vx) * 100) / 100, h: pr.owner ? 0 : 1 });
      out.push(row);
    }
    for (const mi of this.minions) {
      if (!near(mi.x, mi.y)) continue;
      const row: unknown[] = [mi.id, K_MINION, Math.round(mi.x * 10), Math.round(mi.y * 10), 100, 0];
      if (this.isNew(p, mi.id)) row.push({ o: mi.owner.eid });
      out.push(row);
    }
    for (const l of this.loots) {
      if (l.owner !== p) continue;
      const row: unknown[] = [l.id, K_LOOT, Math.round(l.x * 10), Math.round(l.y * 10), 0, 0];
      if (this.isNew(p, l.id)) row.push(l.item ? { r: RANKS.indexOf(l.item.rank), n: l.item.name, k: l.item.slotType } : l.gems ? { gem: l.gems } : { g: l.gold });
      out.push(row);
    }
    for (const tr of this.ptraps) {
      if (tr.owner !== p) continue;
      out.push([tr.id, K_LOOT, Math.round(tr.x * 10), Math.round(tr.y * 10), 0, 0, ...(this.isNew(p, tr.id) ? [{ trap: 1 }] : [])]);
    }
  }

  playerCanLeave(p: Player) { return !p.dead; }
}
