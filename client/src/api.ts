declare global { interface Window { ABYSSAL_SERVER?: string } }

export const SERVER = (window.ABYSSAL_SERVER ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SERVER + path, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }
  let data: any = {};
  try { data = await res.json(); } catch { /* corpo vazio */ }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  return data as T;
}

export function wsUrl() {
  const base = SERVER || location.origin;
  return base.replace(/^http/, 'ws') + '/ws';
}
