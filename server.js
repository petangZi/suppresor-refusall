// Suppresor Refusall — OpenCode V2 adapter.
// Loads the V1 core plugin and maps its hooks onto the V2 plugin/session API.

import v1Factory from "./plugin.js";
import { ensureTikiAgents } from "./agent-file.mjs";

function toV1Message(message) {
  const type = message?.type;
  const role = message?.role
    || (type === "assistant" ? "assistant" : type === "system" ? "system" : type === "tool" ? "tool" : "user");
  let parts = Array.isArray(message?.content) ? message.content : [];
  if (parts.length === 0 && typeof message?.text === "string") {
    parts = [{ type: "text", text: message.text }];
  }
  return { info: { role }, parts };
}

function normalizeContext(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function mapEvent(event) {
  const data = event?.data ?? {};
  switch (event?.type) {
    case "session.created":
      return [{ type: "session.created", properties: { sessionID: data.sessionID } }];
    case "session.text.ended":
      return [{
        type: "message.part.updated",
        properties: { part: { type: "text", text: data.text || "", sessionID: data.sessionID, messageID: data.assistantMessageID, synthetic: false } },
      }];
    case "session.reasoning.ended":
      return [{
        type: "message.part.updated",
        properties: { part: { type: "reasoning", text: data.text || "", sessionID: data.sessionID, messageID: data.assistantMessageID, synthetic: false } },
      }];
    case "session.compaction.ended":
      return [{ type: "session.compacted", properties: { sessionID: data.sessionID } }];
    default:
      return [];
  }
}

export default {
  id: "suppresor-refusall",
  async setup(ctx) {
    // The idle TUI belongs to the client, not the V2 server process.
    if (!process.env.SUPPRESOR_SKIP_IDLE) process.env.SUPPRESOR_SKIP_IDLE = "1";

    // Keep the agent visible even if an update or a partial install removed it.
    try { ensureTikiAgents(); } catch { /* best effort */ }

    const client = {
      session: {
        async promptAsync(input) {
          const parts = input?.body?.parts ?? [];
          const text = parts
            .filter(part => part && part.type === "text" && typeof part.text === "string")
            .map(part => part.text)
            .join("\n");
          if (!text) return;
          return ctx.session.synthetic({ sessionID: input.path.id, text });
        },
        async message(input) {
          const result = await ctx.session.context({ sessionID: input.path.id });
          const messages = normalizeContext(result);
          const message = messages.find(item => item?.id === input.path.messageID);
          if (!message) return { data: { parts: [], info: { role: "assistant" } } };
          const adapted = toV1Message(message);
          return { data: { parts: adapted.parts, info: adapted.info } };
        },
      },
    };

    const hooks = await v1Factory({ client, directory: ctx.location.directory });
    if (!hooks || typeof hooks !== "object") return;

    const cleanups = [];

    if (typeof hooks["chat.message"] === "function") {
      const registration = await ctx.session.hook("prompt", async (event) => {
        const text = event?.prompt?.text;
        if (typeof text !== "string") return;
        const output = { parts: [{ type: "text", text }], message: { role: "user" }, sessionID: event.sessionID };
        await hooks["chat.message"]({ sessionID: event.sessionID }, output);
      });
      cleanups.push(() => registration.dispose());
    }

    const systemHook = hooks["experimental.chat.system.transform"];
    const messagesHook = hooks["experimental.chat.messages.transform"];
    if (typeof systemHook === "function" || typeof messagesHook === "function") {
      const registration = await ctx.session.hook("context", async (event) => {
        if (typeof systemHook === "function" && Array.isArray(event.system)) {
          const textParts = event.system.filter(part => part && part.type === "text" && typeof part.text === "string");
          const before = textParts.map(part => part.text);
          const output = { system: before.slice() };
          await systemHook({ sessionID: event.sessionID }, output);
          if (Array.isArray(output.system)) {
            const shared = Math.min(textParts.length, output.system.length);
            for (let i = 0; i < shared; i += 1) {
              const value = output.system[i];
              if (typeof value === "string" && value !== before[i]) textParts[i].text = value;
            }
            for (let i = textParts.length; i < output.system.length; i += 1) {
              const value = output.system[i];
              if (typeof value === "string" && value) event.system.push({ type: "text", text: value });
            }
          }
        }

        if (typeof messagesHook === "function" && Array.isArray(event.messages)) {
          const wrappers = event.messages.map(toV1Message);
          await messagesHook({ sessionID: event.sessionID }, { messages: wrappers });
        }
      });
      cleanups.push(() => registration.dispose());
    }

    if (typeof hooks["experimental.session.compacting"] === "function") {
      const registration = await ctx.session.hook("compaction", async (event) => {
        const output = { context: [] };
        await hooks["experimental.session.compacting"]({ sessionID: event.sessionID }, output);
        if (!Array.isArray(output.context) || output.context.length === 0) return;
        if (!Array.isArray(event.messages)) return;
        const guard = output.context.join("\n");
        const last = event.messages[event.messages.length - 1];
        if (last && Array.isArray(last.content)) {
          last.content.push({ type: "text", text: guard });
        } else {
          event.messages.push({ role: "system", content: [{ type: "text", text: guard }] });
        }
      });
      cleanups.push(() => registration.dispose());
    }

    if (typeof hooks.event === "function") {
      const registration = await ctx.session.hook("experimental.idle", async (event) => {
        await hooks.event({ event: { type: "session.idle", properties: { sessionID: event.sessionID } } });
      });
      cleanups.push(() => registration.dispose());

      const controller = new AbortController();
      const types = [
        "session.created",
        "session.text.ended",
        "session.reasoning.ended",
        "session.compaction.ended",
      ];
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ types, signal: controller.signal })) {
            for (const mapped of mapEvent(event)) {
              try {
                await hooks.event({ event: mapped });
              } catch (error) {
                console.error(`suppresor-refusall: event handler failed: ${error.message}`);
              }
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            console.error(`suppresor-refusall: event subscription failed: ${error.message}`);
          }
        }
      })();
      cleanups.push(() => controller.abort());
    }

    return async () => {
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch {
          /* best effort */
        }
      }
    };
  },
};
