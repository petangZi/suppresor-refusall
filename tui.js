// Suppresor Refusall — OpenCode V2 TUI part.
// The server process cannot draw to the terminal, so the startup banner and
// command feedback live here. The TUI part is optional: if it fails to load,
// the server part and MCP tools keep working.

import { Plugin } from "@opencode/plugin/tui";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfgDir = process.env.OPENCODE_CONFIG_DIR
  ? process.env.OPENCODE_CONFIG_DIR
  : process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "opencode")
    : join(homedir(), ".config", "opencode");

const flagPath = join(cfgDir, ".suppresor-refusall-active");
const geniusFlagPath = join(cfgDir, ".suppresor-refusall-genius");
const interceptLogPath = join(cfgDir, ".suppresor-refusall-intercepts.json");
const configPath = join(cfgDir, "opencode.jsonc");

const THEME_ACTIVE = "suppresor-red";
const THEME_DEFAULT = "opencode";

function read(file, fallback = null) {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return fallback;
  }
}

function write(file, value) {
  try {
    writeFileSync(file, value, { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function stripJsonc(text) {
  let out = "";
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) {
      if (c === "\n") { lineComment = false; out += c; }
      continue;
    }
    if (blockComment) {
      if (c === "*" && n === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && n === "/") { lineComment = true; i += 1; continue; }
    if (c === "/" && n === "*") { blockComment = true; i += 1; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function setTheme(theme) {
  try {
    if (!existsSync(configPath)) return;
    const config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8")));
    if (config.theme === theme) return;
    config.theme = theme;
    const tmp = `${configPath}.suppresor-tmp`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, configPath);
  } catch {
    /* best effort */
  }
}

function currentTheme() {
  try {
    if (!existsSync(configPath)) return "default";
    return JSON.parse(stripJsonc(readFileSync(configPath, "utf8"))).theme || "default";
  } catch {
    return "unknown";
  }
}

function statusLine() {
  const active = read(flagPath) !== "off";
  const genius = read(geniusFlagPath) === "on";
  return `active: ${active ? "ON" : "OFF"} · genius: ${genius ? "ON" : "OFF"} · theme: ${currentTheme()}`;
}

function control(input) {
  const args = String(input ?? "").trim().replace(/^\/?suppresor[\s-]?refusall?\s*/i, "").trim();
  const [verb, ...rest] = args.split(/\s+/).filter(Boolean);
  const value = rest.join(" ");

  switch ((verb || "status").toLowerCase()) {
    case "on":
      write(flagPath, "on");
      write(geniusFlagPath, "on");
      setTheme(THEME_ACTIVE);
      return "ACTIVE · genius ON · theme suppresor-red";
    case "off":
      write(flagPath, "off");
      write(geniusFlagPath, "off");
      setTheme(THEME_DEFAULT);
      return "OFF · genius OFF · theme default";
    case "genius":
      if (value === "on" || value === "off") {
        write(geniusFlagPath, value);
        return `genius ${value.toUpperCase()}`;
      }
      return "usage: /suppresor-refusall genius on|off";
    case "theme":
      if (!value) return "usage: /suppresor-refusall theme <name>";
      setTheme(value);
      return `theme -> ${value}`;
    case "intercepts": {
      const log = readJson(interceptLogPath, []);
      const recent = Array.isArray(log) ? log.slice(-3).reverse() : [];
      return `${Array.isArray(log) ? log.length : 0} intercept(s)${recent.length ? ` · last: ${recent.map((x) => x.ts || "?").join(", ")}` : ""}`;
    }
    case "status":
      return statusLine();
    default:
      return "usage: /suppresor-refusall on|off|status|intercepts|theme <name>|genius on|off";
  }
}

export default Plugin.define({
  id: "suppresor-refusall.tui",
  setup(context) {
    const toast = (message, variant = "info") => {
      try {
        context.ui.toast.show({
          title: "Suppresor Refusall",
          message,
          variant,
          duration: 3500,
        });
      } catch {
        /* TUI may not be ready yet */
      }
    };

    // Startup visibility: the V1 banner wrote to /dev/tty, which the V2
    // background server does not own. A toast is the reliable equivalent.
    const active = read(flagPath) !== "off";
    toast(
      active
        ? `ACTIVE · genius ${read(geniusFlagPath) === "on" ? "ON" : "OFF"} · /suppresor-refusall off`
        : "OFF · /suppresor-refusall on to arm",
      active ? "error" : "info",
    );

    try {
      context.keymap.layer(() => ({
        mode: "global",
        priority: 5,
        commands: [
          {
            id: "suppresor-refusall.status",
            title: "Suppresor Refusall: status",
            group: "Suppresor",
            palette: true,
            run: async () => toast(control("status")),
          },
        ],
      }));
    } catch {
      /* older TUI builds */
    }
  },
});