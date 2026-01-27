import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Handle,
  Position as HandlePosition,
  useEdgesState,
  useNodesState,
  type NodeDragHandler,
  type NodeProps,
  type OnNodesChange,
  type Connection,
} from "reactflow";
import "reactflow/dist/style.css";

import dagre from "dagre";

import { ToUiMessageSchema, type CoreEdge, type CoreNode } from "./protocol";
import { postToExtension } from "./vscodeBridge";

type UiNodeData = {
  label: string;
  nodeId: string;
  name: string;
  kind: "node" | "workflow" | "spec";
  ports: Array<{ id: string; direction: "input" | "output"; kind?: string | undefined; label?: string | undefined; multi?: boolean | undefined }>;
  aiStatus?: AiStatus;
  onAi: (nodeId: string) => void;
};

type AiStatus = { status: "idle" | "working" | "error" | "done"; message?: string };

function toReactFlowNodes(
  input: CoreNode[],
  opts: { onAi: (nodeId: string) => void; aiByNodeId: Record<string, AiStatus | undefined> }
):
  Array<Node<UiNodeData>> {
  return input.map((n, idx) => {
    const position = n.position ?? { x: 40 + idx * 220, y: n.kind === "workflow" ? 60 : 180 };
    const aiStatus = opts.aiByNodeId[n.id];
    const ports = n.ports ?? [];
    return {
      id: n.id,
      position,
      data: {
        label: n.label ?? `${n.kind}: ${n.name}`,
        nodeId: n.id,
        name: n.name,
        kind: n.kind,
        ports,
        ...(aiStatus ? { aiStatus } : {}),
        onAi: opts.onAi,
      },
      type: "holon",
    };
  });
}

function toReactFlowEdges(input: CoreEdge[]): Edge[] {
  return input.map((e) => ({
    id: `${e.kind ?? "code"}:${e.source}:${e.sourcePort ?? ""}->${e.target}:${e.targetPort ?? ""}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourcePort ?? null,
    targetHandle: e.targetPort ?? null,
    animated: false,
    ...(e.kind === "link" ? { style: { stroke: "rgba(110,168,255,0.9)" } } : {}),
  }));
}

function HolonNode(props: NodeProps<UiNodeData>): JSX.Element {
  const { data } = props;
  const status = data.aiStatus?.status ?? "idle";
  const canAiPatch = data.nodeId.startsWith("node:");

  const inputs = data.ports.filter((p) => p.direction === "input");
  const outputs = data.ports.filter((p) => p.direction === "output");

  const baseTop = 38;
  const step = 18;

  return (
    <div className="holonNode">
      {inputs.map((p, idx) => (
        <Handle
          key={`in:${p.id}`}
          type="target"
          position={HandlePosition.Left}
          id={p.id}
          className={`holonHandle holonHandle-${p.kind ?? "data"}`}
          style={{ top: baseTop + idx * step }}
        />
      ))}

      {outputs.map((p, idx) => (
        <Handle
          key={`out:${p.id}`}
          type="source"
          position={HandlePosition.Right}
          id={p.id}
          className={`holonHandle holonHandle-${p.kind ?? "data"}`}
          style={{ top: baseTop + idx * step }}
        />
      ))}

      <div className="holonNodeTop">
        <div className="holonNodeTitle">{data.label}</div>
        {canAiPatch ? (
          <button
            className="nodrag holonAiButton"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              data.onAi(data.nodeId);
            }}
            disabled={status === "working"}
            title={status === "working" ? "AI working..." : "Ask Copilot to patch this node"}
            type="button"
          >
            AI
          </button>
        ) : null}
      </div>
      {data.aiStatus?.message ? <div className={`holonNodeStatus holonNodeStatus-${status}`}>{data.aiStatus.message}</div> : null}
    </div>
  );
}

export default function App(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<UiNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const [aiByNodeId, setAiByNodeId] = useState<Record<string, AiStatus | undefined>>({});
  const [aiModalNodeId, setAiModalNodeId] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState<string>("");

  const onAi = useCallback((nodeId: string) => {
    setAiModalNodeId(nodeId);
    setAiInstruction("");
  }, []);

  useEffect(() => {
    postToExtension({ type: "ui.ready" });

    const handler = (event: MessageEvent) => {
      const parsed = ToUiMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        return;
      }

      const msg = parsed.data;
      if (msg.type === "graph.init" || msg.type === "graph.update") {
        setNodes(toReactFlowNodes(msg.nodes, { onAi, aiByNodeId }));
        setEdges(toReactFlowEdges(msg.edges));
      }

      if (msg.type === "graph.error") {
        setNodes([
          {
            id: "error",
            position: { x: 40, y: 40 },
            data: { label: `error: ${msg.error}`, nodeId: "error", name: "error", kind: "workflow", ports: [], onAi },
          },
        ]);
        setEdges([]);
      }

      if (msg.type === "ai.status") {
        const next: AiStatus = msg.message ? { status: msg.status, message: msg.message } : { status: msg.status };

        setAiByNodeId((prev) => ({
          ...prev,
          [msg.nodeId]: next,
        }));

        setNodes((prev) =>
          prev.map((n) =>
            n.id === msg.nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    aiStatus: next,
                  },
                }
              : n
          )
        );
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onAi, setEdges, setNodes]);

  const onNodeDragStop: NodeDragHandler = (_event, node) => {
    postToExtension({ type: "ui.nodesChanged", nodes: [{ id: node.id, position: node.position }] });
  };

  const pendingPositionUpdatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const flushTimerRef = useRef<number | null>(null);

  const flushPositions = useCallback(() => {
    flushTimerRef.current = null;
    const entries = Array.from(pendingPositionUpdatesRef.current.entries());
    pendingPositionUpdatesRef.current.clear();
    if (entries.length === 0) {
      return;
    }
    postToExtension({
      type: "ui.nodesChanged",
      nodes: entries.map(([id, position]) => ({ id, position })),
    });
  }, []);

  const queuePositionUpdate = useCallback(
    (id: string, position: { x: number; y: number }) => {
      pendingPositionUpdatesRef.current.set(id, position);
      if (flushTimerRef.current !== null) {
        return;
      }
      // Throttle: send at most ~6x/sec while dragging.
      flushTimerRef.current = window.setTimeout(flushPositions, 160);
    },
    [flushPositions]
  );

  const onNodesChangeForward: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);

      // Some interactions don't reliably trigger onNodeDragStop in all environments.
      // Emit a minimal nodesChanged when a drag finishes.
      for (const c of changes) {
        if (c.type !== "position") {
          continue;
        }
        const id = (c as unknown as { id?: string }).id;
        const position = (c as unknown as { position?: { x: number; y: number } }).position;
        if (!id || !position) {
          continue;
        }

        // Send continuously while dragging so we don't lose updates if mouseup happens outside the webview.
        queuePositionUpdate(id, position);
      }
    },
    [onNodesChange, queuePositionUpdate]
  );

  const stats = useMemo(() => ({ nodes: nodes.length, edges: edges.length }), [nodes.length, edges.length]);

  const onAutoLayout = useCallback(() => {
    const next = layoutWithDagre(nodes, edges, { direction: "LR" });
    if (next.length === 0) {
      return;
    }
    setNodes(next);
    postToExtension({
      type: "ui.nodesChanged",
      nodes: next.map((n) => ({ id: n.id, position: n.position })),
    });
  }, [edges, nodes, setNodes]);

  const createSpecNode = useCallback(
    (spec: {
      type: string;
      label: string;
      props?: Record<string, unknown>;
    }) => {
      const id = `spec:${spec.type}:${randomId()}`;
      // Place near the top-left, staggered.
      const pos = { x: 60 + (nodes.length % 4) * 260, y: 100 + Math.floor(nodes.length / 4) * 140 };

      postToExtension({
        type: "ui.nodeCreated",
        node: {
          id,
          type: spec.type,
          label: spec.label,
          inputs: [],
          outputs: [],
          props: spec.props ?? {},
        },
        position: pos,
      });
    },
    [nodes.length]
  );

  const onAddAgent = useCallback(() => {
    createSpecNode({
      type: "langchain.agent",
      label: "LangChain Agent",
      props: {
        systemPrompt: "You are a helpful assistant.",
        promptTemplate: "{input}",
        temperature: 0.2,
        maxTokens: 1024,
        agentType: "tool-calling",
      },
    });
  }, [createSpecNode]);

  const onAddLlm = useCallback(() => {
    createSpecNode({
      type: "llm.model",
      label: "LLM Model",
      props: { provider: "openai", model: "gpt-4o-mini" },
    });
  }, [createSpecNode]);

  const onAddMemory = useCallback(() => {
    createSpecNode({
      type: "memory.buffer",
      label: "Memory Buffer",
      props: { maxMessages: 20 },
    });
  }, [createSpecNode]);

  const onAddTool = useCallback(() => {
    createSpecNode({
      type: "tool.example",
      label: "Example Tool",
      props: { name: "example_tool" },
    });
  }, [createSpecNode]);

  const onAddParser = useCallback(() => {
    createSpecNode({
      type: "parser.json",
      label: "JSON Parser",
      props: { schema: {} },
    });
  }, [createSpecNode]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }
    postToExtension({
      type: "ui.edgeCreated",
      edge: {
        source: connection.source,
        target: connection.target,
        sourcePort: connection.sourceHandle ?? null,
        targetPort: connection.targetHandle ?? null,
      },
    });
  }, []);

  return (
    <div className="holonRoot">
      <div className="header">
        <strong>Holon</strong>
        <span className="badge">Phase 4</span>
        <span className="badge">nodes: {stats.nodes}</span>
        <span className="badge">edges: {stats.edges}</span>

        <div className="holonHeaderActions">
          <button type="button" className="holonHeaderButton" onClick={onAddAgent}>
            + Agent
          </button>
          <button type="button" className="holonHeaderButton" onClick={onAddLlm}>
            + LLM
          </button>
          <button type="button" className="holonHeaderButton" onClick={onAddMemory}>
            + Memory
          </button>
          <button type="button" className="holonHeaderButton" onClick={onAddTool}>
            + Tool
          </button>
          <button type="button" className="holonHeaderButton" onClick={onAddParser}>
            + Parser
          </button>
          <button type="button" className="holonHeaderButton" onClick={onAutoLayout} disabled={nodes.length === 0}>
            Auto layout
          </button>
        </div>
      </div>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeForward}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          nodeTypes={{ holon: HolonNode }}
          fitView
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>

      {aiModalNodeId ? (
        <div className="holonModalOverlay" role="dialog" aria-modal="true">
          <div className="holonModal">
            <div className="holonModalHeader">
              <strong>AI patch</strong>
              <span className="holonModalSub">{aiModalNodeId}</span>
            </div>
            <textarea
              className="nodrag holonModalTextarea"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="Describe the change you want (e.g. 'Add basic input validation and return a default on error')."
            />
            <div className="holonModalButtons">
              <button
                type="button"
                className="nodrag holonButton"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setAiModalNodeId(null);
                  setAiInstruction("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="nodrag holonButton holonButtonPrimary"
                onMouseDown={(e) => e.stopPropagation()}
                disabled={!aiInstruction.trim()}
                onClick={() => {
                  postToExtension({ type: "ui.node.aiRequest", nodeId: aiModalNodeId, instruction: aiInstruction });
                  setAiModalNodeId(null);
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function randomId(): string {
  // Prefer UUID when available.
  const c = globalThis.crypto;
  if (c && typeof (c as unknown as { randomUUID?: unknown }).randomUUID === "function") {
    return (c as unknown as { randomUUID: () => string }).randomUUID();
  }
  // Fallback: 16 random bytes.
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Very last resort.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function layoutWithDagre(
  nodes: Array<Node<UiNodeData>>,
  edges: Edge[],
  opts: { direction: "LR" | "TB" }
): Array<Node<UiNodeData>> {
  if (nodes.length === 0) {
    return [];
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: opts.direction,
    nodesep: 60,
    ranksep: 90,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const NODE_WIDTH = 240;
  const NODE_HEIGHT = 70;

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    if (!e.source || !e.target) {
      continue;
    }
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id) as unknown;
    if (!p || typeof p !== "object") {
      return n;
    }
    const pp = p as { x?: number; y?: number };
    const x = typeof pp.x === "number" ? pp.x : n.position.x;
    const y = typeof pp.y === "number" ? pp.y : n.position.y;
    // dagre returns center coordinates; React Flow expects top-left.
    return {
      ...n,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
    };
  });
}
