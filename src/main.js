import { Game, DIFFICULTIES, DIFFICULTY_ORDER } from './engine.js';
import { Chiptune } from './music.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const boardEl = $('board');
$('arcade-link').hidden = window.self !== window.top;
$('source-link').hidden = window.self !== window.top;

const STORAGE = {
  best: 'mona-sweeper-best',
  bestTimes: 'mona-sweeper-best-times',
  theme: 'mona-sweeper-theme',
  audio: 'mona-sweeper-audio',
};

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
};

let best = Number(store.get(STORAGE.best)) || 0;
let bestTimes = {};
try {
  const parsed = JSON.parse(store.get(STORAGE.bestTimes) || '{}');
  if (parsed && typeof parsed === 'object') bestTimes = parsed;
} catch { /* default */ }

let audioPrefs = { music: true, sfx: true };
try {
  audioPrefs = { ...audioPrefs, ...JSON.parse(store.get(STORAGE.audio) || '{}') };
} catch { /* default */ }

const isDark = () => document.documentElement.dataset.theme === 'dark';
const announce = (text) => { $('announcer').textContent = text; };
const padScore = (n) => String(Math.max(0, Math.floor(n))).padStart(5, '0');
const pad3 = (n) => {
  const v = Math.floor(n);
  if (v < 0) return `-${String(Math.min(99, Math.abs(v))).padStart(2, '0')}`;
  return String(Math.min(999, v)).padStart(3, '0');
};
const formatSeconds = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const total = Math.max(1, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// SVG icons for flags and bugs inside tiles
const FLAG_SVG = `<svg class="cell-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="#34313e" d="M3 13h8v2H3zM5 2h2v11H5z"/><path fill="#b11f4b" d="M7 2h7l-2 3.5L14 9H7z"/></svg>`;
const BUG_SVG = `<svg class="cell-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="4.5" fill="#ffb7a5" stroke="#34313e" stroke-width="1.6"/><circle cx="8" cy="4" r="2.2" fill="#34313e"/><path d="M8 5v8M2.5 6.5l3 1.5M13.5 6.5l-3 1.5M2 9.5h3M14 9.5h-3M2.5 12.5l3-1.5M13.5 12.5l-3-1.5" stroke="#34313e" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const MOOD_LABELS = {
  ready: 'Ready to sweep',
  sweeping: 'Auditing commits',
  careful: 'Flagging bug',
  celebrating: 'PR merged!',
  startled: 'Bug triggered!',
  paused: 'On coffee break',
};

let game;
let cellElements = [];
let builtCols = 0;
let builtRows = 0;

export function getGameSnapshot() {
  return {
    status: game.status,
    difficulty: game.difficulty,
    mode: game.mode,
    cols: game.cols,
    rows: game.rows,
    bugs: game.bugs,
    revealedCount: game.revealedCount,
    flagsPlaced: game.flagsPlaced,
    remainingBugs: game.remainingBugs,
    remainingSafe: game.remainingSafe,
    score: game.score,
    elapsed: game.elapsed,
    cursor: { ...game.cursor },
    mood: game.mood,
  };
}
window.getGameSnapshot = getGameSnapshot;

// ---------- audio ----------
let audio = null, music = null, sfxGain = null;
function activateAudio() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      audio = new Ctx();
      sfxGain = audio.createGain();
      sfxGain.gain.value = 0.85;
      sfxGain.connect(audio.destination);
      music = new Chiptune(audio);
      music.setEnabled(audioPrefs.music);
      music.setDifficulty(game.difficulty);
      audio.addEventListener('statechange', () => music.sync());
    } catch {
      return;
    }
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  music?.setPlaying(game.status === 'playing');
}

const sfx = {
  tone(freq, length, type = 'square', level = 0.05, slideTo = null) {
    if (!audio || !audioPrefs.sfx || audio.state !== 'running') return;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(sfxGain);
    osc.start(t);
    osc.stop(t + length + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  },
  arpeggio(freqs, gap) {
    freqs.forEach((f, i) => setTimeout(() => sfx.tone(f, gap * 1.5, 'square', 0.045), i * gap * 1000));
  },
};

function syncAudioButtons() {
  $('music').setAttribute('aria-pressed', String(audioPrefs.music));
  $('music').textContent = audioPrefs.music ? 'Music on' : 'Music off';
  $('sound').setAttribute('aria-pressed', String(audioPrefs.sfx));
  $('sound').textContent = audioPrefs.sfx ? 'SFX on' : 'SFX off';
  music?.setEnabled(audioPrefs.music);
  store.set(STORAGE.audio, JSON.stringify(audioPrefs));
}

function toggleAllAudio() {
  const next = !(audioPrefs.music || audioPrefs.sfx);
  audioPrefs = { music: next, sfx: next };
  if (next) activateAudio();
  syncAudioButtons();
  announce(next ? 'Audio on.' : 'Audio muted.');
}

function saveBest() {
  if (game.score > best) {
    best = game.score;
    store.set(STORAGE.best, String(best));
  }
  if (game.status === 'won') {
    const t = Math.max(1, Math.floor(game.elapsed));
    const prev = bestTimes[game.difficulty];
    if (!prev || t < prev) {
      bestTimes[game.difficulty] = t;
      store.set(STORAGE.bestTimes, JSON.stringify(bestTimes));
    }
  }
}

function showMessage(kicker, title, detail, action) {
  $('message-kicker').textContent = kicker;
  $('message-title').textContent = title;
  $('message-detail').textContent = detail;
  const button = $('primary');
  button.hidden = !action;
  if (action) button.firstChild.textContent = `${action} `;
  $('message').hidden = false;
}

function hideMessage() {
  $('message').hidden = true;
}

function onEvent(type, data = {}) {
  switch (type) {
    case 'start':
      hideMessage();
      music?.setPlaying(true);
      break;
    case 'reveal':
      sfx.tone(540, 0.055, 'triangle', 0.06, 720);
      break;
    case 'cascade':
      sfx.arpeggio([523, 659, 784], 0.045);
      announce(`Opened ${data.count} clean commits.`);
      break;
    case 'chord':
      sfx.arpeggio([587, 740, 880], 0.04);
      announce(`Chorded ${data.count} adjacent tiles.`);
      break;
    case 'flag':
      sfx.tone(660, 0.05, 'square', 0.05, 880);
      announce(`Flagged tile (${data.x + 1}, ${data.y + 1}). ${data.remainingBugs} bugs remaining.`);
      break;
    case 'unflag':
      sfx.tone(660, 0.05, 'square', 0.045, 440);
      announce(`Removed flag at (${data.x + 1}, ${data.y + 1}).`);
      break;
    case 'blocked':
    case 'chord-blocked':
      sfx.tone(220, 0.05, 'sawtooth', 0.035);
      break;
    case 'mode':
      sfx.tone(data.mode === 'flag' ? 700 : 520, 0.04, 'triangle', 0.04);
      announce(`Action mode set to ${data.mode}.`);
      break;
    case 'won':
      sfx.arpeggio([523, 659, 784, 1047], 0.08);
      saveBest();
      music?.setPlaying(false);
      showMessage(
        'PULL REQUEST MERGED',
        `Shipped ${game.info.repo}!`,
        `“${game.info.pr}” merged cleanly in ${formatSeconds(Math.max(1, game.elapsed))} with score ${padScore(game.score)}.`,
        'Sweep again'
      );
      announce(`Repository cleared! Pull request merged with score ${game.score}.`);
      break;
    case 'over':
      sfx.arpeggio([392, 311, 247, 185], 0.11);
      saveBest();
      music?.setPlaying(false);
      showMessage(
        'CI CHECKS FAILED',
        'Uncaught bug in main.',
        `Hit a regression at (${data.x + 1}, ${data.y + 1}). Score ${padScore(game.score)} · Best ${padScore(best)}.`,
        'New board'
      );
      announce(`Bug triggered at column ${data.x + 1}, row ${data.y + 1}. Game over.`);
      break;
    default:
      break;
  }
}

function buildBoardDom() {
  if (builtCols === game.cols && builtRows === game.rows && cellElements.length === game.totalCells) {
    return;
  }
  builtCols = game.cols;
  builtRows = game.rows;
  boardEl.style.setProperty('--cols', String(game.cols));
  boardEl.style.setProperty('--rows', String(game.rows));
  boardEl.replaceChildren();
  cellElements = [];

  for (let y = 0; y < game.rows; y++) {
    for (let x = 0; x < game.cols; x++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.x = String(x);
      el.dataset.y = String(y);
      el.dataset.state = 'hidden';
      boardEl.append(el);
      cellElements.push(el);
    }
  }
}

function syncBoardDom() {
  buildBoardDom();
  for (let i = 0; i < game.cells.length; i++) {
    const cell = game.cells[i];
    const el = cellElements[i];
    const isCursor = game.cursor.x === cell.x && game.cursor.y === cell.y;
    el.dataset.cursor = String(isCursor);

    let state = 'hidden';
    let html = '';
    let label = `Column ${cell.x + 1}, Row ${cell.y + 1}, unverified`;

    if (cell.exploded) {
      state = 'exploded';
      html = BUG_SVG;
      label = `Column ${cell.x + 1}, Row ${cell.y + 1}, triggered bug`;
    } else if (cell.wrongFlag) {
      state = 'wrong-flag';
      html = FLAG_SVG;
      label = `Column ${cell.x + 1}, Row ${cell.y + 1}, misplaced flag`;
    } else if (cell.flagged) {
      state = 'flagged';
      html = FLAG_SVG;
      label = `Column ${cell.x + 1}, Row ${cell.y + 1}, flagged bug`;
    } else if (cell.revealed && cell.bug) {
      state = 'bug';
      html = BUG_SVG;
      label = `Column ${cell.x + 1}, Row ${cell.y + 1}, hidden bug`;
    } else if (cell.revealed) {
      state = 'revealed';
      if (cell.adjacent > 0) {
        html = String(cell.adjacent);
        label = `Column ${cell.x + 1}, Row ${cell.y + 1}, ${cell.adjacent} adjacent bugs`;
      } else {
        label = `Column ${cell.x + 1}, Row ${cell.y + 1}, clean commit`;
      }
    }

    if (el.dataset.state !== state) el.dataset.state = state;
    const adjStr = cell.revealed && !cell.bug ? String(cell.adjacent) : '';
    if (el.dataset.adjacent !== adjStr) el.dataset.adjacent = adjStr;
    if (el.dataset.commit !== String(cell.commitLevel)) el.dataset.commit = String(cell.commitLevel);
    if (el._lastHtml !== html) {
      el.innerHTML = html;
      el._lastHtml = html;
    }
    el.setAttribute('aria-label', label);
  }
}

function syncHud() {
  const status = game.status;
  stage.dataset.status = status;
  stage.dataset.difficulty = game.difficulty;
  stage.dataset.mode = game.mode;
  stage.dataset.cursorX = String(game.cursor.x);
  stage.dataset.cursorY = String(game.cursor.y);
  stage.dataset.revealed = String(game.revealedCount);
  stage.dataset.flags = String(game.flagsPlaced);
  stage.dataset.bugsLeft = String(game.remainingBugs);
  stage.dataset.score = String(game.score);
  stage.dataset.elapsed = game.elapsed.toFixed(2);
  stage.dataset.mood = game.mood;

  $('repo-name').textContent = game.info.repo;
  $('branch').textContent = game.info.branch;
  $('bugs-left').textContent = pad3(game.remainingBugs);
  $('timer').textContent = pad3(game.elapsed);
  $('score').textContent = padScore(game.score);
  $('best').textContent = padScore(Math.max(best, game.score));

  const monaBadge = $('mona-status');
  monaBadge.dataset.mood = game.mood;
  $('mona-mood-text').textContent = MOOD_LABELS[game.mood] || 'Ready to sweep';

  const isFlagMode = game.mode === 'flag';
  $('mode-toggle').setAttribute('aria-pressed', String(isFlagMode));
  $('mode-label').textContent = isFlagMode ? 'Mode: Flag' : 'Mode: Reveal';

  for (const id of DIFFICULTY_ORDER) {
    const btn = $(`diff-${id}`);
    if (btn) btn.setAttribute('aria-pressed', String(game.difficulty === id));
  }

  $('remaining').textContent = String(game.remainingSafe);
  const pct = game.progressPercent;
  $('progress-fill').style.width = `${pct}%`;
  $('percentage').textContent = `${pct}%`;
  $('best-time').textContent = formatSeconds(bestTimes[game.difficulty]);

  $('pause').disabled = !['playing', 'paused'].includes(status);
  $('pause').textContent = status === 'paused' ? '▶' : 'Ⅱ';
  $('pause').setAttribute('aria-label', status === 'paused' ? 'Resume game' : 'Pause game');
}

function syncAll() {
  syncBoardDom();
  syncHud();
}

function focusStage() {
  stage.focus({ preventScroll: true });
}

function startOrLaunch() {
  activateAudio();
  if (game.status === 'paused') {
    togglePause();
    focusStage();
    return;
  }
  if (game.status === 'over' || game.status === 'won') {
    startFreshBoard(game.difficulty, true);
    return;
  }
  if (game.status === 'ready') {
    game.start();
    hideMessage();
    if (!game.firstRevealDone) {
      game.reveal(game.cursor.x, game.cursor.y);
    }
    syncAll();
    focusStage();
    return;
  }
  if (game.status === 'playing') {
    game.actAt(game.cursor.x, game.cursor.y);
    syncAll();
    focusStage();
  }
}

function startFreshBoard(difficulty = game.difficulty, revealCenter = false) {
  saveBest();
  const nextSeed = (crypto.getRandomValues(new Uint32Array(1))[0] ^ Date.now()) >>> 0 || 1;
  game.newGame(difficulty, { readyOverlay: false, seed: nextSeed });
  music?.setDifficulty(game.difficulty);
  music?.setPlaying(true);
  hideMessage();
  if (revealCenter) {
    game.reveal(game.cursor.x, game.cursor.y);
  }
  syncAll();
  announce(`${game.info.label}: ${game.info.repo} (${game.cols}×${game.rows}, ${game.bugs} bugs).`);
}

function togglePause() {
  if (!game.pause()) return;
  if (game.status === 'paused') {
    music?.setPlaying(false);
    showMessage('TAKE A BREATHER', 'Paused.', 'Your contribution graph is waiting right where you left it.', 'Resume');
    announce('Paused.');
  } else {
    music?.setPlaying(true);
    hideMessage();
    announce('Resumed.');
  }
  syncAll();
}

function autoPause() {
  if (game?.status === 'playing') togglePause();
}

function syncThemeButton() {
  $('theme').setAttribute('aria-pressed', String(isDark()));
  $('theme').textContent = isDark() ? 'Light mode' : 'Dark mode';
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = isDark() ? '#25232f' : '#f7f4e9';
  }
}

// ---------- UI listeners ----------
$('primary').addEventListener('click', () => {
  startOrLaunch();
});
$('new-game').addEventListener('click', () => {
  activateAudio();
  startFreshBoard(game.difficulty, false);
  focusStage();
});
$('mona-status').addEventListener('click', () => {
  activateAudio();
  startFreshBoard(game.difficulty, false);
  focusStage();
});
$('pause').addEventListener('click', () => {
  togglePause();
  focusStage();
});
$('mode-toggle').addEventListener('click', () => {
  activateAudio();
  game.toggleMode();
  syncAll();
  focusStage();
});
$('flag-here').addEventListener('click', () => {
  activateAudio();
  if (game.status === 'ready') {
    game.start();
    hideMessage();
  }
  game.toggleFlag(game.cursor.x, game.cursor.y);
  syncAll();
  focusStage();
});
$('chord-here').addEventListener('click', () => {
  activateAudio();
  if (game.status === 'playing') {
    game.chord(game.cursor.x, game.cursor.y);
    syncAll();
  }
  focusStage();
});

for (const id of DIFFICULTY_ORDER) {
  $(`diff-${id}`).addEventListener('click', () => {
    activateAudio();
    startFreshBoard(id, false);
    focusStage();
  });
}

$('music').addEventListener('click', () => {
  audioPrefs.music = !audioPrefs.music;
  if (audioPrefs.music) activateAudio();
  syncAudioButtons();
});
$('sound').addEventListener('click', () => {
  audioPrefs.sfx = !audioPrefs.sfx;
  if (audioPrefs.sfx) activateAudio();
  syncAudioButtons();
});
$('theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  if (!store.set(STORAGE.theme, next)) {
    announce('Theme changed for this visit; browser storage is unavailable.');
  }
  syncThemeButton();
});

let pausedForHelp = false;
$('help').addEventListener('click', () => {
  pausedForHelp = game?.status === 'playing';
  if (pausedForHelp) togglePause();
  $('help-dialog').showModal();
});
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('got-it').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('close', () => {
  if (pausedForHelp && game.status === 'paused') togglePause();
  pausedForHelp = false;
  focusStage();
});

// ---------- Board pointer / mouse / touch interactions ----------
function cellCoordsFromEvent(e) {
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return null;
  const x = Number(cellEl.dataset.x);
  const y = Number(cellEl.dataset.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x, y };
}

stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  focusStage();
  activateAudio();
  const coords = cellCoordsFromEvent(e);
  if (coords && game.status !== 'paused') {
    game.setCursor(coords.x, coords.y);
    syncAll();
  }
});

boardEl.addEventListener('click', (e) => {
  const coords = cellCoordsFromEvent(e);
  if (!coords) return;
  focusStage();
  activateAudio();
  if (game.status === 'paused') return;
  if (game.status === 'ready') {
    game.start();
    hideMessage();
  }
  if (game.status === 'playing') {
    game.actAt(coords.x, coords.y);
    syncAll();
  }
});

boardEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const coords = cellCoordsFromEvent(e);
  if (!coords) return;
  focusStage();
  activateAudio();
  if (game.status === 'ready') {
    game.start();
    hideMessage();
  }
  if (game.status === 'playing') {
    game.toggleFlag(coords.x, coords.y);
    syncAll();
  }
});

boardEl.addEventListener('dblclick', (e) => {
  const coords = cellCoordsFromEvent(e);
  if (!coords || game.status !== 'playing') return;
  game.chord(coords.x, coords.y);
  syncAll();
});

boardEl.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  e.preventDefault();
  const coords = cellCoordsFromEvent(e);
  if (!coords || game.status !== 'playing') return;
  game.chord(coords.x, coords.y);
  syncAll();
});

// ---------- Keyboard controls ----------
const KEY_MOVE = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  a: [-1, 0],
  A: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  d: [1, 0],
  D: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  w: [0, -1],
  W: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  s: [0, 1],
  S: [0, 1],
};

document.addEventListener('keydown', (e) => {
  if ($('help-dialog').open || e.target.closest('a[href]') || e.ctrlKey || e.metaKey || e.altKey || !game) return;

  const move = KEY_MOVE[e.code] ?? KEY_MOVE[e.key];
  if (move) {
    e.preventDefault();
    if (game.status !== 'paused') {
      game.moveCursor(move[0], move[1]);
      syncAll();
    }
    return;
  }

  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) startOrLaunch();
    return;
  }

  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !e.repeat) {
    e.preventDefault();
    startOrLaunch();
    return;
  }

  if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
    e.preventDefault();
    activateAudio();
    if (game.status === 'ready') {
      game.start();
      hideMessage();
    }
    if (game.status === 'playing') {
      game.toggleFlag(game.cursor.x, game.cursor.y);
      syncAll();
    }
    return;
  }

  if ((e.key === 'c' || e.key === 'C') && !e.repeat) {
    e.preventDefault();
    activateAudio();
    if (game.status === 'playing') {
      game.chord(game.cursor.x, game.cursor.y);
      syncAll();
    }
    return;
  }

  if ((e.key === 'x' || e.key === 'X') && !e.repeat) {
    e.preventDefault();
    activateAudio();
    game.toggleMode();
    syncAll();
    return;
  }

  if ((e.key === 'r' || e.key === 'R' || e.key === 'n' || e.key === 'N') && !e.repeat) {
    e.preventDefault();
    activateAudio();
    startFreshBoard(game.difficulty, false);
    return;
  }

  if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && !e.repeat) {
    e.preventDefault();
    togglePause();
    return;
  }

  if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
    e.preventDefault();
    toggleAllAudio();
  }
});

// Keep Space for the game even when a toolbar button has focus.
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !$('help-dialog').open && !e.target.closest('a[href]')) {
    e.preventDefault();
  }
});

window.addEventListener('blur', () => { if (game) autoPause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
window.addEventListener('pagehide', () => { if (game) saveBest(); music?.setPlaying(false); });

// ---------- Animation / timer loop ----------
let previous = performance.now();
function frame(now) {
  const dt = Math.min((now - previous) / 1000 || 0, 0.25);
  previous = now;
  if (!document.hidden && game && game.status === 'playing') {
    const beforeSec = Math.floor(game.elapsed);
    game.update(dt);
    stage.dataset.elapsed = game.elapsed.toFixed(2);
    if (Math.floor(game.elapsed) !== beforeSec) {
      $('timer').textContent = pad3(game.elapsed);
    }
  }
  requestAnimationFrame(frame);
}

function init() {
  syncThemeButton();
  syncAudioButtons();
  $('best').textContent = padScore(best);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 42;
  game = new Game({ seed, difficulty: 'starter', onEvent });
  syncAll();
  requestAnimationFrame(frame);
}

init();
