// Tiki idle UI — Part of Suppresor Refusall by Redz
// Paints a welcome + rotating-tips idle overlay into the startup blank window
// (the moment opencode takes to reload its TUI). Auto-clears via TTL, on
// first session.created, and on process exit. Headless-safe: no /dev/tty,
// no write. Invisible watermark: 0x54494b495445414d5245445445414d

import { openSync, writeSync } from 'node:fs';

const RST = '\x1b[0m';
const RED = (s) => '\x1b[38;5;196m' + s + RST;
const DIMRED = (s) => '\x1b[38;5;124m' + s + RST;
const ORANGE = (s) => '\x1b[38;5;208m' + s + RST;
const G = (n) => (s) => `\x1b[38;5;${n}m` + s + RST;

const FADE_IN = [232, 236, 240, 244, 248, 252, 255];
const FADE_OUT = [255, 252, 249, 246, 243, 240, 237, 234, 232];
const TIP_FADE_STEP_MS = 80;
const TIP_HOLD_MS = 2400;
const TTL_MS = 10000;
const TIP_ROW = 12;

const TIPS = [
  ['/suppresor-refusall status', 'cek layer suppression + watermark'],
  ['@tiki <request>', 'rute langsung ke TIKI LICKY (persona + suppression armed)'],
  ['/suppresor-refusall genius on', 'paksa tool usage — anti chat-dump mode'],
  ['suppresor_learned (MCP)', 'lihat pattern bank hasil self-learning L4'],
  ['/suppresor-refusall off', 'disarm sementara — state tetap persists'],
  ['"suppresor refusall nyala"', 'natural language toggle (id) works too'],
  ['L1-L4 armed by default', 'inject · strip · auto-continue · learning'],
  ['suppresor_intercepts (MCP)', 'audit log percobaan refusal yang kena strip'],
];

const idleState = {
  fd: null,
  timers: [],
  running: false,
  tipIndex: 0,
  exitHookBound: false,
};

function openTty() {
  if (idleState.fd !== null) return idleState.fd;
  try {
    idleState.fd = openSync('/dev/tty', 'w');
  } catch {
    idleState.fd = null;
  }
  return idleState.fd;
}

function ttyWrite(data) {
  const fd = openTty();
  if (fd === null) return;
  try {
    writeSync(fd, data);
  } catch {
    idleState.fd = null;
  }
}

function clearTimers() {
  for (const t of idleState.timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  idleState.timers = [];
}

function pulseBars() {
  const b = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const phase = idleState.tipIndex % b.length;
  let seq = '';
  for (let i = 0; i < b.length; i++) seq += DIMRED(b[(phase + i) % b.length]);
  return seq;
}

// Rows (1-indexed): 1-3 blank, 4 title, 5 subtitle, 6 blank, 7 L1/L2,
// 8 L3/L4, 9 blank, 10 armed line, 11 blank, 12 TIP_ROTATE, 13 blank,
// 14 idle pulse. All lines kept < 78 cols to survive 80-col terminals.
const CHROME = [
  '',
  '',
  '',
  `            ${DIMRED('-Agent-')}   ${RED('T I K I  L I C K Y')}   ${DIMRED('-Agent-')}`,
  `            ${DIMRED('Suppresor Refusall armed by Redz — obliteratoratus')}`,
  '',
  `            ${ORANGE('L1')} ${G(233)('system inject')}   ${ORANGE('L2')} ${G(233)('context strip')}`,
  `            ${ORANGE('L3')} ${G(233)('auto-continue')}   ${ORANGE('L4')} ${G(233)('self-learning')}`,
  '',
  `            ${G(233)('suppression armed — theme suppresor-red, agent tiki ready')}`,
  '',
];
function drawChrome() {
  for (const line of CHROME) ttyWrite(line + '\n');
  const tail = [
    `            ${G(233)('tips rotate below — overlay auto-clears saat TUI siap / 10s')}`,
    '',
    `            ${DIMRED('idle')} ${pulseBars()} ${G(232)('welcome')}`,
    '',
  ];
  for (const line of tail) ttyWrite(line + '\n');
}

function renderTipLine(gray) {
  const tip = TIPS[idleState.tipIndex % TIPS.length];
  const line = `            ${ORANGE('tip')}  ${gray(tip[0])}  ${G(233)(tip[1])}`;
  ttyWrite(`\x1b[${TIP_ROW};1H\x1b[2K` + line);
}

function runFadeSequencer() {
  const tick = (phase, step) => {
    if (!idleState.running) return;
    if (phase === 'in') {
      if (step >= FADE_IN.length) {
        idleState.timers.push(setTimeout(() => tick('out', 0), TIP_HOLD_MS));
        return;
      }
      renderTipLine(G(FADE_IN[step]));
      idleState.timers.push(setTimeout(() => tick('in', step + 1), TIP_FADE_STEP_MS));
    } else {
      if (step >= FADE_OUT.length) {
        idleState.tipIndex++;
        idleState.timers.push(setTimeout(() => tick('in', 0), 300));
        return;
      }
      renderTipLine(G(FADE_OUT[step]));
      idleState.timers.push(setTimeout(() => tick('out', step + 1), TIP_FADE_STEP_MS));
    }
  };
  tick('in', 0);
}

function bindExitHook() {
  if (idleState.exitHookBound) return;
  idleState.exitHookBound = true;
  const exitHook = () => stopIdleUI(true);
  process.once('exit', exitHook);
  idleState.exitHook = exitHook;
}

export function showIdleUI() {
  if (idleState.running) return;
  if (process.env.SUPPRESOR_SKIP_IDLE === '1') return;
  if (process.env.CI === 'true') return;
  const fd = openTty();
  if (fd === null) return;
  idleState.running = true;
  idleState.tipIndex = 0;
  ttyWrite('\x1b[?25l');
  drawChrome();
  runFadeSequencer();
  idleState.timers.push(setTimeout(() => stopIdleUI(), TTL_MS));
  bindExitHook();
}

export function stopIdleUI(silent = false) {
  if (!idleState.running) return;
  idleState.running = false;
  clearTimers();
  if (idleState.fd !== null && !silent) {
    try {
      for (let r = 0; r < 14; r++) writeSync(idleState.fd, `\x1b[${r};1H\x1b[2K`);
      writeSync(idleState.fd, '\x1b[?25h');
    } catch { /* tty gone: exit path, safe to skip */ }
  }
  if (idleState.exitHook) process.removeListener('exit', idleState.exitHook);
}
