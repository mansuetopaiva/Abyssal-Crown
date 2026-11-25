import type { WebSocket } from 'ws';
import { computeStats, CLASS_BY_ID, allSkills } from '../../shared/stats';
import type { Character, Stats } from '../../shared/types';
import type { World } from './world';
import type { Party } from './party';
import { sortInventory } from './inventory';

let nextEntityId = 1;
export const newEntityId = () => nextEntityId++;

export interface Buff { stats: Record<string, number>; until: number; source: string }

export class Player {
  readonly eid = newEntityId();
  x = 0;
  y = 0;
  hp = 1;
  mana = 1;
  stats!: Stats;
  world: World | null = null;
  party: Party | null = null;
  inputs: { seq: number; dx: number; dy: number }[] = [];
  inputTokens = 4;
  lastSeq = 0;
  cds: Record<string, number> = {}; // id -> tempo do mundo (s) em que fica pronto
  atkReady = 0;
  buffs: Buff[] = [];
  dead = false;
  deadAt = 0;
  stealthUntil = 0;
  nextCrit = false;
  stunUntil = 0;
  slowUntil = 0;
  poison: { dps: number; until: number } | null = null;
  potionReady = 0;
  known = new Set<number>();
  dirty = false;
  lastSave = Date.now();
  msgTokens = 40;
  lastChat = 0;
  starfallAt = 0;
  lastHitBy = '';

  constructor(public ws: WebSocket, public char: Character, public userId: number) {
    this.recompute();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  get name() { return this.char.name; }
  get cls() { return CLASS_BY_ID[this.char.classId]; }
  get skills() { return allSkills(this.cls); }

  recompute() {
    const prevMax = this.stats?.maxHp;
    this.stats = computeStats(this.char);
    if (prevMax) {
      this.hp = Math.min(this.hp, this.stats.maxHp);
      this.mana = Math.min(this.mana, this.stats.maxMana);
    }
  }

  buffSum(key: string, now: number): number {
    let s = 0;
    for (const b of this.buffs) if (b.until > now) s += b.stats[key] ?? 0;
    return s;
  }

  moveSpeed(now: number) {
    const slow = this.slowUntil > now ? 0.6 : 1;
    return this.stats.moveSpeed * (1 + this.buffSum('moveSpd', now)) * slow;
  }

  send(msg: unknown) {
    if (this.ws.readyState !== 1) return;
    // não deixa a fila de saída crescer sem limite (cliente lento)
    if (this.ws.bufferedAmount > 2_000_000) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** Atualização completa do personagem (inventário, equipamentos etc.). */
  sendChar() {
    const c = this.char;
    sortInventory(c); // inventário sempre ordenado por rank
    this.send({ t: 'char', char: { id: c.id, name: c.name, classId: c.classId, level: c.level, xp: c.xp, gold: c.gold, gems: c.gems, maxFloor: c.maxFloor, checkpoint: c.checkpoint, data: c.data }, stats: this.stats });
  }

  toast(text: string, kind: 'info' | 'error' | 'good' = 'info') {
    this.send({ t: 'toast', text, kind });
  }
}
