import { T_FLOOR, T_WALL } from './dungeon';
import type { Grid } from './movement';

export interface Npc { id: string; name: string; role: 'smith' | 'alchemist' | 'jeweler' | 'market' | 'portal' | 'board'; x: number; y: number }

export const TOWN_W = 44;
export const TOWN_H = 32;

/** Cidade central fixa: praça com quatro lojas, portal da dungeon e quadro de ranking. */
export function buildTown(): Grid & { npcs: Npc[]; spawn: { x: number; y: number } } {
  const w = TOWN_W, h = TOWN_H;
  const tiles = new Uint8Array(w * h).fill(T_FLOOR);
  const wall = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * w + x] = T_WALL;
  };
  wall(0, 0, w - 1, 0); wall(0, h - 1, w - 1, h - 1); wall(0, 0, 0, h - 1); wall(w - 1, 0, w - 1, h - 1);
  // construções (lojas)
  wall(4, 3, 11, 7);   // ferreiro
  wall(32, 3, 39, 7);  // alquimista
  wall(4, 23, 11, 27); // joalheiro
  wall(32, 23, 39, 27); // mercado
  wall(19, 2, 24, 4);  // santuário do portal
  // canteiros / fonte
  wall(20, 14, 23, 16);
  const npcs: Npc[] = [
    { id: 'smith', name: 'Ferreiro Brann', role: 'smith', x: 7.5, y: 8.6 },
    { id: 'alchemist', name: 'Alquimista Ysolde', role: 'alchemist', x: 35.5, y: 8.6 },
    { id: 'jeweler', name: 'Joalheira Mirel', role: 'jeweler', x: 7.5, y: 22.4 },
    { id: 'market', name: 'Mercado', role: 'market', x: 35.5, y: 22.4 },
    { id: 'portal', name: 'Portal do Abismo', role: 'portal', x: 21.5, y: 5.6 },
    { id: 'board', name: 'Quadro de Honra', role: 'board', x: 26.5, y: 12.5 },
  ];
  return { w, h, tiles, npcs, spawn: { x: 21.5, y: 20 } };
}
