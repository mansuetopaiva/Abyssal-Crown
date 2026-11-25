import { TILE } from './constants';
import { T_FLOOR } from './dungeon';

export interface Grid { w: number; h: number; tiles: Uint8Array }

export function isSolidAt(g: Grid, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return true;
  return g.tiles[ty * g.w + tx] !== T_FLOOR;
}

function blocked(g: Grid, x: number, y: number, r: number): boolean {
  return isSolidAt(g, x - r, y - r) || isSolidAt(g, x + r, y - r) || isSolidAt(g, x - r, y + r) || isSolidAt(g, x + r, y + r);
}

/** Move com colisão separada por eixo (desliza nas paredes). Mesma função no cliente e no servidor. */
export function moveWithCollision(g: Grid, x: number, y: number, dx: number, dy: number, r: number): { x: number; y: number } {
  // subdivide passos grandes para não atravessar paredes
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE / 2)));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx && !blocked(g, x + sx, y, r)) x += sx;
    if (sy && !blocked(g, x, y + sy, r)) y += sy;
  }
  return { x, y };
}

/** Normaliza direção de input vinda do cliente (anti-cheat: sempre módulo ≤ 1). */
export function normalizeDir(dx: number, dy: number): [number, number] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [0, 0];
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return [0, 0];
  const k = len > 1 ? 1 / len : 1;
  return [dx * k, dy * k];
}

/** Linha de visão simples (amostragem) entre dois pontos. */
export function lineOfSight(g: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / (TILE / 3));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isSolidAt(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}
