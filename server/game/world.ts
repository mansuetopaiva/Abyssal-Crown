import { TICK_RATE, TILE } from '../../shared/constants';
import { encodeTiles } from '../../shared/dungeon';
import { moveWithCollision, normalizeDir, type Grid } from '../../shared/movement';
import { buildTown } from '../../shared/town';
import type { Player } from './player';
import { RANKS } from '../../shared/constants';

export const K_PLAYER = 0, K_MONSTER = 1, K_PROJ = 2, K_MINION = 3, K_LOOT = 4, K_BOSS = 5;
export const F_DEAD = 1, F_STEALTH = 2, F_STUN = 4, F_SLOW = 8, F_POISON = 16, F_ELITE = 32, F_BUFF = 64, F_WINDUP = 128;

export interface HubApi {
  announce(text: string, kind?: string): void;
  sendToTown(p: Player): void;
  save(p: Player): void;
  onAchievements(p: Player): void;
}

export type FxEvent = (string | number)[];
export const INTEREST = 440;

export abstract class World {
  time = 0;
  tick = 0;
  floor = 0;
  players = new Set<Player>();
  fx: FxEvent[] = [];
  abstract kind: 'town' | 'dungeon';
  abstract grid: Grid;
  constructor(public hub: HubApi) {}

  abstract mapMessage(p: Player): Record<string, unknown>;
  protected abstract update(dt: number): void;
  protected abstract extraEntities(p: Player, out: unknown[]): void;

  add(p: Player, x: number, y: number) {
    p.world?.remove(p);
    p.world = this;
    p.x = x; p.y = y;
    p.inputs = [];
    p.known.clear();
    this.players.add(p);
    p.send({ t: 'map', ...this.mapMessage(p), x: p.x, y: p.y });
    p.party?.broadcast();
  }

  remove(p: Player) {
    this.players.delete(p);
    if (p.world === this) p.world = null;
  }

  emit(e: FxEvent) { this.fx.push(e); }

  step(dt: number) {
    this.time += dt;
    this.tick++;
    for (const p of this.players) this.stepPlayer(p, dt);
    this.update(dt);
    this.broadcast();
    this.fx.length = 0;
  }

  protected stepPlayer(p: Player, dt: number) {
    // token bucket: no máximo ~1 input por tick no longo prazo (anti speed-hack)
    p.inputTokens = Math.min(4, p.inputTokens + 1);
    if (p.inputs.length > 10) p.inputs.splice(0, p.inputs.length - 10);
    const stunned = p.stunUntil > this.time;
    while (p.inputs.length && p.inputTokens >= 1) {
      const inp = p.inputs.shift()!;
      p.inputTokens--;
      p.lastSeq = inp.seq;
      if (p.dead || stunned) continue;
      const [dx, dy] = normalizeDir(inp.dx, inp.dy);
      const sp = p.moveSpeed(this.time) / TICK_RATE;
      const r = moveWithCollision(this.grid, p.x, p.y, dx * sp, dy * sp, 5);
      p.x = r.x; p.y = r.y;
    }
    if (!p.dead) {
      p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.hpRegen * dt * (this.kind === 'town' ? 5 : 1));
      p.mana = Math.min(p.stats.maxMana, p.mana + p.stats.manaRegen * dt * (this.kind === 'town' ? 5 : 1));
    }
  }

  protected playerFlags(p: Player) {
    let f = 0;
    if (p.dead) f |= F_DEAD;
    if (p.stealthUntil > this.time) f |= F_STEALTH;
    if (p.stunUntil > this.time) f |= F_STUN;
    if (p.slowUntil > this.time) f |= F_SLOW;
    if (p.poison && p.poison.until > this.time) f |= F_POISON;
    if (p.buffs.some((b) => b.until > this.time)) f |= F_BUFF;
    // bits 8..13: direção da mira em 64 passos
    const a = ((p.aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    f |= (Math.round((a / (Math.PI * 2)) * 64) & 63) << 8;
    return f;
  }

  protected broadcast() {
    const r2 = INTEREST * INTEREST;
    for (const p of this.players) {
      const e: unknown[] = [];
      const seen = new Set<number>();
      for (const o of this.players) {
        const dx = o.x - p.x, dy = o.y - p.y;
        if (o !== p && dx * dx + dy * dy > r2) continue;
        seen.add(o.eid);
        const row: unknown[] = [o.eid, K_PLAYER, Math.round(o.x * 10), Math.round(o.y * 10), Math.round((o.hp / o.stats.maxHp) * 100), this.playerFlags(o)];
        if (!p.known.has(o.eid)) { const w = o.char.data.equipment.weapon; row.push({ n: o.name, c: o.char.classId, l: o.char.level, cos: o.char.data.cosmetic, w: w?.baseType, wr: w ? RANKS.indexOf(w.rank) : 0, o: o.char.data.equipment.offhand?.baseType }); }
        e.push(row);
      }
      this.extraEntities(p, e);
      for (const row of e) seen.add((row as number[])[0]);
      p.known = seen;
      const fx = this.fx.filter((f) => typeof f[1] !== 'number' || typeof f[2] !== 'number' || Math.abs((f[1] as number) - p.x) < INTEREST + 60 && Math.abs((f[2] as number) - p.y) < INTEREST + 60);
      p.send({
        t: 's', tk: this.tick,
        me: [Math.round(p.hp), p.stats.maxHp, Math.round(p.mana), p.stats.maxMana, p.lastSeq, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.moveSpeed(this.time) * 10) / 10],
        e, fx: fx.length ? fx : undefined,
      });
    }
  }

  /** Marca a entidade como conhecida pelo jogador; devolve true se ainda não era. */
  protected isNew(p: Player, id: number) { return !p.known.has(id); }
}

export class Town extends World {
  kind = 'town' as const;
  town = buildTown();
  grid: Grid = this.town;
  private encoded = encodeTiles(this.town.tiles);

  spawnPoint() {
    return { x: this.town.spawn.x * TILE + (Math.random() - 0.5) * 40, y: this.town.spawn.y * TILE + (Math.random() - 0.5) * 30 };
  }

  mapMessage() {
    return { world: 'town', w: this.grid.w, h: this.grid.h, tiles: this.encoded, biome: -1, floor: 0, objects: [] };
  }

  nearNpc(p: Player, role: string, maxTiles = 4) {
    const n = this.town.npcs.find((x) => x.role === role);
    return !!n && Math.hypot(n.x * TILE - p.x, n.y * TILE - p.y) <= maxTiles * TILE;
  }

  protected update() {}
  protected extraEntities() {}
}
