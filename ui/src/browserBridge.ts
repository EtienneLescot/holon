import { ToExtensionMessageSchema, type CoreGraph } from "./protocol";
import { getVsCodeApi, registerBrowserBridge } from "./vscodeBridge";
import { prepareUiGraph, extractTopLevelFunction } from "./logic";

const POSITIONS_KEY_PREFIX = "holon.positions.v1:";

function positionsKey(scope: string): string {
  return `${POSITIONS_KEY_PREFIX}${scope}`;
}

function postToUi(message: unknown): void {
  window.postMessage(message, "*");
}

function buildAiEditPrompt(input: {
  nodeId: string;
  instruction: string;
  currentNodeType?: string;
  currentLabel?: string;
  currentProps?: Record<string, unknown> | null;
  functionCode?: string | null;
}): { title: string; prompt: string } {
  const isSpec = input.nodeId.startsWith("spec:");
  if (!isSpec) {
    return {
      title: "AI edit prompt (copy/paste into your agent)",
      prompt:
        "Task: Modify the following Holon @node function.\n" +
        "Return ONLY the full replacement Python function definition.\n" +
        "No markdown fences. No explanations.\n\n" +
        "Constraints:\n" +
        "- Preserve the function name and signature exactly\n" +
        "- Do not rename unrelated symbols\n" +
        "- Output only the function definition\n\n" +
        `User instruction:\n${input.instruction.trim()}\n\n` +
        `Current function code:\n${(input.functionCode ?? "<missing function code>").trimEnd()}\n`,
    };
  }

  const context = [
    `nodeId: ${input.nodeId}`,
    input.currentNodeType ? `current.type: ${input.currentNodeType}` : "",
    input.currentLabel ? `current.label: ${input.currentLabel}` : "",
    input.currentProps ? `current.props: ${JSON.stringify(input.currentProps)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: "AI spec patch prompt (copy/paste into your agent)",
    prompt:
      "We are editing a single spec(...) node in Python code.\n" +
      "Return ONLY a valid JSON object describing the changes.\n" +
      "No markdown. No explanations.\n\n" +
      "Allowed keys: type, label, props (omit keys you don't want to change).\n" +
      "Value types: type is string, label is string|null, props is object|null.\n\n" +
      `${context}\n` +
      `User instruction: ${input.instruction.trim()}\n`,
  };
}

function buildDescribePrompt(input: {
  nodeId: string;
  kind: string;
  name: string;
  label?: string;
  nodeType?: string;
  props?: Record<string, unknown> | null;
  functionCode?: string | null;
}): { title: string; prompt: string } {
  const parts: string[] = [];
  parts.push(`nodeId: ${input.nodeId}`);
  parts.push(`kind: ${input.kind}`);
  parts.push(`name: ${input.name}`);
  if (input.label) parts.push(`label: ${input.label}`);
  if (input.nodeType) parts.push(`type: ${input.nodeType}`);
  if (input.props) parts.push(`props: ${JSON.stringify(input.props)}`);
  if (input.functionCode) parts.push(`functionCode:\n${input.functionCode.trimEnd()}`);

  return {
    title: "Describe prompt (copy/paste into your agent)",
    prompt:
      "Describe this Holon node for display in a graph UI.\n" +
      "Return ONLY valid JSON. No markdown. No explanations.\n" +
      "Schema: {summary: string, badges: string[]}.\n" +
      "Constraints: summary <= 140 chars; badges 0..6 items, each <= 20 chars.\n\n" +
      parts.join("\n") +
      "\n",
  };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (data as { error?: unknown })?.error;
    throw new Error(typeof err === "string" ? err : `HTTP ${res.status}`);
  }
  return data as T;
}

function loadPositions(scope: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(positionsKey(scope));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return parsed as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function savePositions(scope: string, next: Record<string, { x: number; y: number }>): void {
  try {
    localStorage.setItem(positionsKey(scope), JSON.stringify(next));
  } catch {
    // ignore
  }
}

function pickWorkflowName(graph: CoreGraph | undefined): string | undefined {
  if (!graph) {
    return undefined;
  }
  const workflows = graph.nodes.filter((n) => n.kind === "workflow");
  const main = workflows.find((w) => w.name === "main");
  return main?.name ?? workflows[0]?.name;
}

class BrowserDevBridge {
  private source: string = "";
  private fileScope: string = "memory";
  private lastGraph: CoreGraph | undefined;
  private positions: Record<string, { x: number; y: number }> = {};
  private hasSentInit = false;
  private pollTimer: number | null = null;

  async init(): Promise<void> {
    const res = await fetchJson<{ source: string; file: string | null }>("/api/source");
    this.source = res.source;
    this.fileScope = res.file ?? "memory";
    this.positions = loadPositions(this.fileScope);

    // Fetch initial credentials
    try {
      const creds = await fetchJson<Record<string, Record<string, string>>>("/api/credentials");
      // How to send this to UI? Maybe a new message type or just send it as part of init.
      // For now, let's just make sure UI can ask or we send a 'credentials.update'
      postToUi({ type: "credentials.update", credentials: creds });
    } catch (e) {
      console.error("Failed to fetch credentials", e);
    }
  }

  startFilePolling(intervalMs: number = 350): void {
    if (this.pollTimer !== null) {
      return;
    }
    this.pollTimer = window.setInterval(() => {
      void this.checkForExternalFileChange();
    }, intervalMs);
  }

  private async checkForExternalFileChange(): Promise<void> {
    // If the file is edited in VS Code, devserver refresh() will pick it up,
    // and /api/source will return the new content.
    const res = await fetchJson<{ source: string; file: string | null }>("/api/source");
    const nextScope = res.file ?? "memory";
    if (nextScope !== this.fileScope) {
      this.fileScope = nextScope;
      this.positions = loadPositions(this.fileScope);
      this.source = res.source;
      await this.parseAndSend("file.changed");
      return;
    }
    if (res.source === this.source) {
      return;
    }
    this.source = res.source;
    await this.parseAndSend("file.changed");
  }

  async parseAndSend(reason: string): Promise<void> {
    const res = await fetchJson<{ graph: CoreGraph }>("/api/parse", { method: "POST", body: "{}" });
    this.lastGraph = res.graph;

    const { nodes, edges } = prepareUiGraph(res.graph, this.positions, {});
    postToUi({ type: this.hasSentInit ? "graph.update" : "graph.init", nodes, edges, reason });
    this.hasSentInit = true;
  }

  async handle(message: unknown): Promise<void> {
    const parsed = ToExtensionMessageSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }

    const msg = parsed.data;
    if (msg.type === "ui.ready") {
      await this.parseAndSend("ui.ready");
      return;
    }

    if (msg.type === "ui.nodesChanged") {
      const next = { ...this.positions };
      for (const n of msg.nodes) {
        next[n.id] = { x: n.position.x, y: n.position.y };
      }
      this.positions = next;
      savePositions(this.fileScope, next);
      // Re-emit graph quickly to reflect positions.
      if (this.lastGraph) {
        const { nodes, edges } = prepareUiGraph(this.lastGraph, this.positions, {});
        postToUi({ type: "graph.update", nodes, edges });
      }
      return;
    }

    if (msg.type === "ui.credentials.set") {
      await fetchJson("/api/credentials", {
        method: "POST",
        body: JSON.stringify({ provider: msg.provider, credentials: msg.credentials }),
      });
      return;
    }

    if (msg.type === "ui.node.aiRequest") {
      // Browser mode: generate a copyable prompt for the user to run in their own agent.
      const node = this.lastGraph?.nodes.find((n) => n.id === msg.nodeId);
      const nodeType = node && typeof node.nodeType === "string" ? node.nodeType : undefined;
      const label = node && typeof node.label === "string" ? node.label : undefined;
      const props = node && node.props && typeof node.props === "object" ? (node.props as Record<string, unknown>) : null;

      const functionCode = msg.nodeId.startsWith("node:") ? extractTopLevelFunction(this.source, msg.nodeId.slice("node:".length)) : null;
      const args: {
        nodeId: string;
        instruction: string;
        currentProps: Record<string, unknown> | null;
        functionCode: string | null;
        currentNodeType?: string;
        currentLabel?: string;
      } = {
        nodeId: msg.nodeId,
        instruction: msg.instruction,
        currentProps: props,
        functionCode: functionCode || null,
      };
      if (nodeType) {
        args.currentNodeType = nodeType;
      }
      if (label) {
        args.currentLabel = label;
      }

      const built = buildAiEditPrompt(args);

      postToUi({ type: "ai.prompt", nodeId: msg.nodeId, title: built.title, prompt: built.prompt });
      postToUi({ type: "ai.status", nodeId: msg.nodeId, status: "done", message: "Prompt ready (browser mode)." });
      return;
    }

    if (msg.type === "ui.node.describeRequest") {
      const node = this.lastGraph?.nodes.find((n) => n.id === msg.nodeId);
      const functionCode = msg.nodeId.startsWith("node:") ? extractTopLevelFunction(this.source, msg.nodeId.slice("node:".length)) : null;
      if (!node) {
        postToUi({ type: "ai.status", nodeId: msg.nodeId, status: "error", message: "Unknown node." });
        return;
      }

      const describeArgs: {
        nodeId: string;
        kind: string;
        name: string;
        props: Record<string, unknown> | null;
        functionCode: string | null;
        label?: string;
        nodeType?: string;
      } = {
        nodeId: node.id,
        kind: node.kind,
        name: node.name,
        props: node.props && typeof node.props === "object" ? (node.props as Record<string, unknown>) : null,
        functionCode: functionCode || null,
      };
      if (typeof node.label === "string" && node.label) {
        describeArgs.label = node.label;
      }
      if (typeof node.nodeType === "string" && node.nodeType) {
        describeArgs.nodeType = node.nodeType;
      }

      const built = buildDescribePrompt(describeArgs);

      postToUi({ type: "ai.prompt", nodeId: msg.nodeId, title: built.title, prompt: built.prompt });
      postToUi({ type: "ai.status", nodeId: msg.nodeId, status: "done", message: "Prompt ready (browser mode)." });
      return;
    }

    if (msg.type === "ui.node.deleteRequest") {
      await fetchJson<{ source: string }>("/api/delete_node", {
        method: "POST",
        body: JSON.stringify({ node_id: msg.nodeId }),
      }).then((r) => {
        this.source = r.source;
      });

      // Drop any persisted position for the node.
      if (this.positions[msg.nodeId]) {
        const next = { ...this.positions };
        delete next[msg.nodeId];
        this.positions = next;
        savePositions(this.fileScope, next);
      }

      await this.parseAndSend("ui.node.deleteRequest");
      return;
    }

    if (msg.type === "ui.node.patchRequest") {
      await fetchJson<{ source: string }>("/api/patch_spec_node", {
        method: "POST",
        body: JSON.stringify({
          node_id: msg.nodeId,
          props: msg.props ?? null,
          label: msg.label ?? null,
          set_props: msg.props !== undefined,
          set_label: msg.label !== undefined,
        }),
      }).then((r) => {
        this.source = r.source;
      });

      await this.parseAndSend("ui.node.patchRequest");
      return;
    }

    if (msg.type === "ui.nodeCreated") {
      await fetchJson<{ source: string }>("/api/add_spec_node", {
        method: "POST",
        body: JSON.stringify({
          node_id: msg.node.id,
          node_type: msg.node.type,
          label: msg.node.label,
          props: msg.node.props ?? null,
        }),
      }).then((r) => {
        this.source = r.source;
      });

      if (msg.position) {
        this.positions = { ...this.positions, [msg.node.id]: msg.position };
        savePositions(this.fileScope, this.positions);
      }

      await this.parseAndSend("ui.nodeCreated");
      return;
    }

    if (msg.type === "ui.edgeCreated") {
      const workflowName = pickWorkflowName(this.lastGraph);
      if (!workflowName) {
        postToUi({ type: "graph.error", error: "No workflow found in source (need @workflow def)." });
        return;
      }

      await fetchJson<{ source: string }>("/api/add_link", {
        method: "POST",
        body: JSON.stringify({
          workflow_name: workflowName,
          source_node_id: msg.edge.source,
          source_port: msg.edge.sourcePort ?? "output",
          target_node_id: msg.edge.target,
          target_port: msg.edge.targetPort ?? "input",
        }),
      }).then((r) => {
        this.source = r.source;
      });

      await this.parseAndSend("ui.edgeCreated");
      return;
    }
  }
}

// Auto-register in browser dev mode.
const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;

if (viteEnv?.DEV && !getVsCodeApi()) {
  const bridge = new BrowserDevBridge();
  void bridge
    .init()
    .then(() => {
      registerBrowserBridge({
        postMessageFromUi: (message) => {
          void bridge.handle(message);
        },
      });

      // Keep browser view in sync with edits done in VS Code.
      bridge.startFilePolling(350);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "graph.error", error: `Browser bridge init failed: ${message}` });
    });
}
