import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// The real Commit Cabinet, pinned. Update deliberately after reviewing upstream changes.
export const cabinetSha = 'cdbd39c365f5daf50f47d06d10644d61d1572aaf';
export const cabinetRoot = resolve('.playwright-cabinet');
export const siteRoot = resolve('_site');
export const port = Number(process.env.CABINET_PORT || 4265);
export const origin = `http://127.0.0.1:${port}`;

// Used when the pinned cabinet predates the Mona Sweeper catalog entry.
export const fixtureEntry = {
  id: 'mona-sweeper',
  title: 'Mona Sweeper',
  description: 'Sweep the contribution graph. Flag hidden bugs. Ship a clean release.',
  category: 'Contribution-graph Minesweeper',
  url: '/mona-sweeper/',
  repository: 'https://github.com/jdooley-clt/mona-sweeper',
  art: './assets/mona-maze.png',
  accent: 'mint',
  controls: [
    { keys: 'Click / tap / Space / Enter', action: 'Reveal tile or perform active mode action' },
    { keys: 'Right-click / F / Mode: Flag', action: 'Flag or unflag a suspected bug' },
    { keys: 'Double-click / C / Chord', action: 'Chord adjacent tiles when flags match' },
    { keys: 'Arrows / WASD', action: 'Move grid cursor' },
    { keys: 'P / Esc', action: 'Pause or resume' },
    { keys: 'M', action: 'Mute or unmute audio' },
  ],
  instructions: 'Harness fixture entry.',
  viewport: { layout: 'document', height: 1060, mobileHeight: 1080 },
};

export function verifyCabinet() {
  const git = (...args) => execFileSync('git', ['-C', cabinetRoot, ...args], { encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== cabinetSha || git('status', '--porcelain')) {
    throw new Error(`Cabinet must be a clean checkout of ${cabinetSha}. Remove ${cabinetRoot} and run npm run cabinet:setup.`);
  }
}

export function candidateCatalog(original) {
  const catalog = structuredClone(original);
  const entry = catalog.find((game) => game.id === 'mona-sweeper');
  if (entry) entry.url = '/mona-sweeper/';
  else catalog.push(structuredClone(fixtureEntry));
  return catalog;
}
