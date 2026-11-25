// Cria o banco (se não existir) e um usuário de teste.
// Uso: npm run seed   →   login: teste / senha: teste123
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from './db';
import { hashPassword } from './auth';
import { newCharacterData } from './game/character';
import { rollItem } from '../shared/loot';
import { mulberry32 } from '../shared/rng';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.env.DATABASE_FILE ?? join(root, 'data', 'abyssal.db');
const repo = new Repo(file);

const USER = 'teste', EMAIL = 'teste@abyssal.local', PASS = 'teste123';
const existing = repo.findUserByLogin(USER);
if (existing) {
  console.log(`Usuário de teste já existe (id ${existing.id}). Login: ${USER} / ${PASS}`);
  process.exit(0);
}
const uid = repo.createUser(USER, EMAIL, await hashPassword(PASS));

// 1) Veterano: nível 15, checkpoint no andar 11 e equipamento variado (bom para testar chefes)
const vet = repo.createCharacter(uid, 'Valerion', 'warrior', newCharacterData('warrior'), 5000);
const rng = mulberry32(2024);
vet.level = 15; vet.gems = 120; vet.maxFloor = 12; vet.checkpoint = 11;
for (const rank of ['B', 'A', 'C', 'D', 'S'] as const) {
  const it = rollItem(rng, { ilvl: 12, rank });
  const i = vet.data.inventory.indexOf(null);
  vet.data.inventory[i] = it;
}
vet.data.socketGems = { 'ruby:1': 3, 'emerald:2': 1 };
vet.data.consumables = { hpPotion: 20, manaPotion: 15 };
repo.saveCharacter(vet);

// 2) Novatos de outras classes
repo.createCharacter(uid, 'Lyra', 'mage', newCharacterData('mage'), 100);
repo.createCharacter(uid, 'Sombra', 'rogue', newCharacterData('rogue'), 100);

console.log(`Banco pronto em ${file}`);
console.log(`Usuário de teste criado → login: ${USER}  senha: ${PASS}`);
