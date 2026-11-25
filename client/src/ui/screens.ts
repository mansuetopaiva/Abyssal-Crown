import { api, ApiError } from '../api';
import { $, h, show } from '../dom';
import { CLASSES, CLASS_BY_ID } from '../../../shared/stats';
import { MAX_CHARACTERS } from '../../../shared/constants';
import { sprite } from '../render/sprites';

type CharSummary = { id: number; name: string; classId: string; level: number; maxFloor: number; gold: number };

function setError(form: HTMLFormElement, msg: string) {
  $('.form-error', form).textContent = msg;
}

function busy(form: HTMLFormElement, on: boolean) {
  const b = $<HTMLButtonElement>('button[type=submit]', form);
  b.disabled = on;
  b.setAttribute('aria-busy', String(on));
}

export function initAuth(onLogged: (username: string) => void) {
  const tabLogin = $<HTMLButtonElement>('#tab-login'), tabReg = $<HTMLButtonElement>('#tab-register');
  const fLogin = $<HTMLFormElement>('#form-login'), fReg = $<HTMLFormElement>('#form-register');
  const select = (login: boolean) => {
    tabLogin.setAttribute('aria-selected', String(login));
    tabReg.setAttribute('aria-selected', String(!login));
    fLogin.hidden = !login; fReg.hidden = login;
    (login ? $('#login-user') : $('#reg-user')).focus();
  };
  // lembra o último usuário usado neste navegador (nunca a senha; essa fica com o gerenciador de senhas)
  const LAST = 'abyssal:lastLogin';
  try { const last = localStorage.getItem(LAST); if (last) $<HTMLInputElement>('#login-user').value = last; } catch { /* armazenamento indisponível */ }
  const remember = (u: string) => { try { localStorage.setItem(LAST, u); } catch { /* ignora */ } };
  tabLogin.onclick = () => select(true);
  tabReg.onclick = () => select(false);

  fLogin.onsubmit = async (e) => {
    e.preventDefault();
    const login = $<HTMLInputElement>('#login-user').value.trim();
    const password = $<HTMLInputElement>('#login-pass').value;
    if (!login || !password) return setError(fLogin, 'Preencha usuário/e-mail e senha.');
    busy(fLogin, true);
    try {
      const r = await api('/api/login', { login, password, remember: $<HTMLInputElement>('#login-remember').checked });
      setError(fLogin, '');
      remember(login);
      onLogged(r.user.username);
    } catch (err) {
      setError(fLogin, (err as ApiError).message);
    } finally { busy(fLogin, false); }
  };

  fReg.onsubmit = async (e) => {
    e.preventDefault();
    const username = $<HTMLInputElement>('#reg-user').value.trim();
    const email = $<HTMLInputElement>('#reg-email').value.trim();
    const password = $<HTMLInputElement>('#reg-pass').value;
    const password2 = $<HTMLInputElement>('#reg-pass2').value;
    const inputs = ['#reg-user', '#reg-email', '#reg-pass', '#reg-pass2'].map((s) => $<HTMLInputElement>(s));
    inputs.forEach((i) => i.removeAttribute('aria-invalid'));
    const bad = (i: number, msg: string) => { inputs[i].setAttribute('aria-invalid', 'true'); inputs[i].focus(); setError(fReg, msg); };
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return bad(0, 'Nome de usuário deve ter 3 a 20 caracteres (letras, números ou _).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad(1, 'Informe um e-mail válido.');
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return bad(2, 'A senha precisa de 8+ caracteres, com letras e números.');
    if (password !== password2) return bad(3, 'As senhas não coincidem.');
    busy(fReg, true);
    try {
      const r = await api('/api/register', { username, email, password, remember: true });
      setError(fReg, '');
      remember(username);
      onLogged(r.user.username);
    } catch (err) {
      setError(fReg, (err as ApiError).message);
    } finally { busy(fReg, false); }
  };
}

export async function showCharacters(username: string, onPlay: (charId: number) => void, onLogout: () => void) {
  show('screen-chars');
  $('#chars-user').textContent = username;
  $<HTMLButtonElement>('#btn-logout').onclick = async () => { await api('/api/logout', {}).catch(() => {}); onLogout(); };
  const list = $('#char-list');
  const createBox = $('#char-create');
  const form = $<HTMLFormElement>('#form-create');

  const grid = $('#class-grid');
  if (!grid.childElementCount) {
    CLASSES.forEach((c, i) => {
      const id = `cls-${c.id}`;
      grid.append(h('div', { class: 'class-opt' },
        h('input', { type: 'radio', name: 'cls', id, value: c.id, checked: i === 0 }),
        h('label', { for: id }, h('b', { text: c.name }), h('small', { text: c.desc })),
      ));
    });
  }

  const render = async () => {
    list.replaceChildren(h('li', { class: 'char-card empty', 'aria-busy': 'true' }, 'Carregando heróis...'));
    let chars: CharSummary[] = [];
    try {
      chars = (await api<{ characters: CharSummary[] }>('/api/characters')).characters;
    } catch (err) {
      if ((err as ApiError).status === 401) return onLogout();
      list.replaceChildren(h('li', { class: 'char-card empty' }, (err as Error).message));
      return;
    }
    list.replaceChildren();
    for (const c of chars) {
      const cls = CLASS_BY_ID[c.classId];
      const cv = h('canvas', { width: 24, height: 24, 'aria-hidden': 'true' });
      cv.getContext('2d')!.drawImage(sprite('hero', cls.palette), 0, 0);
      list.append(h('li', { class: 'char-card' }, cv,
        h('div', { class: 'info' },
          h('div', { class: 'name', text: c.name }),
          h('div', { class: 'muted', text: `${cls.name} · nível ${c.level}` }),
          h('div', { class: 'muted', text: `Andar mais profundo: ${c.maxFloor || '—'}` }),
        ),
        h('div', { class: 'actions' },
          h('button', { class: 'btn gold', onclick: () => onPlay(c.id) }, 'Jogar'),
          h('button', {
            class: 'btn ghost small', 'aria-label': `Excluir ${c.name}`,
            onclick: async () => {
              if (!confirm(`Excluir ${c.name} para sempre? Esta ação não pode ser desfeita.`)) return;
              try { await api(`/api/characters/${c.id}`, undefined, 'DELETE'); render(); } catch (err) { alert((err as Error).message); }
            },
          }, 'Excluir'),
        ),
      ));
    }
    if (chars.length < MAX_CHARACTERS) {
      list.append(h('li', null, h('button', { class: 'char-card empty', style: { width: '100%' }, onclick: () => { createBox.hidden = false; $<HTMLInputElement>('#create-name').focus(); } }, '+ Criar novo herói')));
    }
  };

  $<HTMLButtonElement>('#btn-cancel-create').onclick = () => { createBox.hidden = true; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('#create-name').value.trim();
    const classId = (form.querySelector('input[name=cls]:checked') as HTMLInputElement | null)?.value;
    if (!/^[A-Za-zÀ-ÿ0-9_]{3,16}$/.test(name)) return setError(form, 'Nome: 3 a 16 letras, números ou _.');
    busy(form, true);
    try {
      await api('/api/characters', { name, classId });
      setError(form, '');
      form.reset();
      createBox.hidden = true;
      render();
    } catch (err) { setError(form, (err as Error).message); } finally { busy(form, false); }
  };
  await render();
}
