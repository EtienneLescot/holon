import { ToExtensionMessageSchema } from "./protocol";
import { getVsCodeApi, registerBrowserBridge } from "./vscodeBridge";

type CoreGraph = {
  nodes: Array<{
    id: string;
    name: string;
    kind: "node" | "workflow" | "spec";
    position?: { x: number; y: number } | null;
    label?: string | null;
    node_type?: string | null;
    props?: Record<string, unknown> | null;
  }>;
  edges: Array<{
    source: string;
    target: string;
    source_port?: string | null;
    target_port?: string | null;
    kind?: "code" | "link" | null;
  }>;
};

type UiGraphNode = {
  id: string;
  name: string;
  kind: "node" | "workflow" | "spec";
  position?: { x: number; y: number } | null;
  label?: string | undefined;
  nodeType?: string;
  ports?: Array<{ id: string; direction: "input" | "output"; kind?: string; label?: string; multi?: boolean }>;
};

type UiGraphEdge = {
  source: string;
  target: string;
  sourcePort?: string | null;
  targetPort?: string | null;
  kind?: "code" | "link";
};

const POSITIONS_KEY = "holon.positions.v1";

function postToUi(message: unknown): void {
  window.postMessage(message, "*");
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

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
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

function savePositions(next: Record<string, { x: number; y: number }>): void {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function portsForNode(input: { kind: "node" | "workflow" | "spec"; nodeType?: string }): Array<{
  id: string;
  direction: "input" | "output";
  kind?: string;
  label?: string;
  multi?: boolean;
}> {
  if (input.kind === "workflow") {
    return [{ id: "start", direction: "output", kind: "control", label: "start" }];
  }
  if (input.kind === "node") {
    return [
      { id: "input", direction: "input", kind: "data", label: "input" },
      { id: "output", direction: "output", kind: "data", label: "output" },
    ];
  }

  switch (input.nodeType) {
    case "langchain.agent":
      return [
        { id: "input", direction: "input", kind: "data", label: "input" },
        { id: "llm", direction: "input", kind: "llm", label: "llm" },
        { id: "memory", direction: "input", kind: "memory", label: "memory" },
        { id: "tools", direction: "input", kind: "tool", label: "tools", multi: true },
        { id: "outputParser", direction: "input", kind: "parser", label: "parser" },
        { id: "output", direction: "output", kind: "data", label: "output" },
      ];
    case "llm.model":
      return [{ id: "llm", direction: "output", kind: "llm", label: "llm" }];
    case "memory.buffer":
      return [{ id: "memory", direction: "output", kind: "memory", label: "memory" }];
    case "tool.example":
      return [{ id: "tool", direction: "output", kind: "tool", label: "tool" }];
    case "parser.json":
      return [{ id: "parser", direction: "output", kind: "parser", label: "parser" }];
    default:
      return [
        { id: "input", direction: "input", kind: "data", label: "input" },
        { id: "output", direction: "output", kind: "data", label: "output" },
      ];
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

function toUiGraph(core: CoreGraph, positions: Record<string, { x: number; y: number }>): { nodes: UiGraphNode[]; edges: UiGraphEdge[] } {
  const nodes: UiGraphNode[] = core.nodes.map((n) => {
    const nodeType = typeof n.node_type === "string" ? n.node_type : undefined;
    const pos = positions[n.id];
    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      position: pos ? { x: pos.x, y: pos.y } : null,
      ...(typeof n.label === "string" ? { label: n.label } : {}),
      ...(nodeType ? { nodeType } : {}),
      ports: portsForNode({ kind: n.kind, ...(nodeType ? { nodeType } : {}) }),
    };
  });

  const edges: UiGraphEdge[] = core.edges.map((e) => ({
    source: e.source,
    target: e.target,
    sourcePort: e.source_port ?? null,
    targetPort: e.target_port ?? null,
    kind: e.kind ?? "code",
  }));

  return { nodes, edges };
}

class BrowserDevBridge {
  private source: string = "";
  private lastGraph: CoreGraph | undefined;
  private positions = loadPositions();
  private hasSentInit = false;

  async init(): Promise<void> {
    const res = await fetchJson<{ source: string }>("/api/source");
    this.source = res.source;
  }

  async parseAndSend(reason: string): Promise<void> {
    const res = await fetchJson<{ graph: CoreGraph }>("/api/parse", { method: "POST", body: "{}" });
    this.lastGraph = res.graph;

    const ui = toUiGraph(res.graph, this.positions);
    postToUi({ type: this.hasSentInit ? "graph.update" : "graph.init", nodes: ui.nodes, edges: ui.edges, reason });
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
      savePositions(next);
      // Re-emit graph quickly to reflect positions.
      if (this.lastGraph) {
        const ui = toUiGraph(this.lastGraph, this.positions);
        postToUi({ type: "graph.update", nodes: ui.nodes, edges: ui.edges });
      }
      return;
    }

    if (msg.type === "ui.node.aiRequest") {
      postToUi({ type: "ai.status", nodeId: msg.nodeId, status: "error", message: "AI patch is not supported in browser dev mode yet." });
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
        savePositions(this.positions);
      }

      await fetchJson("/api/source", { method: "PUT", body: JSON.stringify({ source: this.source }) });
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

      await fetchJson("/api/source", { method: "PUT", body: JSON.stringify({ source: this.source }) });
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
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "graph.error", error: `Browser bridge init failed: ${message}` });
    });
}
