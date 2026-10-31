import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { render, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import { palette, copy } from './theme';
import {
  activate,
  ageLabel,
  gateUrl,
  maskKey,
  probeGate,
  readDeviceId,
  readGateToken,
  readShadowUses,
  readSnapshot,
  remainingLabel,
  type GateHealth,
  type Snapshot,
} from './status';

const FREE_FALLBACK = 15;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const shortError = (message?: string) => {
  if (!message) return 'unknown';
  if (/unable to connect|connect/i.test(message)) return 'unreachable';
  return message.length > 28 ? `${message.slice(0, 27)}…` : message;
};

const toneOf = (snapshot: Snapshot) => {
  if (snapshot.blocked) return { label: 'BLOCKED', color: palette.bad };
  if (snapshot.allowed === false) return { label: 'PAUSED', color: palette.warn };
  if (snapshot.allowed) return { label: 'ACTIVE', color: palette.good };
  return { label: 'IDLE', color: palette.muted };
};

function Panel(props: { title: string; height: number; children: any }) {
  return (
    <box
      height={props.height}
      flexDirection="column"
      backgroundColor={palette.panel}
      border
      borderStyle="rounded"
      borderColor={palette.border}
      title={` ${props.title} `}
      titleColor={palette.muted}
      titleAlignment="left"
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
    </box>
  );
}

function Line(props: { label?: string; value: string; tone?: string }) {
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} height={1}>
      <text fg={palette.muted} wrapMode="none">{props.label ?? ''}</text>
      <text fg={props.tone ?? palette.text} wrapMode="none" truncate>{props.value}</text>
    </box>
  );
}

function Meter(props: { used: number; limit: number }) {
  const cells = () => Array.from({ length: props.limit }, (_, index) => index < props.used);
  const fill = () => {
    const left = props.limit - props.used;
    if (left <= 0) return palette.bad;
    if (left <= 3) return palette.warn;
    return palette.accent;
  };
  return (
    <box flexDirection="row" gap={0} height={1}>
      <For each={cells()}>
        {(filled) => <box width={2} height={1} backgroundColor={filled ? fill() : palette.borderSoft} />}
      </For>
    </box>
  );
}

function Chip(props: { keyName: string; label: string }) {
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <box backgroundColor={palette.panelAlt} paddingLeft={1} paddingRight={1}>
        <text fg={palette.text} attributes={1}>{props.keyName}</text>
      </box>
      <text fg={palette.muted}>{props.label}</text>
    </box>
  );
}

function Dashboard(props: { snapshot: Snapshot; gate: GateHealth; events: string[]; clock: number }) {
  const dimensions = useTerminalDimensions();
  const tone = () => toneOf(props.snapshot);
  const tier = () => (props.snapshot.tier ?? 'free').toUpperCase();
  const used = () => clamp(props.snapshot.uses ?? 0, 0, 999);
  const limit = () => {
    const fromToken = readGateToken()?.limit;
    return typeof fromToken === 'number' ? fromToken : FREE_FALLBACK;
  };
  const token = () => readGateToken();
  const device = () => readDeviceId();
  const stacked = () => dimensions().width < 104;
  const bodyHeight = () => Math.max(14, dimensions().height - 6);
  const leftTop = () => 9;
  const leftBottom = () => Math.max(8, bodyHeight() - leftTop() - 1);
  const rightTop = () => 8;
  const rightMid = () => 8;
  const rightBottom = () => Math.max(6, bodyHeight() - rightTop() - rightMid() - 2);
  const eventLines = () => props.events.slice(-Math.max(1, rightBottom() - 3));

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center" height={1} paddingLeft={1} paddingRight={1}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={palette.accent} attributes={1}>{copy.product}</text>
          <text fg={palette.muted}>{copy.productAlt}</text>
          <text fg={palette.faint}>{copy.tagline}</text>
        </box>
        <box flexDirection="row" gap={2} alignItems="center">
          <box backgroundColor={tone().color} paddingLeft={1} paddingRight={1}>
            <text fg={palette.bg} attributes={1}>{tone().label}</text>
          </box>
          <text fg={palette.faint}>{new Date(props.clock).toLocaleTimeString('en-GB')}</text>
        </box>
      </box>

      <box flexDirection={stacked() ? 'column' : 'row'} gap={1} height={bodyHeight()} paddingLeft={1} paddingRight={1}>
        <box flexDirection="column" gap={1} flexGrow={1} flexBasis={0}>
          <Panel title={`PLAN · ${tier()}`} height={leftTop()}>
            <text fg={tone().color} attributes={1} wrapMode="none" truncate>{tier()}</text>
            <text fg={palette.muted} wrapMode="none" truncate>{props.snapshot.message ?? 'waiting for first session'}</text>
            <Line label="origin" value={props.snapshot.origin ?? '—'} />
            <Line label="sync" value={props.snapshot.needsSync ? 'pending' : 'clean'} tone={props.snapshot.needsSync ? palette.warn : palette.text} />
            <Line label="checked" value={ageLabel(props.snapshot.checkedAt)} />
          </Panel>

          <Panel title={`USAGE · ${Math.max(limit() - used(), 0)} left`} height={leftBottom()}>
            <box flexDirection="row" alignItems="flex-end" gap={1} height={1}>
              <text fg={palette.text} attributes={1}>{String(used())}</text>
              <text fg={palette.faint}>{`/ ${limit()} sessions`}</text>
            </box>
            <Meter used={used()} limit={limit()} />
            <Line label="shadow" value={readShadowUses() === null ? '—' : String(readShadowUses())} />
            <Line label="remaining" value={props.snapshot.usesLeft === undefined ? '—' : String(props.snapshot.usesLeft)} />
          </Panel>
        </box>

        <box flexDirection="column" gap={1} flexGrow={1} flexBasis={0}>
          <Panel title="LICENSE" height={rightTop()}>
            <text fg={palette.text} attributes={1} wrapMode="none" truncate>{maskKey(props.snapshot.activation)}</text>
            <text fg={palette.muted} wrapMode="none" truncate>{props.snapshot.activation?.type ?? 'no activation'}</text>
            <Line label="valid" value={props.snapshot.blocked ? 'no' : props.snapshot.allowed ? 'yes' : 'unknown'} tone={props.snapshot.blocked ? palette.bad : palette.text} />
            <Line label="expires" value={remainingLabel(props.snapshot.activation?.exp)} />
            <Line label="device" value={device() ? `${device()!.slice(0, 8)}…` : '—'} />
          </Panel>

          <Panel title="GATEWAY" height={rightMid()}>
            <Line label="health" value={props.gate.ok ? `online · ${props.gate.latencyMs ?? 0}ms` : shortError(props.gate.error)} tone={props.gate.ok ? palette.good : palette.bad} />
            <text fg={palette.muted} wrapMode="none" truncate>{props.gate.url ?? 'disabled (local mode)'}</text>
            <Line label="token" value={String(token()?.tier ?? 'none')} />
            <Line label="token ttl" value={remainingLabel(token()?.exp)} />
            <Line label="free limit" value={String(props.gate.freeLimit ?? FREE_FALLBACK)} />
          </Panel>

          <Panel title="EVENTS" height={rightBottom()}>
            <For each={eventLines()}>
              {(line) => <text fg={palette.muted} wrapMode="none" truncate>{line}</text>}
            </For>
            <Show when={props.events.length === 0}>
              <text fg={palette.faint}>no events yet</text>
            </Show>
          </Panel>
        </box>
      </box>

      <box flexDirection="row" gap={2} height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <box flexDirection="row" gap={2}>
          <Chip keyName="F2" label="activate" />
          <Chip keyName="r" label="refresh" />
          <Chip keyName="g" label="gate" />
          <Chip keyName="q" label="quit" />
        </box>
        <text fg={palette.faint}>{gateUrl() ?? 'local'}</text>
      </box>
    </box>
  );
}

function ActivateView(props: {
  busy: boolean;
  result: string | null;
  onSubmit: (key: string) => void;
  onCancel: () => void;
}) {
  let inputEl: any = null;
  createEffect(() => {
    if (!props.busy) {
      inputEl?.focus?.();
      setTimeout(() => inputEl?.focus?.(), 80);
      setTimeout(() => inputEl?.focus?.(), 300);
    }
  });
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg} alignItems="center" justifyContent="center">
      <box
        flexDirection="column"
        width="72%"
        backgroundColor={palette.panel}
        border
        borderStyle="rounded"
        borderColor={palette.accentSoft}
        title=" activate license "
        titleColor={palette.accent}
        padding={2}
        gap={1}
      >
        <text fg={palette.text} attributes={1}>Paste your key</text>
        <text fg={palette.muted}>SRK1.… works offline. TTK-… is checked against the ledger.</text>
        <box height={1} />
        <input
          ref={(el: any) => { inputEl = el; el?.focus?.(); }}
          onKeyDown={(event: any) => {
            const name = String(event?.name ?? '').toLowerCase();
            if (name === 'escape' || name === 'esc') props.onCancel();
          }}
          focused={!props.busy}
          placeholder="SRK1.… or TTK-XXXX-XXXX-XXXX"
          width="100%"
          backgroundColor={palette.panelAlt}
          textColor={palette.text}
          cursorColor={palette.accent}
          onSubmit={(value) => props.onSubmit(typeof value === 'string' ? value : '')}
        />
        <Show when={props.busy}>
          <text fg={palette.warn}>checking key…</text>
        </Show>
        <Show when={props.result}>
          <text fg={props.result?.startsWith('ok') ? palette.good : palette.bad} wrapMode="none" truncate>{props.result}</text>
        </Show>
        <box height={1} />
        <text fg={palette.faint}>enter submit · esc back</text>
      </box>
    </box>
  );
}

function App() {
  const renderer = useRenderer();
  const [snapshot, setSnapshot] = createSignal<Snapshot>(readSnapshot());
  const [gate, setGate] = createSignal<GateHealth>({ ok: false, url: gateUrl(), error: 'probing' });
  const [events, setEvents] = createSignal<string[]>([`state ${new Date().toLocaleTimeString('en-GB')} loaded`]);
  const [clock, setClock] = createSignal(Date.now());
  const [mode, setMode] = createSignal<'dashboard' | 'activate'>('dashboard');
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<string | null>(null);

  const note = (line: string) => setEvents((prev) => [...prev.slice(-40), `${new Date().toLocaleTimeString('en-GB')}  ${line}`]);

  const refresh = () => {
    setSnapshot(readSnapshot());
    void probeGate().then((health) => {
      setGate(health);
      note(health.ok ? `gateway online ${health.latencyMs}ms` : `gateway offline · ${shortError(health.error)}`);
    });
  };

  const submitKey = async (key: string) => {
    const value = key.trim();
    if (!value) return;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await activate(value);
      setResult(outcome.ok ? `ok · tier ${outcome.tier ?? 'pro'}` : `failed · ${shortError(outcome.message)}`);
      note(outcome.ok ? `license activated (${outcome.tier ?? 'pro'})` : `activation rejected · ${shortError(outcome.message)}`);
      setSnapshot(readSnapshot());
      if (outcome.ok) setTimeout(() => setMode('dashboard'), 700);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'activation failed';
      setResult(`failed · ${shortError(message)}`);
      note(`activation error · ${shortError(message)}`);
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    refresh();
    const flag = process.argv.indexOf('--activate');
    const preset = flag >= 0 ? process.argv[flag + 1] : null;
    if (preset) void submitKey(preset);
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    const stateTimer = setInterval(() => setSnapshot(readSnapshot()), 3000);
    const gateTimer = setInterval(() => void probeGate().then(setGate), 12000);
    onCleanup(() => {
      clearInterval(clockTimer);
      clearInterval(stateTimer);
      clearInterval(gateTimer);
    });
  });

  useKeyboard((key) => {
    if (mode() === 'activate') {
      if (key.name === 'escape') {
        setMode('dashboard');
        setResult(null);
      }
      return;
    }
    if (key.name === 'q' || key.name === 'escape') renderer.destroy();
    if (key.name === 'f2') {
      setResult(null);
      setMode('activate');
      return;
    }
    if (key.name === 'r') {
      refresh();
      return;
    }
    if (key.name === 'g') {
      void probeGate().then((health) => {
        setGate(health);
        note(health.ok ? `gateway online ${health.latencyMs}ms` : `gateway offline · ${shortError(health.error)}`);
      });
    }
  });

  return (
    <Show
      when={mode() === 'activate'}
      fallback={<Dashboard snapshot={snapshot()} gate={gate()} events={events()} clock={clock()} />}
    >
      <ActivateView
        busy={busy()}
        result={result()}
        onSubmit={(value) => void submitKey(value)}
        onCancel={() => setMode('dashboard')}
      />
    </Show>
  );
}

await render(() => <App />);
