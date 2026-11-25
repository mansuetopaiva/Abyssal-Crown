import { MAX_PARTY } from '../../shared/constants';
import type { Player } from './player';
import type { Dungeon } from './dungeon';

let nextPartyId = 1;

export class Party {
  readonly id = nextPartyId++;
  members: Player[] = [];
  invites = new Set<number>(); // ids de personagem convidados
  dungeon: Dungeon | null = null;
  constructor(public leader: Player) {
    this.members.push(leader);
    leader.party = this;
  }
  get full() { return this.members.length >= MAX_PARTY; }

  add(p: Player) {
    if (this.full || this.members.includes(p)) return false;
    this.members.push(p);
    p.party = this;
    this.invites.delete(p.char.id);
    this.broadcast();
    return true;
  }

  remove(p: Player) {
    this.members = this.members.filter((m) => m !== p);
    p.party = null;
    if (this.leader === p && this.members.length) this.leader = this.members[0];
    this.broadcast();
    p.send({ t: 'party', party: null });
  }

  info() {
    return {
      id: this.id,
      leader: this.leader.char.id,
      members: this.members.map((m) => ({
        id: m.char.id, eid: m.eid, name: m.name, classId: m.char.classId, level: m.char.level,
        hp: Math.round(m.hp), maxHp: m.stats.maxHp, where: m.world?.kind ?? 'off', floor: m.world?.floor ?? 0,
      })),
    };
  }

  broadcast() {
    const info = this.info();
    for (const m of this.members) m.send({ t: 'party', party: info });
  }
}
