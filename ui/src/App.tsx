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
import { inferPorts } from "./ports";

type UiNodeData = {
  label: string;
  nodeId: string;
  name: string;
  kind: "node" | "workflow" | "spec";
  ports: Array<{ id: string; direction: "input" | "output"; kind?: string | undefined; label?: string | undefined; multi?: boolean | undefined }>;
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
    const ports = n.ports && n.ports.length > 0 ? n.ports : inferPorts({ kind: n.kind, nodeType: n.nodeType });
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
    ...(e.kind === "link" ? { style: { stroke: "rgba(110,168,255,0.9)" } } : {}),
  }));
}

function HolonNode(props: NodeProps<UiNodeData>): JSX.Element {
  const { data } = props;
  const status = data.aiStatus?.status ?? "idle";
  const canAiEdit = data.nodeId.startsWith("node:") || data.nodeId.startsWith("spec:");
  const canDescribe = data.nodeId.startsWith("node:") || data.nodeId.startsWith("spec:");

  const stop = (e: { stopPropagation: () => void }): void => {
    // React Flow uses pointer events for drag/pan. Stop those at the source so
    // button clicks aren't eaten by a drag start.
    e.stopPropagation();
  };

  const inputs = data.ports.filter((p) => p.direction === "input");
  const outputs = data.ports.filter((p) => p.direction === "output");

  const baseTop = 38;
  const step = 18;

  return (
    <div className={`holonNode${data.isSelected ? " holonNode-selected" : ""}`}>
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
              onPointerDown={stop}
              onPointerDownCapture={stop}
              onMouseDown={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onPointerUp={(e) => {
                e.stopPropagation();
                data.onAi(data.nodeId);
              }}
              disabled={status === "working"}
              title={status === "working" ? "AI working..." : "Ask Copilot to edit this node"}
              type="button"
            >
              AI
            </button>
          ) : null}

          {canDescribe ? (
            <button
              className="nodrag nopan holonAiButton"
              onPointerDown={stop}
              onPointerDownCapture={stop}
              onMouseDown={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onPointerUp={(e) => {
                e.stopPropagation();
                data.onDescribe(data.nodeId);
              }}
              disabled={status === "working"}
              title={status === "working" ? "AI working..." : "Ask Copilot to describe this node"}
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
  );
}

export default function App(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<UiNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  // React Flow expects nodeTypes/edgeTypes to be referentially stable.
  const nodeTypes = useMemo(() => ({ holon: HolonNode }), []);

  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env;
  const uiModeLabel = viteEnv?.DEV ? "DEV" : "PROD";

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
    // Next tick so the textarea exists.
    const t = window.setTimeout(() => {
      aiTextareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [aiModalNodeId]);

  const onDescribe = useCallback((nodeId: string) => {
    postToExtension({ type: "ui.node.describeRequest", nodeId });
  }, []);

  const canDeleteSelected = selectedNodeId ? selectedNodeId.startsWith("node:") || selectedNodeId.startsWith("spec:") : false;
  const onDeleteSelected = useCallback(() => {
    if (!selectedNodeId) {
      return;
    }
    if (!(selectedNodeId.startsWith("node:") || selectedNodeId.startsWith("spec:"))) {
      return;
    }
    // Keep it simple; we can replace with a nice modal later.
    const ok = window.confirm(`Delete ${selectedNodeId}? This edits the source code.`);
    if (!ok) {
      return;
    }
    postToExtension({ type: "ui.node.deleteRequest", nodeId: selectedNodeId });
  }, [selectedNodeId]);

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

      if (msg.type === "graph.error") {
        setNodes([
          {
            id: "error",
            position: { x: 40, y: 40 },
            data: { label: `error: ${msg.error}`, nodeId: "error", name: "error", kind: "workflow", ports: [], onAi, onDescribe },
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

      if (msg.type === "ai.prompt") {
        setPromptModal({ nodeId: msg.nodeId, title: msg.title, prompt: msg.prompt });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [aiByNodeId, onAi, onDescribe, selectedNodeId, setEdges, setNodes]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isSelected: selectedNodeId === n.id,
        },
      }))
    );
  }, [selectedNodeId, setNodes]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    // Keep React Flow's internal selection from forcing a deselect on mouseup.
    // Our selection model is click-complete (pointer up) based.
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
      // Don't interfere with modals.
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (aiModalNodeId) {
        return;
      }

      // Don't hijack delete while typing.
      const t = e.target as unknown;
      if (t && typeof t === "object") {
        const el = t as { tagName?: string; isContentEditable?: boolean };
        const tag = (el.tagName ?? "").toLowerCase();
        if (el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") {
          return;
        }
      }

      if (e.key !== "Delete" && e.key !== "Backspace") {
        return;
      }

      if (!selectedNodeId) {
        return;
      }

      // Basic guard: workflows are code structure; we don't delete them for now.
      if (selectedNodeId.startsWith("workflow:")) {
        return;
      }

      e.preventDefault();
      postToExtension({ type: "ui.node.deleteRequest", nodeId: selectedNodeId });
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [aiModalNodeId, selectedNodeId]);

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
        <span className="badge">{uiModeLabel}</span>
        <span className="badge">nodes: {stats.nodes}</span>
        <span className="badge">edges: {stats.edges}</span>

        <div className="holonHeaderActions">
          <button type="button" className="holonHeaderButton" onClick={onDeleteSelected} disabled={!canDeleteSelected}>
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

      {aiModalNodeId ? (
        <div
          className="holonModalOverlay nodrag nopan"
          role="dialog"
          aria-modal="true"
          onPointerDown={(e) => {
            // Click outside closes.
            if (e.target === e.currentTarget) {
              closeAiModal();
            }
          }}
        >
          <div
            className="holonModal"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="holonModalHeader">
              <strong>AI edit</strong>
              <span className="holonModalSub">{aiModalNodeId}</span>
            </div>
            <textarea
              className="nodrag nopan holonModalTextarea"
              ref={aiTextareaRef}
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeAiModal();
                  return;
                }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.stopPropagation();
                  submitAiModal();
                }
              }}
              placeholder={
                aiModalNodeId.startsWith("spec:")
                  ? "Describe what you want this node to do / how to configure it (Copilot will edit spec(...))."
                  : "Describe the change you want in this node's code (Copilot will patch the function)."
              }
            />
            <div className="holonModalButtons">
              <button
                type="button"
                className="nodrag nopan holonButton"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerDownCapture={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClickCapture={(e) => e.stopPropagation()}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  closeAiModal();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  closeAiModal();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="nodrag nopan holonButton holonButtonPrimary"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerDownCapture={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClickCapture={(e) => e.stopPropagation()}
                disabled={!aiInstruction.trim()}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  submitAiModal();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  submitAiModal();
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {promptModal ? (
        <div
          className="holonModalOverlay nodrag nopan"
          role="dialog"
          aria-modal="true"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              closePromptModal();
            }
          }}
        >
          <div className="holonModal" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className="holonModalHeader">
              <strong>{promptModal.title}</strong>
              <span className="holonModalSub">{promptModal.nodeId}</span>
            </div>
            <textarea className="nodrag nopan holonModalTextarea" readOnly value={promptModal.prompt} />
            <div className="holonModalButtons">
              <button type="button" className="nodrag nopan holonButton" onClick={closePromptModal}>
                Close
              </button>
              <button
                type="button"
                className="nodrag nopan holonButton holonButtonPrimary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(promptModal.prompt);
                  } catch {
                    // Fallback: do nothing; user can still select/copy.
                  }
                }}
              >
                Copy
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
