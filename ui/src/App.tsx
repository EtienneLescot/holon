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
  type OnSelectionChangeParams,
} from "reactflow";
import "reactflow/dist/style.css";

import dagre from "dagre";

import { ToUiMessageSchema, type CoreEdge, type CoreNode } from "./protocol";
import { postToExtension } from "./vscodeBridge";
import { inferPorts, type PortSpec } from "./ports";
import { ConfigPanel } from "./ConfigPanel";

type UiNodeData = {
  label: string;
  nodeId: string;
  name: string;
  kind: "node" | "workflow" | "spec";
  nodeType?: string;
  props?: Record<string, unknown>;
  ports: PortSpec[];
  summary?: string;
  badges?: string[];
  aiStatus?: AiStatus;
  isSelected?: boolean;
  onAi: (nodeId: string) => void;
  onDescribe: (nodeId: string) => void;
};

type AiStatus = { status: "idle" | "working" | "error" | "done"; message?: string };

type PromptModalState = { nodeId: string; title: string; prompt: string };

function toReactFlowNodes(
  input: CoreNode[],
  opts: {
    onAi: (nodeId: string) => void;
    onDescribe: (nodeId: string) => void;
    aiByNodeId: Record<string, AiStatus | undefined>;
    selectedNodeId: string | null;
  }
):
  Array<Node<UiNodeData>> {
  return input.map((n, idx) => {
    const position = n.position ?? { x: 40 + idx * 220, y: n.kind === "workflow" ? 60 : 180 };
    const aiStatus = opts.aiByNodeId[n.id];
    const ports: PortSpec[] =
      n.ports && n.ports.length > 0
        ? n.ports.map((p) => {
            const out: PortSpec = {
              id: p.id,
              direction: p.direction,
            };
            if (typeof p.kind === "string") {
              out.kind = p.kind;
            }
            if (typeof p.label === "string") {
              out.label = p.label;
            }
            if (typeof p.multi === "boolean") {
              out.multi = p.multi;
            }
            return out;
          })
        : inferPorts({ kind: n.kind, nodeType: n.nodeType });
    const summary = n.summary;
    const badges = n.badges;
    return {
      id: n.id,
      position,
      data: {
        label: n.label ?? `${n.kind}: ${n.name}`,
        nodeId: n.id,
        name: n.name,
        kind: n.kind,
        ...(typeof n.nodeType === "string" ? { nodeType: n.nodeType } : {}),
        ...(n.props && typeof n.props === "object" ? { props: n.props } : {}),
        ports,
        ...(opts.selectedNodeId === n.id ? { isSelected: true } : {}),
        ...(typeof summary === "string" ? { summary } : {}),
        ...(Array.isArray(badges) ? { badges } : {}),
        ...(aiStatus ? { aiStatus } : {}),
        onAi: opts.onAi,
        onDescribe: opts.onDescribe,
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
    ...(e.kind === "link" ? { style: { stroke: "rgba(110,168,255,0.4)" } } : {}),
  }));
}

function HolonNode(props: NodeProps<UiNodeData>): JSX.Element {
  const { data } = props;
  const status = data.aiStatus?.status ?? "idle";
  const canAiEdit = data.nodeId.startsWith("node:") || data.nodeId.startsWith("spec:");
  const canDescribe = data.nodeId.startsWith("node:") || data.nodeId.startsWith("spec:");

  const stop = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
  };

  const inputs = data.ports.filter((p) => p.direction === "input");
  const outputs = data.ports.filter((p) => p.direction === "output");

  const baseTop = 40;
  const step = 20;

  return (
    <div className={`holonNode${data.isSelected ? " holonNode-selected" : ""}`}>
      <div className="holonNodeInner">
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
          <div>
            <div className="holonNodeTitle">{data.label}</div>
            {data.badges?.length ? (
              <div className="holonPills">
                {data.badges.map((b) => (
                  <span key={b} className="holonPill">
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="holonNodeActions">
            {canAiEdit ? (
              <button
                className="nodrag nopan holonAiButton"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onAi(data.nodeId);
                }}
                disabled={status === "working"}
                type="button"
              >
                AI
              </button>
            ) : null}

            {canDescribe ? (
              <button
                className="nodrag nopan holonAiButton"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onDescribe(data.nodeId);
                }}
                disabled={status === "working"}
                type="button"
              >
                Describe
              </button>
            ) : null}
          </div>
        </div>
        {data.aiStatus?.message ? <div className={`holonNodeStatus holonNodeStatus-${status}`}>{data.aiStatus.message}</div> : null}
        {data.summary ? <div className="holonNodeSummary">{data.summary}</div> : null}
      </div>
    </div>
  );
}

export default function App(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<UiNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const nodeTypes = useMemo(() => ({ holon: HolonNode }), []);

  const [aiByNodeId, setAiByNodeId] = useState<Record<string, AiStatus | undefined>>({});
  const [aiModalNodeId, setAiModalNodeId] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState<string>("");
  const aiTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const onAi = useCallback((nodeId: string) => {
    setAiModalNodeId(nodeId);
    setAiInstruction("");
  }, []);

  const closeAiModal = useCallback(() => {
    setAiModalNodeId(null);
    setAiInstruction("");
  }, []);

  const closePromptModal = useCallback(() => {
    setPromptModal(null);
  }, []);

  const submitAiModal = useCallback(() => {
    if (!aiModalNodeId) {
      return;
    }
    const instruction = aiInstruction.trim();
    if (!instruction) {
      return;
    }
    postToExtension({ type: "ui.node.aiRequest", nodeId: aiModalNodeId, instruction });
    setAiModalNodeId(null);
  }, [aiInstruction, aiModalNodeId]);

  useEffect(() => {
    if (!aiModalNodeId) {
      return;
    }
    const t = window.setTimeout(() => {
      aiTextareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [aiModalNodeId]);

  const onDescribe = useCallback((nodeId: string) => {
    postToExtension({ type: "ui.node.describeRequest", nodeId });
  }, []);

  const onDeleteNode = useCallback((nodeId: string) => {
    const ok = window.confirm(`Delete ${nodeId}? This edits the source code.`);
    if (!ok) {
      return;
    }
    postToExtension({ type: "ui.node.deleteRequest", nodeId });
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
        setNodes(toReactFlowNodes(msg.nodes, { onAi, onDescribe, aiByNodeId, selectedNodeId }));
        setEdges(toReactFlowEdges(msg.edges));
      }

      if (msg.type === "ai.status") {
        const next: AiStatus = msg.message ? { status: msg.status, message: msg.message } : { status: msg.status };
        setAiByNodeId((prev) => ({ ...prev, [msg.nodeId]: next }));
        setNodes((prev) => prev.map((n) => n.id === msg.nodeId ? { ...n, data: { ...n.data, aiStatus: next } } : n));
      }

      if (msg.type === "ai.prompt") {
        setPromptModal({ nodeId: msg.nodeId, title: msg.title, prompt: msg.prompt });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [aiByNodeId, onAi, onDescribe, selectedNodeId, setEdges, setNodes]);

  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, isSelected: selectedNodeId === n.id } })));
  }, [selectedNodeId, setNodes]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const first = params.nodes && params.nodes.length > 0 ? params.nodes[0] : undefined;
    if (first) {
      setSelectedNodeId(first.id);
    }
  }, []);

  const pointerDownNodeIdRef = useRef<string | null>(null);
  const pointerDownWasPaneRef = useRef<boolean>(false);

  useEffect(() => {
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target as unknown;
      if (!t || typeof t !== "object") {
        pointerDownNodeIdRef.current = null;
        pointerDownWasPaneRef.current = true;
        return;
      }
      const el = t as { closest?: (s: string) => Element | null };
      const nodeEl = typeof el.closest === "function" ? el.closest(".react-flow__node") : null;
      if (nodeEl && typeof (nodeEl as Element).getAttribute === "function") {
        const id = (nodeEl as Element).getAttribute("data-id");
        pointerDownNodeIdRef.current = id || null;
        pointerDownWasPaneRef.current = false;
        return;
      }
      pointerDownNodeIdRef.current = null;
      pointerDownWasPaneRef.current = true;
    };

    const onPointerUpCapture = (e: PointerEvent) => {
      if (aiModalNodeId || promptModal) {
        pointerDownNodeIdRef.current = null;
        pointerDownWasPaneRef.current = false;
        return;
      }
      const startedOnNodeId = pointerDownNodeIdRef.current;
      const startedOnPane = pointerDownWasPaneRef.current;
      pointerDownNodeIdRef.current = null;
      pointerDownWasPaneRef.current = false;
      const t = e.target as unknown;
      const el = t && typeof t === "object" ? (t as { closest?: (s: string) => Element | null }) : null;
      const nodeEl = el && typeof el.closest === "function" ? el.closest(".react-flow__node") : null;
      const endedOnNodeId = nodeEl && typeof (nodeEl as Element).getAttribute === "function" ? (nodeEl as Element).getAttribute("data-id") : null;

      if (startedOnNodeId && endedOnNodeId && startedOnNodeId === endedOnNodeId) {
        setSelectedNodeId(startedOnNodeId);
        return;
      }
      if (startedOnPane && !endedOnNodeId) {
        setSelectedNodeId(null);
      }
    };

    window.addEventListener("pointerdown", onPointerDownCapture, true);
    window.addEventListener("pointerup", onPointerUpCapture, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("pointerup", onPointerUpCapture, true);
    };
  }, [aiModalNodeId, promptModal]);

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
      flushTimerRef.current = window.setTimeout(flushPositions, 160);
    },
    [flushPositions]
  );

  const onNodesChangeForward: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes);

    for (const c of changes) {
      if (c.type !== "position") {
        continue;
      }
      const id = (c as unknown as { id?: string }).id;
      const position = (c as unknown as { position?: { x: number; y: number } }).position;
      if (!id || !position) {
        continue;
      }
      queuePositionUpdate(id, position);
    }
  }, [onNodesChange, queuePositionUpdate]);

  const onNodeDragStop: NodeDragHandler = (_event, node) => {
    postToExtension({ type: "ui.nodesChanged", nodes: [{ id: node.id, position: node.position }] });
  };

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
      // Place near the top-left, staggered.
      const pos = { x: 60 + (nodes.length % 4) * 260, y: 100 + Math.floor(nodes.length / 4) * 140 };

      postToExtension({
        type: "ui.nodeCreated",
        node: {
          id: `spec:${spec.type}:${randomId()}`,
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

  const stats = useMemo(() => ({ nodes: nodes.length, edges: edges.length }), [nodes.length, edges.length]);
  const canDeleteSelected = selectedNodeId ? selectedNodeId.startsWith("node:") || selectedNodeId.startsWith("spec:") : false;

  const selectedCoreNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (!n) return null;
    const data = n.data;
    return {
      id: n.id,
      name: data.name,
      kind: data.kind,
      label: data.label,
      nodeType: data.nodeType,
      props: data.props,
      summary: data.summary,
      badges: data.badges,
      ports: data.ports,
      position: n.position,
    };
  }, [nodes, selectedNodeId]);

  return (
    <div className="holonRoot">
      <div className="header">
        <span className="holonTitle">Holon</span>
        <span className="badge">Phase 4</span>
        <span className="badge">nodes: {stats.nodes}</span>
        <span className="badge">edges: {stats.edges}</span>
        <div className="holonHeaderActions">
          <button
            type="button"
            className="holonHeaderButton"
            onClick={() => {
              if (selectedNodeId) onDeleteNode(selectedNodeId);
            }}
            disabled={!canDeleteSelected}
          >
            Delete
          </button>
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
      <div className="holonMainSplit">
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeForward}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onNodeClick={(_e, n) => setSelectedNodeId(n.id)}
            nodeTypes={nodeTypes}
            noDragClassName="nodrag"
            noPanClassName="nopan"
            fitView
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
        <ConfigPanel node={selectedCoreNode} onClose={() => setSelectedNodeId(null)} onDelete={onDeleteNode} />
      </div>

      {promptModal && (
        <div className="holonModalOverlay" onClick={closePromptModal}>
          <div className="holonModal holonModalLarge" onClick={(e) => e.stopPropagation()}>
            <div className="holonModalHeader">
              <strong>{promptModal.title}</strong>
              <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>Copy this prompt to your LLM and apply the patch manually.</div>
            </div>
            <textarea
              className="holonModalTextarea"
              readOnly
              value={promptModal.prompt}
              style={{ fontFamily: 'monospace', fontSize: '12px', minHeight: '300px' }}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  closePromptModal();
                }
              }}
            />
            <div className="holonModalButtons">
              <button
                className="holonButton"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(promptModal.prompt);
                  } catch {
                    // Fallback
                  }
                }}
              >
                Copy to Clipboard
              </button>
              <button className="holonButton holonButtonPrimary" onClick={closePromptModal}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {aiModalNodeId && (
        <div className="holonModalOverlay" onClick={closeAiModal}>
          <div className="holonModal" onClick={(e) => e.stopPropagation()}>
            <div className="holonModalHeader">
              <h2 className="text-xl font-black uppercase italic tracking-tighter">AI Transformation</h2>
              <div className="text-[10px] uppercase font-black tracking-[0.2em] text-white/20 mt-2">Neural Patch Process</div>
            </div>
            <textarea
              className="holonModalTextarea"
              ref={aiTextareaRef}
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder={
                aiModalNodeId.startsWith("spec:")
                  ? "Describe what you want this node to do / how to configure it (Copilot will edit spec(...))."
                  : "Describe the change you want in this node's code (Copilot will patch the function)."
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  closeAiModal();
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  submitAiModal();
                }
              }}
            />
            <div className="holonModalButtons">
              <button className="holonButton" onClick={closeAiModal}>
                Cancel
              </button>
              <button className="holonButton holonButtonPrimary" onClick={submitAiModal} disabled={!aiInstruction.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof (c as unknown as { randomUUID?: unknown }).randomUUID === "function") {
    return (c as unknown as { randomUUID: () => string }).randomUUID();
  }
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
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
    return {
      ...n,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
    };
  });
}
