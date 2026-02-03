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
import { CredentialsModal } from "./CredentialsModal";
import { NodeSearchModal } from "./NodeSearchModal";
import { PortLibraryPanel } from "./components/PortLibraryPanel";
import { EdgeInspector } from "./components/EdgeInspector";
import { 
  useGraphStore, 
  useUIStore, 
  useExecutionStore, 
  useCredentialsStore,
  useNodeTypesStore,
  useMappingStore,
  type AiStatus 
} from "./store";

type UiNodeData = {
  label: string;
  nodeId: string;
  name: string;
  kind: "node" | "workflow";
  nodeType?: string;
  props?: Record<string, unknown>;
  ports: PortSpec[];
  summary?: string;
  badges?: string[];
  aiStatus?: AiStatus;
  isSelected?: boolean;
  hasError?: boolean;
  onAi: (nodeId: string) => void;
  onDescribe: (nodeId: string) => void;
};

// Remove duplicate type - now imported from store

function toReactFlowNodes(
  input: CoreNode[],
  opts: {
    onAi: (nodeId: string) => void;
    onDescribe: (nodeId: string) => void;
    aiByNodeId: Record<string, AiStatus | undefined>;
    selectedNodeId: string | null;
    executionOutput: Record<string, any> | null;
  }
):
  Array<Node<UiNodeData>> {
  return input.map((n, idx) => {
    const position = n.position ?? { x: 40 + idx * 220, y: n.kind === "workflow" ? 60 : 180 };
    const aiStatus = opts.aiByNodeId[n.id];
    const hasError = opts.executionOutput?.[n.id]?.status === "error";
    const ports: PortSpec[] =
      n.ports && n.ports.length > 0
        ? n.ports.map((p) => {
            const out: PortSpec = {
              id: p.id,
              direction: p.direction as "input" | "output",
            };
            if (typeof p.kind === "string") {
              out.kind = p.kind as any;
            }
            if (typeof p.label === "string") {
              out.label = p.label;
            }
            if (typeof p.multi === "boolean") {
              out.multi = p.multi;
            }
            return out;
          })
        : inferPorts({ kind: n.kind, nodeType: n.nodeType ?? undefined });
    const summary = n.summary;
    const badges = n.badges;
    return {
      id: n.id,
      position,
      selected: opts.selectedNodeId === n.id,
      data: {
        label: n.label ?? `${n.kind}: ${n.name}`,
        nodeId: n.id,
        name: n.name,
        kind: n.kind,
        ...(typeof n.nodeType === "string" ? { nodeType: n.nodeType } : {}),
        ...(n.props && typeof n.props === "object" ? { props: n.props } : {}),
        ports,
        ...(typeof summary === "string" ? { summary } : {}),
        ...(Array.isArray(badges) ? { badges } : {}),
        ...(aiStatus ? { aiStatus } : {}),
        ...(hasError ? { hasError } : {}),
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
  const { data, selected } = props;
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
  
  const nodeClasses = [
    'holonNode',
    selected ? 'holonNode-selected' : '',
    data.hasError ? 'holonNode-error' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={nodeClasses}>
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
  
  // Zustand stores
  const coreNodes = useGraphStore(s => s.nodes);
  const aiByNodeId = useGraphStore(s => s.aiStatusByNodeId);
  const { setGraph, setAiStatus } = useGraphStore(s => s.actions);
  
  const selectedNodeId = useUIStore(s => s.selectedNodeId);
  const aiModalNodeId = useUIStore(s => s.aiModalNodeId);
  const aiInstruction = useUIStore(s => s.aiInstruction);
  const promptModal = useUIStore(s => s.promptModal);
  const {
    selectNode,
    openAiModal,
    closeAiModal: closeAiModalAction,
    setAiInstruction,
    closePromptModal: closePromptModalAction,
    openPromptModal,
  } = useUIStore(s => s.actions);
  
  const executionOutput = useExecutionStore(s => s.output);
  const { setOutput: setExecutionOutput } = useExecutionStore(s => s.actions);
  
  const credentialsIsOpen = useCredentialsStore(s => s.isModalOpen);
  const credentialsProvider = useCredentialsStore(s => s.currentProvider);
  const credentials = useCredentialsStore(s => s.credentials);
  const { setCredentials, openModal: openCredentialsModal, closeModal: closeCredentialsModal } = useCredentialsStore(s => s.actions);
  
  const isNodeSearchOpen = useUIStore(s => s.isNodeSearchOpen);
  const { openNodeSearch, closeNodeSearch } = useUIStore(s => s.actions);
  
  const { setNodeTypes } = useNodeTypesStore(s => s.actions);
  
  const { isLibraryOpen, toggleLibrary, closeLibrary } = useMappingStore();
  
  // Edge inspector state
  const [edgeInspector, setEdgeInspector] = useState<{
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourcePort: string;
    targetPort: string;
    position: { x: number; y: number };
  } | null>(null);
  
  const aiTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const executionOutputRef = useRef<Record<string, any> | null>(null);
  
  useEffect(() => {
    executionOutputRef.current = executionOutput;
  }, [executionOutput]);

  const onSaveCredentials = useCallback((provider: string, creds: Record<string, string>) => {
    setCredentials(provider, creds);
    postToExtension({ type: "ui.credentials.set", provider, credentials: creds });
  }, [setCredentials]);

  const onAi = useCallback((nodeId: string) => {
    openAiModal(nodeId);
  }, [openAiModal]);

  const closeAiModal = useCallback(() => {
    closeAiModalAction();
  }, [closeAiModalAction]);

  const closePromptModal = useCallback(() => {
    closePromptModalAction();
  }, [closePromptModalAction]);

  const submitAiModal = useCallback(() => {
    if (!aiModalNodeId) {
      return;
    }
    const instruction = aiInstruction.trim();
    if (!instruction) {
      return;
    }
    postToExtension({ type: "ui.node.aiRequest", nodeId: aiModalNodeId, instruction });
    closeAiModalAction();
  }, [aiInstruction, aiModalNodeId, closeAiModalAction]);

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

  const onPatchNode = useCallback((nodeId: string, props: Record<string, any>) => {
    postToExtension({ type: "ui.node.patchRequest", nodeId, props });
  }, []);
  
  const onRunWorkflow = useCallback(() => {
    // Find the workflow node name from selected node
    const workflowNode = coreNodes.find(n => n.id === selectedNodeId && n.kind === "workflow");
    console.log("onRunWorkflow: selectedNodeId=", selectedNodeId, "workflowNode=", workflowNode);
    if (!workflowNode) return;
    postToExtension({ type: "ui.workflow.run", workflowName: workflowNode.name });
    console.log("posted ui.workflow.run", workflowNode.name);
  }, [selectedNodeId, coreNodes]);

  useEffect(() => {
    postToExtension({ type: "ui.ready" });
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Log all inbound postMessage events for debugging
      // eslint-disable-next-line no-console
      console.log("UI incoming message event:", event.data);
      // Ignore messages that don't have a type property or are from external sources
      if (!event.data || typeof event.data !== 'object' || !event.data.type || typeof event.data.type !== 'string') {
        return;
      }

      const parsed = ToUiMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        console.error("Zod validation failed for message:", event.data, parsed.error);
        return;
      }

      const msg = parsed.data;
      if (msg.type === "graph.init" || msg.type === "graph.update") {
        setGraph(msg.nodes, msg.edges);
        setNodes(toReactFlowNodes(msg.nodes, { onAi, onDescribe, aiByNodeId, selectedNodeId, executionOutput: executionOutputRef.current }));
        setEdges(toReactFlowEdges(msg.edges));
      }

      if (msg.type === "graph.error") {
        window.alert(`Graph Error: ${msg.error}`);
      }

      if (msg.type === "ai.status") {
        const next: AiStatus = msg.message ? { status: msg.status, message: msg.message } : { status: msg.status };
        setAiStatus(msg.nodeId, next);
        setNodes((prev) => prev.map((n) => n.id === msg.nodeId ? { ...n, data: { ...n.data, aiStatus: next } } : n));
      }

      if (msg.type === "ai.prompt") {
        openPromptModal({ nodeId: msg.nodeId, title: msg.title, prompt: msg.prompt });
      }

      if (msg.type === "credentials.update") {
        Object.entries(msg.credentials).forEach(([provider, creds]) => {
          setCredentials(provider, creds);
        });
      }
      
      if (msg.type === "workflow.executionResult") {
        setExecutionOutput(msg.output);
      }
      
      if (msg.type === "execution.output") {
        // eslint-disable-next-line no-console
        console.log("setting executionOutput:", msg.output);
        setExecutionOutput(msg.output);
      }
      
      if (msg.type === "nodeTypes.update") {
        console.log("Received nodeTypes.update:", msg.nodeTypes);
        setNodeTypes(msg.nodeTypes as any);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [aiByNodeId, onAi, onDescribe, selectedNodeId, setEdges, setNodes, setGraph, setAiStatus, openPromptModal, setCredentials, setExecutionOutput, setNodeTypes]);

  // Update nodes when executionOutput changes to show error states
  useEffect(() => {
    if (coreNodes.length > 0) {
      setNodes(toReactFlowNodes(coreNodes, { onAi, onDescribe, aiByNodeId, selectedNodeId, executionOutput }));
    }
  }, [executionOutput, coreNodes, onAi, onDescribe, aiByNodeId, selectedNodeId, setNodes]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const first = params.nodes && params.nodes.length > 0 ? params.nodes[0] : undefined;
    if (first) {
      selectNode(first.id);
    }
  }, [selectNode]);

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
    // Intercept removals to confirm with user before they disappear.
    // We only apply non-remove changes to the local state immediately.
    // Removals will be applied when the backend sends the updated graph.
    const toRemove = changes.filter((c) => c.type === "remove") as Array<{ id: string }>;
    for (const c of toRemove) {
      if (c.id.startsWith("node:") || c.id.startsWith("spec:")) {
        onDeleteNode(c.id);
      }
    }

    const filteredChanges = changes.filter((c) => c.type !== "remove");
    onNodesChange(filteredChanges);

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
  }, [onNodesChange, onDeleteNode, queuePositionUpdate]);

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
          <button 
            type="button" 
            className="holonHeaderButton holonHeaderButtonPrimary" 
            onClick={openNodeSearch}
          >
            + Add Node
          </button>
          <button 
            type="button" 
            className="holonHeaderButton" 
            onClick={toggleLibrary}
            title="Open Port Library for manual port mapping"
          >
            🔌 Port Library
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
            onNodeClick={(_e, n) => selectNode(n.id)}
            onPaneClick={() => {
              selectNode(null);
              setEdgeInspector(null);
            }}
            onEdgeClick={(_event, edge) => {
              // Extract port info from edge id (format: "nodeId:portId")
              const [sourceNodeId, sourcePort] = edge.source.split(':');
              const [targetNodeId, targetPort] = edge.target.split(':');
              
              // Position inspector near click
              const rect = (_event.target as HTMLElement)?.getBoundingClientRect();
              const x = rect ? rect.left + rect.width / 2 : 300;
              const y = rect ? rect.top + rect.height / 2 : 200;
              
              setEdgeInspector({
                edgeId: edge.id,
                sourceNodeId: sourceNodeId || edge.source,
                targetNodeId: targetNodeId || edge.target,
                sourcePort: sourcePort || 'output',
                targetPort: targetPort || 'input',
                position: { x, y },
              });
            }}
            nodeTypes={nodeTypes}
            noDragClassName="nodrag"
            noPanClassName="nopan"
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
        <ConfigPanel
          node={selectedCoreNode}
          onClose={() => selectNode(null)}
          onDelete={onDeleteNode}
          onPatch={onPatchNode}
          onOpenCredentials={(provider) => openCredentialsModal(provider)}
          onRunWorkflow={onRunWorkflow}
          executionOutput={executionOutput}
        />
      </div>

      <CredentialsModal
        isOpen={credentialsIsOpen}
        provider={credentialsProvider}
        initialCreds={credentials[credentialsProvider]}
        onClose={() => closeCredentialsModal()}
        onSave={onSaveCredentials}
      />

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

      <NodeSearchModal isOpen={isNodeSearchOpen} onClose={closeNodeSearch} />

      {isLibraryOpen && (
        <PortLibraryPanel onClose={closeLibrary} />
      )}

      {edgeInspector && (
        <EdgeInspector
          edgeId={edgeInspector.edgeId}
          sourceNodeId={edgeInspector.sourceNodeId}
          targetNodeId={edgeInspector.targetNodeId}
          sourcePort={edgeInspector.sourcePort}
          targetPort={edgeInspector.targetPort}
          position={edgeInspector.position}
          onClose={() => setEdgeInspector(null)}
          onEdit={() => {
            // TODO: Open MappingEditorModal in edit mode
            setEdgeInspector(null);
          }}
        />
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
