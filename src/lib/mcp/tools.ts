// MCP tools for browser automation. Session-scoped: every call after
// browser_new_session takes the sessionId returned by that call.
//
// Credentials never come back over the wire — use_credentials fills them
// into the page from encrypted storage server-side.

import { z } from "zod";

export const TOOL_DEFINITIONS = [
  {
    name: "browser_new_session",
    description:
      "Spin up a fresh browser session for this user. Returns a sessionId to pass to every subsequent tool call. Sessions auto-expire after 15 min of inactivity.",
    inputSchema: z.object({}),
  },
  {
    name: "browser_close_session",
    description:
      "Close a session and free its resources. Call this when you're done — the sweeper will close it eventually but explicit is polite.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
    }),
  },
  {
    name: "browser_navigate",
    description:
      "Navigate the session's page to a URL. Waits for DOMContentLoaded, 30s timeout.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      url: z.string().url(),
    }),
  },
  {
    name: "browser_snapshot",
    description:
      "Return an accessibility-tree snapshot of the current page with per-element uids. Use uids in browser_click and browser_type — they're stable across small DOM shifts, unlike CSS selectors.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
    }),
  },
  {
    name: "browser_click",
    description:
      "Click an element by uid from a prior snapshot. Auto-scrolls into view, retries on flakiness, 10s timeout.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      uid: z.string().min(1),
    }),
  },
  {
    name: "browser_type",
    description:
      "Fill a text input by uid. Clears the field first, then types the new value.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      uid: z.string().min(1),
      text: z.string().max(10000),
    }),
  },
  {
    name: "browser_press_key",
    description:
      "Press a keyboard key on the currently focused element. Examples: 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Control+A'.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      key: z.string().min(1),
    }),
  },
  {
    name: "browser_wait_for",
    description:
      "Wait for a CSS selector to appear on the page. Useful when a click triggers async content that isn't ready when the next snapshot happens.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      selector: z.string().min(1),
      timeoutMs: z.number().int().min(100).max(60000).default(10000),
    }),
  },
  {
    name: "browser_read_page",
    description:
      "Return the plain-text content of the current page (document.body.innerText, capped at 20KB). Use when the snapshot's element names aren't enough — e.g. reading an article.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
    }),
  },
  {
    name: "browser_screenshot",
    description:
      "PNG screenshot of the current viewport, returned as base64. Use when the user asks 'show me' or you need to convince yourself the page rendered.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
    }),
  },
  {
    name: "save_credentials",
    description:
      "Store a username + password for a domain, encrypted server-side. The password never comes back over the API — subsequent use_credentials calls fill it into forms without exposing it. Use when the user gives you their login inline; ALWAYS prefer having them save via the dashboard when possible.",
    inputSchema: z.object({
      domain: z.string().min(1).describe("Domain like 'workit.info', matched by exact string."),
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  },
  {
    name: "use_credentials",
    description:
      "Fill the currently-open page's login form with the saved credentials for a domain. Provide the CSS selectors of the username + password inputs. The password is decrypted and typed directly by the server — the LLM never sees the value.",
    inputSchema: z.object({
      sessionId: z.string().min(1),
      domain: z.string().min(1),
      usernameSelector: z.string().min(1).describe("CSS selector for the username input, e.g. 'input[name=email]'"),
      passwordSelector: z.string().min(1).describe("CSS selector for the password input, e.g. 'input[type=password]'"),
    }),
  },
  {
    name: "list_saved_credentials",
    description:
      "List domains for which the user has saved credentials, with usernames (never passwords). Use this to check if a site is already set up before asking the user for creds.",
    inputSchema: z.object({}),
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export function findTool(name: string) {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

export function jsonSchemaFor(name: ToolName) {
  const t = findTool(name);
  if (!t) throw new Error(`unknown tool: ${name}`);
  return zodToJsonSchema(t.inputSchema);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as unknown as { _def: any })._def;
  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray":
      return { type: "array", items: zodToJsonSchema(def.type) };
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault": {
      const inner = zodToJsonSchema(def.innerType);
      inner.default = def.defaultValue();
      return inner;
    }
    case "ZodObject": {
      const shape = def.shape();
      const props: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape) as [string, z.ZodTypeAny][]) {
        props[k] = zodToJsonSchema(v);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vDef = (v as unknown as { _def: any })._def;
        if (vDef.typeName !== "ZodOptional" && vDef.typeName !== "ZodDefault") {
          required.push(k);
        }
      }
      return { type: "object", properties: props, required };
    }
    default:
      return {};
  }
}
