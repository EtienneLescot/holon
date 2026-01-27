import { ToExtensionMessageSchema } from "./protocol";
import { getVsCodeApi, registerBrowserBridge } from "./vscodeBridge";
import { inferPorts } from "./ports";

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

const POSITIONS_KEY_PREFIX = "holon.positions.v1:";

function positionsKey(scope: string): string {
  return `${POSITIONS_KEY_PREFIX}${scope}`;
}

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
      ports: inferPorts({ kind: n.kind, ...(nodeType ? { nodeType } : {}) }),
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
      savePositions(this.fileScope, next);
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

    if (msg.type === "ui.node.describeRequest") {
      postToUi({ type: "ai.status", nodeId: msg.nodeId, status: "error", message: "AI describe is not supported in browser dev mode yet." });
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

      // Keep browser view in sync with edits done in VS Code.
      bridge.startFilePolling(350);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "graph.error", error: `Browser bridge init failed: ${message}` });
    });
}
