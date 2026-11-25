import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Character, CharacterData, Item } from '../shared/types';

export interface UserRow { id: number; username: string; email: string; password_hash: string }
export interface MarketRow { id: number; seller_char_id: number; seller_name: string; item: Item; price: number; created_at: number }
export type LeaderKind = 'floor' | 'bosses' | 'rarest';

/**
 * Camada de persistência. Implementação em SQLite (node:sqlite).
 * Para PostgreSQL/Prisma, implemente a mesma interface pública (ver README).
 */
export class Repo {
  db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        class_id TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        gold INTEGER NOT NULL DEFAULT 0,
        gems INTEGER NOT NULL DEFAULT 0,
        max_floor INTEGER NOT NULL DEFAULT 0,
        checkpoint INTEGER NOT NULL DEFAULT 1,
        boss_kills INTEGER NOT NULL DEFAULT 0,
        best_rank INTEGER NOT NULL DEFAULT -1,
        best_item TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_char_user ON characters(user_id);
      CREATE INDEX IF NOT EXISTS idx_char_floor ON characters(max_floor DESC);
      CREATE TABLE IF NOT EXISTS market (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        seller_name TEXT NOT NULL,
        item TEXT NOT NULL,
        price INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        char_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        gold_delta INTEGER NOT NULL DEFAULT 0,
        gems_delta INTEGER NOT NULL DEFAULT 0,
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tx_char ON transactions(char_id, created_at);
      CREATE TABLE IF NOT EXISTS stash (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL
      );
    `);
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- usuários ----------
  createUser(username: string, email: string, hash: string): number {
    const r = this.db.prepare('INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(username, email, hash, Date.now());
    return Number(r.lastInsertRowid);
  }
  userExists(username: string, email: string): { username: boolean; email: boolean } {
    const u = this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    const e = this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    return { username: !!u, email: !!e };
  }
  findUserByLogin(login: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login) as unknown as UserRow | undefined;
  }
  getUser(id: number): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  }

  // ---------- personagens ----------
  private rowToChar(r: Record<string, unknown>): Character {
    return {
      id: Number(r.id), userId: Number(r.user_id), name: String(r.name), classId: String(r.class_id), level: Number(r.level),
      xp: Number(r.xp), gold: Number(r.gold), gems: Number(r.gems), maxFloor: Number(r.max_floor), checkpoint: Number(r.checkpoint),
      data: JSON.parse(String(r.data)) as CharacterData,
    };
  }
  listCharacters(userId: number): Character[] {
    return (this.db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY id').all(userId) as Record<string, unknown>[]).map((r) => this.rowToChar(r));
  }
  countCharacters(userId: number): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?').get(userId) as { n: number }).n);
  }
  charNameTaken(name: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM characters WHERE name = ?').get(name);
  }
  createCharacter(userId: number, name: string, classId: string, data: CharacterData, gold: number): Character {
    const now = Date.now();
    const r = this.db
      .prepare('INSERT INTO characters (user_id, name, class_id, gold, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, name, classId, gold, JSON.stringify(data), now, now);
    return this.getCharacter(Number(r.lastInsertRowid))!;
  }
  getCharacter(id: number): Character | undefined {
    const r = this.db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.rowToChar(r) : undefined;
  }
  deleteCharacter(id: number, userId: number): boolean {
    return Number(this.db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').run(id, userId).changes) > 0;
  }
  saveCharacter(c: Character) {
    this.db
      .prepare(
        `UPDATE characters SET level=?, xp=?, gold=?, gems=?, max_floor=?, checkpoint=?, boss_kills=?, best_rank=?, best_item=?, data=?, updated_at=? WHERE id=?`,
      )
      .run(c.level, c.xp, c.gold, c.gems, c.maxFloor, c.checkpoint, c.data.stats.bossKills, c.data.stats.bestRank, c.data.stats.bestItem, JSON.stringify(c.data), Date.now(), c.id);
  }

  // ---------- ranking ----------
  leaderboard(kind: LeaderKind, limit = 20) {
    const order = kind === 'floor' ? 'max_floor DESC, level DESC' : kind === 'bosses' ? 'boss_kills DESC, max_floor DESC' : 'best_rank DESC, max_floor DESC';
    return this.db
      .prepare(`SELECT name, class_id AS classId, level, max_floor AS maxFloor, boss_kills AS bossKills, best_rank AS bestRank, best_item AS bestItem FROM characters ORDER BY ${order} LIMIT ?`)
      .all(limit);
  }

  // ---------- mercado ----------
  listMarket(limit = 100): MarketRow[] {
    return (this.db.prepare('SELECT * FROM market ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), seller_char_id: Number(r.seller_char_id), seller_name: String(r.seller_name), item: JSON.parse(String(r.item)), price: Number(r.price), created_at: Number(r.created_at),
    }));
  }
  countListings(charId: number): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM market WHERE seller_char_id = ?').get(charId) as { n: number }).n);
  }
  addListing(charId: number, sellerName: string, item: Item, price: number): number {
    return Number(this.db.prepare('INSERT INTO market (seller_char_id, seller_name, item, price, created_at) VALUES (?, ?, ?, ?, ?)').run(charId, sellerName, JSON.stringify(item), price, Date.now()).lastInsertRowid);
  }
  getListing(id: number): MarketRow | undefined {
    return this.listMarketById(id);
  }
  private listMarketById(id: number): MarketRow | undefined {
    const r = this.db.prepare('SELECT * FROM market WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? { id: Number(r.id), seller_char_id: Number(r.seller_char_id), seller_name: String(r.seller_name), item: JSON.parse(String(r.item)), price: Number(r.price), created_at: Number(r.created_at) } : undefined;
  }
  removeListing(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM market WHERE id = ?').run(id).changes) > 0;
  }
  /** Credita gold a um personagem offline (venda no mercado). */
  addGold(charId: number, amount: number) {
    this.db.prepare('UPDATE characters SET gold = gold + ? WHERE id = ?').run(amount, charId);
  }

  // ---------- baú pessoal (por conta, compartilhado entre personagens) ----------
  getStash(userId: number, slots: number): (Item | null)[] {
    const r = this.db.prepare('SELECT data FROM stash WHERE user_id = ?').get(userId) as { data: string } | undefined;
    const items = r ? (JSON.parse(r.data) as (Item | null)[]) : [];
    while (items.length < slots) items.push(null);
    return items;
  }
  saveStash(userId: number, items: (Item | null)[]) {
    this.db.prepare('INSERT INTO stash (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data').run(userId, JSON.stringify(items));
  }

  // ---------- log de transações ----------
  logTx(charId: number, kind: string, goldDelta: number, gemsDelta: number, detail: string) {
    this.db.prepare('INSERT INTO transactions (char_id, kind, gold_delta, gems_delta, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(charId, kind, Math.round(goldDelta), Math.round(gemsDelta), detail.slice(0, 300), Date.now());
  }
  recentTx(charId: number, limit = 30) {
    return this.db.prepare('SELECT kind, gold_delta AS gold, gems_delta AS gems, detail, created_at AS at FROM transactions WHERE char_id = ? ORDER BY id DESC LIMIT ?').all(charId, limit);
  }
}
