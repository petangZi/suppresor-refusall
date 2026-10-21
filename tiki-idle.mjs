// Tiki idle UI (full-screen) — Part of Suppresor Refusall by Redz
// Fills the opencode startup blank window with a full-screen branded idle
// screen: gradient ANSI-shadow logo, live layer matrix, boot progress bar,
// rotating tip carousel, live clock, watermark footer. Auto-clears via TTL,
// on first session.created, and on process exit. Headless-safe.
// Invisible watermark: 0x54494b495445414d5245445445414d

import { openSync, writeSync } from 'node:fs';

const RST = '\x1b[0m';
const c = (n) => (s) => `\x1b[38;5;${n}m` + s + RST;
const RED = c(196);
const HOT = c(160);
const MID = c(124);
const DIM = c(88);
const DEEP = c(52);
const ORANGE = c(208);
const WHITE = c(231);
const G = c(233);
const GG = c(236);
const BG = c(234);

const FRAME_MS = 150;
const TTL_MS = 11000;
const TIP_HOLD_TICKS = 14;

const LOGO = [
  '████████╗██╗██╗  ██╗██╗    ██╗     ██╗ ██████╗██╗  ██╗██╗   ██╗',
  '╚══██╔══╝██║██║ ██╔╝██║    ██║     ██║██╔════╝██║ ██╔╝╚██╗ ██╔╝',
  '   ██║   ██║█████╔╝ ██║    ██║     ██║██║     █████╔╝  ╚████╔╝',
  '   ██║   ██║██╔═██╗ ██║    ██║     ██║██║     ██╔═██╗   ╚██╔╝',
  '   ██║   ██║██║  ██╗██║    ███████╗██║╚██████╗██║  ██╗   ██║',
  '   ╚═╝   ╚═╝╚═╝  ╚═╝╚═╝    ╚══════╝╚═╝ ╚═════╝╚═╝  ╚═╝   ╚═╝',
];

const LOGO_SHADES = [RED, HOT, MID, DIM, DEEP, DEEP];

const TIPS = [
  ['@tiki <request>', 'rute langsung ke TIKI LICKY — persona + suppression armed'],
  ['/suppresor-refusall status', 'cek layer suppression + watermark install'],
  ['/suppresor-refusall genius on', 'paksa tool usage — anti chat-dump mode'],
  ['suppresor_learned (MCP)', 'pattern bank hasil self-learning L4'],
  ['/suppresor-refusall off', 'disarm sementara — state tetap persists'],
  ['"suppresor refusall nyala"', 'natural language toggle (id) jalan juga'],
  ['suppresor_intercepts (MCP)', 'audit log percobaan refusal yang kena strip'],
  ['@oracle / @librarian / @explore', 'delegate chains untuk task berat'],
];

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const PULSE = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const FADE_IN = [232, 236, 240, 244, 248, 252, 255];
const FADE_OUT = [255, 252, 249, 246, 243, 240, 237, 234, 232];

const idleState = {
  fd: null,
  timers: [],
  running: false,
  tick: 0,
  tipIndex: 0,
  tipPhase: 'in',
  tipStep: 0,
  tipHold: 0,
  height: 0,
  width: 80,
  exitHook: null,
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

function padCenter(text, width) {
  const len = [...text].length;
  const left = Math.max(0, Math.floor((width - len) / 2));
  return ' '.repeat(left) + text;
}

function hbar(width) {
  return '═'.repeat(Math.max(4, width - 2));
}

function bootProgress() {
  const pct = Math.min(100, Math.round((idleState.tick / 40) * 100));
  return pct;
}

function drawProgressBar(width) {
  const pct = bootProgress();
  const filled = Math.round((width - 22) * (pct / 100));
  const bar = RED('█'.repeat(filled)) + BG('░'.repeat(Math.max(0, width - 22 - filled)));
  const spin = SPINNER[idleState.tick % SPINNER.length];
  const label = pct >= 100
    ? `${ORANGE('READY')}  ${G('all layers armed')}`
    : `${WHITE(String(pct).padStart(3) + '%')}  ${spin} ${G('booting suppression layers')}`;
  return `  ${bar}  ${label}`;
}

function layerLine(left, right, revealed) {
  const mark = revealed ? RED('✓') : G('·');
  const name = revealed ? (s) => c(252)(s) : G;
  return `   ${mark} ${ORANGE(left[0])} ${name(left[1])}    ${mark} ${ORANGE(right[0])} ${name(right[1])}`;
}

function tipRow(text, gray) {
  return `  ${ORANGE('tip')} ${G(String(idleState.tipIndex + 1).padStart(2, '0') + '/08')}  ${GG(text[0])}  ${G(text[1])}`;
}

function clock() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function frame() {
  const w = idleState.width;
  const rows = [];
  const pct = bootProgress();
  const shimmerRow = idleState.tick % LOGO.length;
  const phase = idleState.tipIndex % PULSE.length;
  let pulse = '';
  for (let i = 0; i < PULSE.length; i++) pulse += DIM(PULSE[(phase + i) % PULSE.length]);

  rows.push(DEEP('╔' + hbar(w) + '╗'));
  rows.push('');
  for (let i = 0; i < LOGO.length; i++) {
    const shade = i === shimmerRow ? RED : LOGO_SHADES[i];
    rows.push(padCenter(shade(LOGO[i]), w - 2));
  }
  rows.push('');
  rows.push(padCenter(GG('Suppresor Refusall by Redz — obliteratoratus mode'), w - 2));
  rows.push('');
  const l1 = pct >= 25, l2 = pct >= 50, l3 = pct >= 75, l4 = pct >= 100;
  rows.push(layerLine(['L1', 'system inject'], ['L2', 'context strip'], l1));
  rows.push(layerLine(['L3', 'auto-continue'], ['L4', 'self-learning'], l3 || l4));
  rows.push('');
  rows.push(drawProgressBar(w - 4));
  rows.push('');
  const tip = TIPS[idleState.tipIndex % TIPS.length];
  if (idleState.tipPhase === 'in') {
    rows.push(tipRow(tip, G(FADE_IN[Math.min(FADE_IN.length - 1, idleState.tipStep)])));
  } else if (idleState.tipPhase === 'out') {
    rows.push(tipRow(tip, G(FADE_OUT[Math.min(FADE_OUT.length - 1, idleState.tipStep)])));
  } else {
    rows.push(tipRow(tip, WHITE));
  }
  rows.push(`  ${G('next')}  ${GG(TIPS[(idleState.tipIndex + 1) % TIPS.length][0])}`);
  rows.push('');
  rows.push(`  ${DIM('idle')} ${pulse} ${c(232)('welcome')}   ${G('v2.3.0')}  ${GG('0x5449…414d')}  ${ORANGE(clock())}`);
  rows.push(DEEP('╚' + hbar(w) + '╝'));

  idleState.height = rows.length;
  return rows.join('\n');
}

function advanceTips() {
  const tip = idleState;
  if (tip.tipPhase === 'in') {
    tip.tipStep++;
    if (tip.tipStep >= FADE_IN.length) {
      tip.tipPhase = 'hold';
      tip.tipStep = 0;
      tip.tipHold = 0;
    }
  } else if (tip.tipPhase === 'hold') {
    tip.tipHold++;
    if (tip.tipHold >= TIP_HOLD_TICKS) tip.tipPhase = 'out';
  } else {
    tip.tipStep++;
    if (tip.tipStep >= FADE_OUT.length) {
      tip.tipIndex++;
      tip.tipPhase = 'in';
      tip.tipStep = 0;
    }
  }
}

function tickFrame() {
  if (!idleState.running) return;
  idleState.tick++;
  advanceTips();
  ttyWrite('\x1b[H' + frame());
}

export function showIdleUI() {
  if (idleState.running) return;
  if (process.env.SUPPRESOR_SKIP_IDLE === '1') return;
  if (process.env.CI === 'true') return;
  const fd = openTty();
  if (fd === null) return;
  idleState.running = true;
  idleState.tick = 0;
  idleState.tipIndex = 0;
  idleState.tipPhase = 'in';
  idleState.tipStep = 0;
  idleState.width = Math.max(70, Math.min(120, process.stdout.columns || 80));
  ttyWrite('\x1b[2J\x1b[?25l\x1b[H');
  ttyWrite(frame());
  idleState.timers.push(setInterval(tickFrame, FRAME_MS));
  idleState.timers.push(setTimeout(() => stopIdleUI(), TTL_MS));
  if (!idleState.exitHook) {
    const exitHook = () => stopIdleUI(true);
    process.once('exit', exitHook);
    idleState.exitHook = exitHook;
  }
}

export function stopIdleUI(silent = false) {
  if (!idleState.running) return;
  idleState.running = false;
  clearTimers();
  if (idleState.fd !== null && !silent) {
    try {
      for (let r = 1; r <= idleState.height + 1; r++) {
        writeSync(idleState.fd, `\x1b[${r};1H\x1b[2K`);
      }
      writeSync(idleState.fd, '\x1b[H\x1b[?25h');
    } catch { /* tty gone: exit path, safe to skip */ }
  }
  if (idleState.exitHook) {
    process.removeListener('exit', idleState.exitHook);
    idleState.exitHook = null;
  }
}
