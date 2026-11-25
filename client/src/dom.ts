// Helpers de DOM. Texto de usuário SEMPRE via textContent (nunca innerHTML) para evitar XSS.
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function show(id: string) {
  for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.hidden = s.id !== id;
}

export const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};
