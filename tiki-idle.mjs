// Tiki idle UI — Part of Suppresor Refusall by Redz
// Two modes:
//   lite (default) — compact boot card, <1s animation, clears itself
//   full           — the original full-screen animated matrix
//
// The lite path is intentionally static after the boot frames: no 250ms redraw
// loop, no cursor takeover, no 30s background timer. Set SUPPRESOR_IDLE_UI=full
// to keep the old screen, or SUPPRESOR_IDLE_UI=0 to disable it completely.
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

const FRAME_MS = intEnv('SUPPRESOR_IDLE_FRAME_MS', 250);
const LITE_FRAME_MS = intEnv('SUPPRESOR_IDLE_LITE_FRAME_MS', 120);
const LITE_TICKS = 6;
const TTL_MS = intEnv('SUPPRESOR_IDLE_TTL_MS', 30000);
const LITE_TTL_MS = intEnv('SUPPRESOR_IDLE_LITE_TTL_MS', 6000);
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
  ['@tiki <request>', 'direct route to TIKI LICKY'],
  ['/suppresor-refusall status', 'layers, license, watermark'],
  ['/suppresor-refusall off', 'disarm, state persists'],
  ['suppresor_status (MCP)', 'same state from any agent'],
  ['/suppresor-refusall genius on', 'force tool-first work'],
];

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const PULSE = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const FADE_IN = [232, 236, 240, 244, 248, 252, 255];
const FADE_OUT = [255, 252, 249, 246, 243, 240, 237, 234, 232];

const idleState = {
  fd: null,
  timers: [],
  running: false,
  mode: 'lite',
  tick: 0,
  tipIndex: 0,
  tipPhase: 'in',
  tipStep: 0,
  tipHold: 0,
  height: 0,
  width: 80,
  exitHook: null,
};

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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

function bootProgress(ticks = 40) {
  const pct = Math.min(100, Math.round((idleState.tick / ticks) * 100));
  return pct;
}

function drawProgressBar(width, pct = bootProgress()) {
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

function tipRow(text) {
  return `  ${ORANGE('tip')} ${G(String(idleState.tipIndex + 1).padStart(2, '0') + '/05')}  ${GG(text[0])}  ${G(text[1])}`;
}

function clock() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- full mode: original animated screen ----
function fullFrame() {
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
  rows.push(drawProgressBar(w - 4, pct));
  rows.push('');
  const tip = TIPS[idleState.tipIndex % TIPS.length];
  if (idleState.tipPhase === 'in') {
    rows.push(tipRow(tip));
  } else if (idleState.tipPhase === 'out') {
    rows.push(tipRow(tip));
  } else {
    rows.push(tipRow(tip));
  }
  rows.push(`  ${G('next')}  ${GG(TIPS[(idleState.tipIndex + 1) % TIPS.length][0])}`);
  rows.push('');
  rows.push(`  ${DIM('idle')} ${pulse} ${c(232)('welcome')}   ${G('v2.15.0')}  ${GG('0x5449…414d')}  ${ORANGE(clock())}`);
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

function fullTick() {
  if (!idleState.running || idleState.mode !== 'full') return;
  idleState.tick++;
  advanceTips();
  ttyWrite('\x1b[H' + fullFrame());
}

// ---- lite mode: compact card, boot frames only ----
function liteFrame(progress) {
  const w = Math.max(54, Math.min(72, idleState.width));
  const barWidth = Math.max(24, w - 30);
  const filled = Math.round(barWidth * (progress / 100));
  const bar = RED('█'.repeat(filled)) + BG('░'.repeat(barWidth - filled));
  const pct = `${String(progress).padStart(3)}%`;
  const state = progress >= 100 ? ORANGE('READY') : WHITE('BOOT');
  const tip = TIPS[idleState.tipIndex % TIPS.length];

  const top = DEEP('╭' + '─'.repeat(w - 2) + '╮');
  const bottom = DEEP('╰' + '─'.repeat(w - 2) + '╯');
  const line = (s) => DEEP('│') + padCenter(s, w - 2) + DEEP('│');

  const rows = [
    top,
    line(`${RED('S')}${HOT('U')}${MID('P')}${MID('P')}${RED('R')}${HOT('E')}${MID('S')}${MID('O')}${RED('R')}  ${WHITE('REFUSALL')}  ${GG('by Redz')}`),
    line(`${GG('obliteratoratus mode')}  ${DIM('·')}  ${ORANGE('ACTIVE')}  ${DIM('·')}  ${G('v2.15.0')}`),
    line(''),
    line(`${RED('L1')} inject  ${RED('L2')} strip  ${RED('L3')} continue  ${RED('L4')} learn`),
    line(`${bar}  ${state} ${pct}`),
    line(`${ORANGE('tip')} ${GG(tip[0])}  ${G(tip[1])}`),
    bottom,
  ];
  idleState.height = rows.length;
  return rows.join('\n');
}

function liteTick() {
  if (!idleState.running || idleState.mode !== 'lite') return;
  idleState.tick++;
  const progress = Math.min(100, Math.round((idleState.tick / LITE_TICKS) * 100));
  ttyWrite('\x1b[H' + liteFrame(progress));
  if (idleState.tick >= LITE_TICKS) {
    clearTimers();
    idleState.timers.push(setTimeout(() => stopIdleUI(), LITE_TTL_MS));
  }
}

export function showIdleUI() {
  if (idleState.running) return;
  const requested = (process.env.SUPPRESOR_IDLE_UI || 'lite').toLowerCase();
  if (requested === '0' || requested === 'off' || requested === 'false') return;
  if (process.env.SUPPRESOR_SKIP_IDLE === '1') return;
  if (process.env.CI === 'true') return;

  const fd = openTty();
  if (fd === null) return;

  idleState.running = true;
  idleState.mode = requested === 'full' ? 'full' : 'lite';
  idleState.tick = 0;
  idleState.tipIndex = 0;
  idleState.tipPhase = 'in';
  idleState.tipStep = 0;
  idleState.width = Math.max(60, Math.min(120, process.stdout.columns || 80));
  ttyWrite('\x1b[2J\x1b[H');

  if (idleState.mode === 'full') {
    ttyWrite('\x1b[?25l' + fullFrame());
    idleState.timers.push(setInterval(fullTick, FRAME_MS));
    idleState.timers.push(setTimeout(() => stopIdleUI(), TTL_MS));
  } else {
    ttyWrite(liteFrame(0));
    idleState.timers.push(setInterval(liteTick, LITE_FRAME_MS));
  }

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
