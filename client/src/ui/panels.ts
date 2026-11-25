import { ATTR_LABEL, ATTRS, CHECKPOINT_EVERY, ELEMENT_LABEL, ELEMENTS, RANK_INFO, RANKS, SLOT_LABEL, SLOTS, xpForLevel, type Slot } from '../../../shared/constants';
import { GEM_SHOP, MAX_GEM_TIER, combineCost, gemPrice, parseGemKey, potionPrice, refineChance, refineCost, repairCost, unsocketCost } from '../../../shared/economy';
import { AFFIX_BY_STAT, SOCKET_GEMS, UNIQUES, WEAPONS } from '../../../shared/loot';
import { CLASS_BY_ID, itemBonuses, itemPower, skillUnlockLevel, validLoadout } from '../../../shared/stats';
import type { Item } from '../../../shared/types';
import { api } from '../api';
import { $, fmt, h } from '../dom';
import { itemIconUrl } from '../render/sprites';
import type { Game } from '../game';

const SLOT_TYPE_LABEL: Record<string, string> = { weapon: 'Arma', offhand: 'Secundária', helm: 'Elmo', armor: 'Armadura', gloves: 'Luvas', boots: 'Botas', amulet: 'Amuleto', ring: 'Anel' };
const TITLES: Record<string, string> = {
  inventory: 'Inventário', character: 'Personagem e Talentos', quests: 'Missões e Conquistas', leaderboard: 'Quadro de Honra',
  smith: 'Ferreiro Brann', alchemist: 'Alquimista Ysolde', jeweler: 'Joalheira Mirel', market: 'Mercado', portal: 'Portal do Abismo',
};
const ACH = [
  ['floor10', 'Desbravador', 'Alcance o andar 10', 10], ['floor25', 'Mergulhador', 'Alcance o andar 25', 20], ['floor50', 'Abissal', 'Alcance o andar 50', 40],
  ['floor100', 'Coroado', 'Alcance o andar 100', 100], ['boss1', 'Matador de Chefes', 'Derrote um chefe', 10], ['boss10', 'Lenda', 'Derrote 10 chefes', 50],
  ['kills500', 'Ceifador', 'Abata 500 monstros', 15], ['rankS', 'Sortudo', 'Encontre um item rank S', 15], ['rankSSS', 'Escolhido do Abismo', 'Encontre um item SSS', 100], ['level20', 'Veterano', 'Chegue ao nível 20', 15],
] as const;
const DAILY = [['kills', 'Abata 60 monstros', 60, 5], ['chests', 'Abra 4 baús', 4, 4], ['floors', 'Desça 8 andares', 8, 6]] as const;

export const rankColor = (r: string) => (RANK_INFO[r as keyof typeof RANK_INFO].color === 'rainbow' ? '#ffd23f' : RANK_INFO[r as keyof typeof RANK_INFO].color);

function itemName(it: Item) {
  const n = h('span', { text: `${it.name}${it.refine ? ` +${it.refine}` : ''}` });
  if (it.rank === 'SSS') n.className = 'rainbow-text';
  else n.style.color = rankColor(it.rank);
  return n;
}

function statLines(it: Item): string[] {
  const out: string[] = [];
  const q = (1 + it.refine * 0.06) * (it.durability <= 0 ? 0.5 : 1);
  if (it.dmg) {
    const w = WEAPONS.find((x) => x.type === it.baseType);
    out.push(`Dano ${Math.round(it.dmg[0] * q)}–${Math.round(it.dmg[1] * q)}${w ? ` · ${w.atkSpd} atq/s` : ''}`);
  }
  if (it.armor) out.push(`Armadura ${Math.round(it.armor * q)}`);
  if (it.hp) out.push(`Vida +${Math.round(it.hp * q)}`);
  if (it.mana) out.push(`Mana +${Math.round(it.mana * q)}`);
  return out;
}

export function itemTip(it: Item, compare?: Item | null): HTMLElement {
  const tip = h('div', { class: 'tip' },
    h('h4', null, itemName(it)),
    h('div', { class: 'sub', text: `Rank ${it.rank} · ${SLOT_TYPE_LABEL[it.slotType]} · Nível ${it.ilvl}` }),
  );
  for (const l of statLines(it)) tip.append(h('div', { text: l }));
  for (const a of it.affixes) {
    const def = AFFIX_BY_STAT[a.stat];
    tip.append(h('div', { class: 'aff', text: `+${a.value}${def?.pct ? '' : ''} ${def?.label ?? a.stat}` }));
  }
  if (it.sockets) tip.append(h('div', { class: 'muted', text: `Engastes: ${it.gems.map((g) => `${SOCKET_GEMS.find((s) => s.id === g.id)?.name} ${g.tier}`).join(', ') || '—'} (${it.gems.length}/${it.sockets})` }));
  if (it.unique) {
    const u = UNIQUES.find((x) => x.effect === it.unique);
    if (u) tip.append(h('div', { class: 'uniq', text: `Lendário: ${u.desc}` }));
  }
  tip.append(h('div', { class: 'muted', text: `Durabilidade ${it.durability}% · Poder ${itemPower(it)}` }));
  if (compare && compare !== it) {
    const a = itemBonuses(it), b = itemBonuses(compare);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const diff = h('div', { style: { marginTop: '6px' } }, h('div', { class: 'tag', text: 'Comparado ao equipado' }));
    const dp = itemPower(it) - itemPower(compare);
    diff.append(h('div', { class: dp >= 0 ? 'cmp-up' : 'cmp-down', text: `${dp >= 0 ? '▲' : '▼'} Poder ${dp >= 0 ? '+' : ''}${dp}` }));
    if (it.dmg && compare.dmg) {
      const d = (it.dmg[0] + it.dmg[1] - compare.dmg[0] - compare.dmg[1]) / 2;
      if (Math.abs(d) >= 1) diff.append(h('div', { class: d > 0 ? 'cmp-up' : 'cmp-down', text: `${d > 0 ? '+' : ''}${Math.round(d)} dano médio` }));
    }
    for (const k of keys) {
      const d = Math.round(((a[k] ?? 0) - (b[k] ?? 0)) * 10) / 10;
      if (!d) continue;
      const label = AFFIX_BY_STAT[k]?.label ?? (k === 'armor' ? 'armadura' : k === 'hp' ? 'vida' : k === 'mana' ? 'mana' : k);
      diff.append(h('div', { class: d > 0 ? 'cmp-up' : 'cmp-down', text: `${d > 0 ? '+' : ''}${d} ${label}` }));
    }
    tip.append(diff);
  }
  return tip;
}

export class Panels {
  current = '';
  sub = '';
  selected: string | null = null; // "inv:3" | "eq:weapon"
  stock: any[] = [];
  listings: any[] = [];
  board: any = null;

  constructor(private g: Game) {
    $('#panel-close').onclick = () => this.close();
  }

  get c() { return this.g.char; }

  toggle(name: string) { this.current === name ? this.close() : this.open(name); }

  open(name: string) {
    this.current = name;
    this.sub = '';
    this.selected = null;
    $('#panel').hidden = false;
    $('#panel-title').textContent = TITLES[name] ?? name;
    if (name === 'smith') this.g.send({ t: 'shop', op: 'stock' });
    if (name === 'market') this.g.send({ t: 'market', op: 'list' });
    if (name === 'leaderboard') api('/api/leaderboard').then((b) => { this.board = b; this.refresh(); }).catch(() => {});
    this.refresh();
    ($('#panel-close') as HTMLButtonElement).focus();
  }

  close() {
    this.current = '';
    $('#panel').hidden = true;
    this.hideTip();
  }

  onServer(m: any) {
    if (m.t === 'stock') this.stock = m.items;
    if (m.t === 'market') this.listings = m.listings;
    if (m.t === 'chestOpened') this.g.toast(`Baú: ${m.item.name} [${m.item.rank}]`, 'good');
    this.refresh();
  }

  refresh() {
    if (!this.current || !this.c) return;
    const body = $('#panel-body');
    const scroll = body.scrollTop;
    const fn = (this as any)[`render_${this.current}`] as (() => HTMLElement[]) | undefined;
    body.replaceChildren(...(fn ? fn.call(this) : []));
    body.scrollTop = scroll;
  }

  // ---------- tooltip ----------
  private showTip(it: Item, ev: MouseEvent, compare?: Item | null) {
    const t = $('#tooltip');
    t.replaceChildren(itemTip(it, compare));
    t.hidden = false;
    const x = Math.min(ev.clientX + 16, innerWidth - 260), y = Math.min(ev.clientY + 12, innerHeight - t.offsetHeight - 8);
    t.style.left = `${x}px`; t.style.top = `${Math.max(8, y)}px`;
  }
  private hideTip() { $('#tooltip').hidden = true; }

  private equippedFor(it: Item): Item | null {
    const eq = this.c.data.equipment;
    if (it.slotType === 'ring') return eq.ring1 ?? eq.ring2 ?? null;
    return eq[it.slotType] ?? null;
  }

  private slotEl(it: Item | null | undefined, ref: string, label = '', opts: { onclick?: () => void; ondbl?: () => void; compare?: boolean } = {}) {
    const el = h('button', { class: `slot${it ? ' filled' : ''}${it?.rank === 'SSS' ? ' sss' : ''}${this.selected === ref ? ' selected' : ''}`, 'aria-label': it ? `${it.name} rank ${it.rank}` : label || 'Vazio' });
    if (it) {
      el.style.borderColor = rankColor(it.rank);
      el.append(h('img', { src: itemIconUrl(it.slotType, it.baseType, RANK_INFO[it.rank].color), alt: '', draggable: 'false' }));
      el.append(h('span', { class: 'rk', style: { color: rankColor(it.rank) }, text: it.rank }));
      if (it.refine) el.append(h('span', { class: 'ref', text: `+${it.refine}` }));
      el.onmouseenter = (e) => this.showTip(it, e, opts.compare ? this.equippedFor(it) : null);
      el.onmousemove = (e) => this.showTip(it, e, opts.compare ? this.equippedFor(it) : null);
      el.onmouseleave = () => this.hideTip();
      el.onfocus = () => { const r = el.getBoundingClientRect(); this.showTip(it, { clientX: r.right, clientY: r.top } as MouseEvent, opts.compare ? this.equippedFor(it) : null); };
      el.onblur = () => this.hideTip();
    } else el.textContent = label;
    el.onclick = () => { this.selected = this.selected === ref ? null : ref; opts.onclick?.(); this.refresh(); };
    if (opts.ondbl) el.ondblclick = () => { this.hideTip(); opts.ondbl!(); };
    return el;
  }

  private selectedItem(): Item | null {
    if (!this.selected) return null;
    const [k, v] = this.selected.split(':');
    return k === 'inv' ? this.c.data.inventory[Number(v)] : this.c.data.equipment[v];
  }

  private subtabs(tabs: [string, string][], def: string) {
    if (!this.sub) this.sub = def;
    return h('div', { class: 'subtabs', role: 'group' }, ...tabs.map(([id, label]) =>
      h('button', { 'aria-pressed': String(this.sub === id), onclick: () => { this.sub = id; this.selected = null; this.refresh(); } }, label)));
  }

  private equipPane() {
    const eq = this.c.data.equipment;
    const order: Slot[] = ['helm', 'amulet', 'weapon', 'armor', 'offhand', 'gloves', 'ring1', 'boots', 'ring2'];
    return h('div', { class: 'equip-grid' }, ...order.map((s) =>
      this.slotEl(eq[s], `eq:${s}`, SLOT_LABEL[s], { ondbl: () => this.g.send({ t: 'unequip', slot: s }) })));
  }

  private invGrid(opts: { compare?: boolean; dbl?: (i: number) => void } = {}) {
    const inv = this.c.data.inventory as (Item | null)[];
    return h('div', { class: 'inv-grid' }, ...inv.slice(0, this.c.data.invSlots).map((it, i) =>
      this.slotEl(it, `inv:${i}`, '', { compare: opts.compare ?? true, ondbl: it && opts.dbl ? () => opts.dbl!(i) : undefined })));
  }

  // ---------- inventário ----------
  render_inventory() {
    const c = this.c, s = this.g.stats!;
    const sel = this.selectedItem();
    const inTown = this.g.map?.world === 'town';
    const actions = h('div', { class: 'inv-actions' });
    if (sel && this.selected!.startsWith('inv:')) {
      const idx = Number(this.selected!.split(':')[1]);
      actions.append(h('button', { class: 'btn small gold', onclick: () => { this.g.send({ t: 'equip', idx }); this.selected = null; } }, 'Equipar'));
      if (sel.slotType === 'ring') actions.append(h('button', { class: 'btn small', onclick: () => { this.g.send({ t: 'equip', idx, slot: 'ring2' }); this.selected = null; } }, 'Equipar no Anel 2'));
      actions.append(h('button', {
        class: 'btn small', disabled: !inTown, title: inTown ? '' : 'Venda na cidade',
        onclick: () => { if (RANKS.indexOf(sel.rank) >= 5 && !confirm(`Vender ${sel.name} [${sel.rank}]?`)) return; this.g.send({ t: 'sell', idx }); this.selected = null; },
      }, `Vender (${fmt(Math.floor(sel.value * (1 + sel.refine * 0.15)))} gold)`));
    } else if (sel) {
      actions.append(h('button', { class: 'btn small', onclick: () => { this.g.send({ t: 'unequip', slot: this.selected!.split(':')[1] }); this.selected = null; } }, 'Desequipar'));
    }
    const dl = h('dl', { class: 'stat-list' });
    const row = (k: string, v: string) => dl.append(h('dt', { text: k }), h('dd', { text: v }));
    row('Dano', `${s.minDmg}–${s.maxDmg} (+${Math.round(s.dmgPct * 100)}%)`);
    row('Crítico', `${(s.crit * 100).toFixed(1)}% · x${s.critMult.toFixed(2)}`);
    row('Vel. ataque', `${s.atkSpd.toFixed(2)}/s`);
    row('Armadura', String(s.armor));
    row('Vida / Mana', `${s.maxHp} / ${s.maxMana}`);
    row('Roubo de vida', `${(s.lifesteal * 100).toFixed(1)}%`);
    row('Gold / Raridade', `+${Math.round(s.goldFind * 100)}% / +${Math.round(s.magicFind * 100)}%`);
    return [h('div', { class: 'inv-layout' },
      h('div', null, this.equipPane(), dl),
      h('div', null,
        h('p', { class: 'muted', text: `Ordenado por rank · clique para selecionar · duplo clique para equipar · ${c.data.inventory.filter(Boolean).length}/${c.data.invSlots} espaços` }),
        this.invGrid({ dbl: (i) => this.g.send({ t: 'equip', idx: i }) }),
        actions,
      ),
    )];
  }

  // ---------- personagem / talentos ----------
  render_character() {
    const c = this.c, cls = CLASS_BY_ID[c.classId], s = this.g.stats!;
    const spent = Object.values(c.data.talents as Record<string, number>).reduce((a, b) => a + b, 0);
    const free = c.level - 1 - spent;
    const attrs = h('dl', { class: 'stat-list' });
    for (const a of ATTRS) attrs.append(h('dt', { text: ATTR_LABEL[a] }), h('dd', { text: String(s.attrs[a]) }));
    for (const e of ELEMENTS) if (e !== 'physical') attrs.append(h('dt', { text: `Resist. ${ELEMENT_LABEL[e]}` }), h('dd', { text: `${Math.round(s.res[e] * 100)}%` }));
    return [
      h('p', null, h('b', { text: `${c.name} — ${cls.name} nível ${c.level}` }), ' ', h('span', { class: 'muted', text: `XP ${fmt(c.xp)}/${fmt(xpForLevel(c.level))} · Andar máx. ${c.maxFloor} · Checkpoint ${c.checkpoint}` })),
      h('h3', { text: 'Barra de habilidades (teclas 1–4)' }),
      this.loadoutEditor(cls, c),
      h('h3', { text: 'Todas as habilidades' }),
      h('div', { class: 'skill-desc' }, ...[...cls.skills, cls.ultimate].map((sk, i) => {
        const lv = skillUnlockLevel(sk), locked = c.level < lv;
        return h('div', { class: locked ? 'locked' : '' }, h('b', { text: `${locked ? '🔒 ' : ''}${i === cls.skills.length ? '[R] ' : ''}${sk.name}` }), h('br'), sk.desc, h('br'),
          h('span', { class: 'muted', text: locked ? `Liberada no nível ${lv}` : `${sk.mana} mana · recarga ${sk.cd}s` }));
      })),
      h('h3', { text: `Talentos — ${free} ponto(s) livre(s)` }),
      h('div', { class: 'talent-grid' }, ...cls.talents.map((t) => {
        const r = c.data.talents[t.id] ?? 0;
        return h('button', { class: 'talent', disabled: free <= 0 || r >= t.max, onclick: () => this.g.send({ t: 'talent', id: t.id }), 'aria-label': `${t.name}, ${r} de ${t.max}` },
          h('span', { class: 'pts', text: `${r}/${t.max}` }), h('b', { text: t.name }), h('br'), h('small', { class: 'muted', text: t.desc }));
      })),
      h('h3', { text: 'Atributos' }), attrs,
      c.data.cosmetics.length ? h('div', null, h('h3', { text: 'Cosméticos' }), h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => this.g.send({ t: 'cosmetic', id: '' }) }, 'Nenhum'),
        ...c.data.cosmetics.map((id: string) => h('button', { class: `btn small${c.data.cosmetic === id ? ' gold' : ''}`, onclick: () => this.g.send({ t: 'cosmetic', id }) }, GEM_SHOP.find((x) => x.id === id)?.name ?? id)))) : null,
    ].filter(Boolean) as HTMLElement[];
  }

  private loadoutEditor(cls: any, c: any) {
    const lo = [...validLoadout(cls, c.data.loadout)];
    const form = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px' } });
    lo.forEach((cur, slot) => {
      const sel = h('select', { 'aria-label': `Habilidade da tecla ${slot + 1}` }) as HTMLSelectElement;
      cls.skills.forEach((sk: any, i: number) => {
        const lv = skillUnlockLevel(sk);
        const opt = h('option', { value: i, disabled: c.level < lv, text: `${slot + 1}: ${sk.name}${c.level < lv ? ` (nv ${lv})` : ''}` }) as HTMLOptionElement;
        if (i === cur) opt.selected = true;
        sel.append(opt);
      });
      sel.onchange = () => {
        const next = [...lo];
        const v = Number(sel.value), other = next.indexOf(v);
        if (other >= 0) next[other] = next[slot]; // troca de lugar se já estiver na barra
        next[slot] = v;
        this.g.send({ t: 'loadout', slots: next });
      };
      form.append(sel);
    });
    return form;
  }

  // ---------- missões ----------
  render_quests() {
    const c = this.c;
    const d = c.data.daily;
    return [
      h('h3', { text: 'Missões diárias' }),
      h('ul', { class: 'list' }, ...DAILY.map(([id, name, goal, gems]) => {
        const cur = Math.min(goal, d[id] ?? 0), done = d.claimed.includes(id);
        return h('li', null, h('div', { class: 'grow' }, h('b', { text: name }), h('div', { class: 'muted', text: `${cur}/${goal}` })),
          h('span', { class: 'price', text: `◆ ${gems}` }),
          h('button', { class: 'btn small gold', disabled: done || cur < goal, onclick: () => this.g.send({ t: 'daily', id }) }, done ? 'Resgatado' : 'Resgatar'));
      })),
      h('h3', { text: 'Conquistas' }),
      h('ul', { class: 'list' }, ...ACH.map(([id, name, desc, gems]) => h('li', null,
        h('div', { class: 'grow' }, h('b', { text: `${c.data.achievements.includes(id) ? '✔ ' : ''}${name}` }), h('div', { class: 'muted', text: desc })),
        h('span', { class: 'price', text: `◆ ${gems}` })))),
      h('p', { class: 'muted', text: `Monstros abatidos: ${c.data.stats.kills} · Chefes: ${c.data.stats.bossKills} · Baús: ${c.data.stats.chestsOpened} · Mortes: ${c.data.stats.deaths}` }),
    ];
  }

  // ---------- ranking ----------
  render_leaderboard() {
    if (!this.board) return [h('p', { class: 'muted', text: 'Carregando ranking...' })];
    const tabs = this.subtabs([['floor', 'Andar mais profundo'], ['bosses', 'Chefes derrotados'], ['rarest', 'Item mais raro']], 'floor');
    const rows = (this.board[this.sub] ?? []) as any[];
    const col = this.sub === 'floor' ? (r: any) => `Andar ${r.maxFloor}` : this.sub === 'bosses' ? (r: any) => `${r.bossKills} chefes` : (r: any) => r.bestItem || '—';
    const table = h('table', { class: 'board' }, h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Herói' }), h('th', { text: 'Classe' }), h('th', { text: 'Nível' }), h('th', { text: 'Marca' }))),
      h('tbody', null, ...rows.map((r, i) => h('tr', null, h('td', { text: String(i + 1) }), h('td', { text: r.name }), h('td', { text: CLASS_BY_ID[r.classId]?.name ?? r.classId }), h('td', { text: String(r.level) }), h('td', { text: col(r) })))));
    return [tabs, rows.length ? table : h('p', { class: 'muted', text: 'Ninguém no ranking ainda. Seja o primeiro!' })];
  }

  // ---------- portal ----------
  render_portal() {
    const c = this.c;
    const floors = [1];
    for (let f = 1 + CHECKPOINT_EVERY; f <= c.checkpoint; f += CHECKPOINT_EVERY) floors.push(f);
    const p = this.g.party;
    const leader = !p || p.leader === c.id;
    return [
      h('p', { text: p ? (leader ? 'Você é o líder: todo o grupo que estiver na cidade entra junto.' : 'Se o seu grupo já estiver na dungeon, você entra na instância dele.') : 'Você entrará sozinho. Use /convidar nome para formar um grupo (até 4).' }),
      h('h3', { text: 'Escolha o andar inicial' }),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, ...floors.map((f) =>
        h('button', { class: 'btn gold', onclick: () => { this.g.send({ t: 'enter', floor: f }); $('#loading').hidden = false; setTimeout(() => ($('#loading').hidden = true), 3000); } }, f === 1 ? 'Andar 1' : `Checkpoint ${f}`))),
      h('p', { class: 'muted', text: 'Checkpoints são liberados a cada 10 andares. Chefes aguardam nos andares 10, 20, 30...' }),
    ];
  }

  // ---------- ferreiro ----------
  render_smith() {
    const tabs = this.subtabs([['buy', 'Comprar'], ['refine', 'Refinar'], ['repair', 'Reparar']], 'buy');
    const c = this.c;
    if (this.sub === 'buy') {
      return [tabs, h('p', { class: 'muted', text: 'Estoque renovado todo dia.' }), h('ul', { class: 'list' }, ...this.stock.map((s, i) => {
        const li = h('li', null, this.slotEl(s.item, `shop:${i}`, '', { compare: true }), h('div', { class: 'grow' }, itemName(s.item), h('div', { class: 'muted', text: statLines(s.item).join(' · ') })),
          h('span', { class: 'price', text: `◉ ${fmt(s.price)}` }),
          h('button', { class: 'btn small gold', disabled: s.sold || c.gold < s.price, onclick: () => this.g.send({ t: 'shop', op: 'buy', i }) }, s.sold ? 'Vendido' : 'Comprar'));
        return li;
      }))];
    }
    if (this.sub === 'refine') {
      const sel = this.selectedItem();
      const info = sel ? h('div', { class: 'card', style: { width: '100%', marginTop: '12px' } },
        h('p', null, itemName(sel)),
        sel.refine >= 15 ? h('p', { text: 'Refino máximo alcançado.' }) : h('div', null,
          h('p', { text: `+${sel.refine} → +${sel.refine + 1} · Chance ${Math.round(refineChance(sel) * 100)}% · Custo ◉ ${fmt(refineCost(sel))}` }),
          sel.refine >= 9 ? h('p', { class: 'muted', text: 'Atenção: a partir de +10, falhas reduzem o refino em 1.' }) : null,
          h('button', { class: 'btn gold', disabled: c.gold < refineCost(sel), onclick: () => this.g.send({ t: 'shop', op: 'refine', ref: this.selected }) }, 'Refinar'))) : h('p', { class: 'muted', text: 'Selecione um item equipado ou do inventário.' });
      return [tabs, h('div', { class: 'inv-layout' }, this.equipPane(), this.invGrid()), info];
    }
    const items = Object.values(c.data.equipment as Record<string, Item>).filter((x) => x.durability < 100);
    const cost = items.reduce((a, it) => a + repairCost(it), 0);
    return [tabs, h('p', { text: items.length ? `${items.length} item(ns) danificado(s). Morrer reduz 10% de durabilidade; com 0% o item perde metade dos atributos.` : 'Seu equipamento está intacto.' }),
      h('button', { class: 'btn gold', disabled: !cost || c.gold < cost, onclick: () => this.g.send({ t: 'shop', op: 'repair' }) }, `Reparar tudo (◉ ${fmt(cost)})`)];
  }

  // ---------- alquimista ----------
  render_alchemist() {
    const c = this.c;
    const line = (k: 'hpPotion' | 'manaPotion', name: string, key: string) => {
      const price = potionPrice(k, c.level);
      return h('li', null, h('div', { class: 'grow' }, h('b', { text: name }), h('div', { class: 'muted', text: `Restaura 40% · você tem ${c.data.consumables[k]}` })),
        h('span', { class: 'price', text: `◉ ${price} cada` }),
        ...[1, 5, 10].map((n) => h('button', { class: 'btn small', disabled: c.gold < price * n, onclick: () => this.g.send({ t: 'shop', op: 'potion', k: key, n }) }, `x${n}`)));
    };
    return [h('ul', { class: 'list' }, line('hpPotion', 'Poção de Vida (Q)', 'hp'), line('manaPotion', 'Poção de Mana (F)', 'mana'))];
  }

  // ---------- joalheira ----------
  render_jeweler() {
    const tabs = this.subtabs([['buy', 'Comprar gemas'], ['socket', 'Engastar'], ['combine', 'Combinar']], 'buy');
    const c = this.c;
    const owned = Object.entries(c.data.socketGems as Record<string, number>).filter(([, n]) => n > 0);
    const gemName = (k: string) => { const { id, tier } = parseGemKey(k); const g = SOCKET_GEMS.find((x) => x.id === id)!; return `${g.name} ${tier} (+${g.perTier * tier} ${AFFIX_BY_STAT[g.stat]?.label ?? g.stat})`; };
    if (this.sub === 'buy') {
      return [tabs, h('ul', { class: 'list' }, ...SOCKET_GEMS.map((g) => h('li', null,
        h('span', { style: { color: g.color, fontSize: '20px' }, text: '◆' }),
        h('div', { class: 'grow' }, h('b', { text: g.name }), h('div', { class: 'muted', text: `+${g.perTier} ${AFFIX_BY_STAT[g.stat]?.label ?? g.stat} por nível` })),
        ...[1, 2, 3].map((t) => { const p = gemPrice(t); return h('button', { class: 'btn small', disabled: c.gold < p.gold || c.gems < p.gems, onclick: () => this.g.send({ t: 'shop', op: 'gem', id: g.id, tier: t }) }, `Nv ${t}: ◉${fmt(p.gold)}${p.gems ? ` ◆${p.gems}` : ''}`); }))))];
    }
    if (this.sub === 'combine') {
      return [tabs, h('p', { class: 'muted', text: '3 gemas iguais → 1 gema do nível seguinte (máx. 5).' }), owned.length ? h('ul', { class: 'list' }, ...owned.map(([k, n]) => {
        const { id, tier } = parseGemKey(k);
        return h('li', null, h('div', { class: 'grow', text: `${gemName(k)} × ${n}` }),
          h('button', { class: 'btn small', disabled: n < 3 || tier >= MAX_GEM_TIER || c.gold < combineCost(tier), onclick: () => this.g.send({ t: 'shop', op: 'combine', id, tier }) }, `Combinar (◉ ${combineCost(tier)})`));
      })) : h('p', { text: 'Você não tem gemas.' })];
    }
    const sel = this.selectedItem();
    const box = h('div', { style: { marginTop: '12px' } });
    if (sel) {
      box.append(h('p', null, itemName(sel), ` — engastes ${sel.gems.length}/${sel.sockets}`));
      if (sel.sockets === 0) box.append(h('p', { class: 'muted', text: 'Este item não tem engastes (rank D ou superior têm).' }));
      if (sel.gems.length < sel.sockets) box.append(h('ul', { class: 'list' }, ...owned.map(([k, n]) => {
        const { id, tier } = parseGemKey(k);
        return h('li', null, h('div', { class: 'grow', text: `${gemName(k)} × ${n}` }), h('button', { class: 'btn small gold', onclick: () => this.g.send({ t: 'shop', op: 'socket', ref: this.selected, id, tier }) }, 'Engastar'));
      })));
      if (sel.gems.length) box.append(h('button', { class: 'btn small', onclick: () => this.g.send({ t: 'shop', op: 'unsocket', ref: this.selected }) }, `Remover última gema (◉ ${unsocketCost})`));
    } else box.append(h('p', { class: 'muted', text: 'Selecione um item.' }));
    return [tabs, h('div', { class: 'inv-layout' }, this.equipPane(), this.invGrid()), box];
  }

  // ---------- mercado ----------
  render_market() {
    const tabs = this.subtabs([['merchant', 'Vender ao mercador'], ['browse', 'Comprar de jogadores'], ['sell', 'Anunciar para jogadores'], ['gems', 'Loja de Gemas']], 'merchant');
    const c = this.c;
    if (this.sub === 'merchant') {
      const sel = this.selectedItem();
      const inv = (c.data.inventory as (Item | null)[]).filter(Boolean) as Item[];
      const priceOf = (it: Item) => Math.floor(it.value * (1 + it.refine * 0.15));
      const sumUpTo = (r: number) => inv.filter((it) => RANKS.indexOf(it.rank) <= r).reduce((a, it) => a + priceOf(it), 0);
      const countUpTo = (r: number) => inv.filter((it) => RANKS.indexOf(it.rank) <= r).length;
      const bulk = h('div', { class: 'inv-actions' }, ...[0, 1, 2, 3].map((r) => {
        const n = countUpTo(r);
        return h('button', {
          class: 'btn small', disabled: !n,
          onclick: () => { if (confirm(`Vender ${n} item(ns) de rank ${RANKS.slice(0, r + 1).join(', ')} por ${fmt(sumUpTo(r))} gold?`)) this.g.send({ t: 'sellBulk', max: r }); },
        }, `Vender tudo ${r === 0 ? 'F' : `F até ${RANKS[r]}`} (${n} · ◉ ${fmt(sumUpTo(r))})`);
      }));
      const one = h('div', { class: 'inv-actions' });
      if (sel && this.selected!.startsWith('inv:')) {
        const idx = Number(this.selected!.split(':')[1]);
        one.append(itemName(sel), h('button', {
          class: 'btn small gold',
          onclick: () => { if (RANKS.indexOf(sel.rank) >= 5 && !confirm(`Vender ${sel.name} [${sel.rank}]?`)) return; this.g.send({ t: 'sell', idx }); this.selected = null; },
        }, `Vender por ◉ ${fmt(priceOf(sel))}`));
      } else one.append(h('span', { class: 'muted', text: 'Selecione um item para vender, ou venda em lote:' }));
      return [tabs, h('p', { class: 'muted', text: 'O mercador compra qualquer item na hora. Itens equipados não são vendidos.' }), this.invGrid({ compare: true }), one, bulk];
    }
    if (this.sub === 'browse') {
      return [tabs, h('p', { class: 'muted', text: 'Taxa de 5% sobre cada venda, paga pelo vendedor.' }), this.listings.length ? h('ul', { class: 'list' }, ...this.listings.map((l) => h('li', null,
        this.slotEl(l.item, `mk:${l.id}`, '', { compare: true }),
        h('div', { class: 'grow' }, itemName(l.item), h('div', { class: 'muted', text: `por ${l.seller}` })),
        h('span', { class: 'price', text: `◉ ${fmt(l.price)}` }),
        l.mine ? h('button', { class: 'btn small', onclick: () => this.g.send({ t: 'market', op: 'cancel', id: l.id }) }, 'Cancelar')
          : h('button', { class: 'btn small gold', disabled: c.gold < l.price, onclick: () => this.g.send({ t: 'market', op: 'buy', id: l.id }) }, 'Comprar')))) : h('p', { text: 'Nenhum item à venda no momento.' })];
    }
    if (this.sub === 'sell') {
      const sel = this.selectedItem();
      const form = h('form', { class: 'row', style: { marginTop: '12px' } });
      if (sel && this.selected!.startsWith('inv:')) {
        const input = h('input', { type: 'number', min: 1, max: 1e9, value: Math.max(1, sel.value * 3), 'aria-label': 'Preço em gold', style: { width: '140px' } });
        form.append(itemName(sel), input, h('button', { class: 'btn small gold', type: 'submit' }, 'Anunciar'));
        form.onsubmit = (e) => { e.preventDefault(); this.g.send({ t: 'market', op: 'sell', idx: Number(this.selected!.split(':')[1]), price: Math.floor(Number(input.value)) }); this.selected = null; };
      } else form.append(h('span', { class: 'muted', text: 'Selecione um item do inventário.' }));
      return [tabs, this.invGrid({ compare: false }), form];
    }
    return [tabs, h('p', { text: `Você tem ◆ ${c.gems} gemas. Ganhe gemas derrotando chefes, abrindo baús secretos, com conquistas e missões diárias.` }),
      h('ul', { class: 'list' }, ...GEM_SHOP.map((g) => {
        const owned = 'cosmetic' in g && c.data.cosmetics.includes(g.id);
        return h('li', null, h('div', { class: 'grow' }, h('b', { text: g.name }), h('div', { class: 'muted', text: g.desc })), h('span', { class: 'price', text: `◆ ${g.gems}` }),
          h('button', { class: 'btn small gold', disabled: owned || c.gems < g.gems, onclick: () => { if (g.id === 'talentReset' && !confirm('Resetar todos os talentos?')) return; this.g.send({ t: 'shop', op: 'premium', id: g.id }); } }, owned ? 'Possui' : 'Comprar'));
      }))];
  }
}

export { SLOTS };
