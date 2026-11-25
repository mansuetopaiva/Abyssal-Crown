/** Pool de objetos: evita alocar/coletar lixo a cada quadro (monstros, projéteis, textos de dano, partículas). */
export class Pool<T extends { active: boolean }> {
  private free: T[] = [];
  readonly live: T[] = [];
  constructor(private make: () => T, private max: number) {}

  get(): T | null {
    if (this.live.length >= this.max) return null;
    const o = this.free.pop() ?? this.make();
    o.active = true;
    this.live.push(o);
    return o;
  }

  /** Remove os inativos mantendo a ordem (compactação in-place, sem alocação). */
  sweep() {
    let j = 0;
    for (let i = 0; i < this.live.length; i++) {
      const o = this.live[i];
      if (o.active) this.live[j++] = o;
      else this.free.push(o);
    }
    this.live.length = j;
  }

  clear() {
    for (const o of this.live) { o.active = false; this.free.push(o); }
    this.live.length = 0;
  }
}
