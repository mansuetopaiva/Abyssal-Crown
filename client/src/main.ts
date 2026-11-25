import { api } from './api';
import { $, show } from './dom';
import { Game } from './game';
import { initAuth, showCharacters } from './ui/screens';

let game: Game | null = null;
let username = '';

function toAuth() {
  game?.close();
  game = null;
  show('screen-auth');
  $<HTMLInputElement>('#login-user').focus();
}

async function toChars() {
  game?.close();
  game = null;
  await showCharacters(username, play, toAuth);
}

function play(charId: number) {
  show('screen-game');
  game = new Game(charId);
  game.onExit = () => void toChars();
  game.connect();
}

async function boot() {
  initAuth(async (u) => { username = u; await toChars(); });
  try {
    const me = await api('/api/me');
    if (!me.user) return toAuth();
    username = me.user.username;
    await toChars();
  } catch {
    toAuth();
  }
}

void boot();
