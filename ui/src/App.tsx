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
import EdgeWithDelete from "./components/EdgeWithDelete";

import { ToUiMessageSchema, type CoreEdge, type CoreNode } from "./protocol";
import { postToHost } from "./vscodeBridge";
import { inferPorts, getNodeConnectionRole, type NodeConnectionRole, type PortSpec } from "./ports";
import { ConfigPanel } from "./ConfigPanel";
import { CredentialsModal } from "./CredentialsModal";
import { NodeSearchModal } from "./NodeSearchModal";
import { PortLibraryPanel } from "./components/PortLibraryPanel";
import { EdgeInspector } from "./components/EdgeInspector";
import { ChatNode } from "./components/ChatNode";
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
  kind: "node" | "workflow" | "spec";
  nodeType?: string;
  connectionRole: NodeConnectionRole;
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
    // Normalize node_type (Python snake_case) to nodeType (TypeScript camelCase)
    const nodeType = (n as any).nodeType ?? (n as any).node_type;
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
        : inferPorts({ kind: n.kind, nodeType: nodeType ?? undefined });
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
        ...(typeof nodeType === "string" ? { nodeType } : {}),
        connectionRole: getNodeConnectionRole(nodeType),
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
    type: "holonEdge",
    data: {
      source: e.source,
      target: e.target,
      sourcePort: e.sourcePort,
      targetPort: e.targetPort,
    }
  }));
}

function PortTooltip({ port }: { port: PortSpec }) {
  const isResponsePort = port.kind === "response";
  
  return (
    <div className={`portTooltip portTooltip-${port.direction === 'input' ? 'top' : 'bottom'}`}>
      {port.id}
      {port.label && port.label !== port.id && <span style={{ opacity: 0.7, marginLeft: 4 }}>({port.label})</span>}
      {port.kind && <span className="portTooltip-kind">{port.kind}</span>}
      {isResponsePort && (
        <div style={{ 
          marginTop: '6px', 
          fontSize: '11px', 
          color: 'rgba(168, 85, 247, 1)', 
          fontWeight: '500',
          borderTop: '1px solid rgba(168, 85, 247, 0.3)',
          paddingTop: '4px'
        }}>
          ↺ Loop re-entry point
          <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
            Receives workflow output to continue conversation
          </div>
        </div>
      )}
    </div>
  );
}

function HolonNode(props: NodeProps<UiNodeData>): JSX.Element {
  const { data, selected } = props;

  // Check if this is a trigger node
  const isTrigger = data.nodeType?.startsWith("trigger.");
  const isProviderNode = data.connectionRole === "provider";

  // If this is a ui.chat or trigger.chat node, render ChatNode component
  if (data.nodeType === "ui.chat" || data.nodeType === "trigger.chat") {
    return <ChatNode id={data.nodeId} data={{ label: data.label, props: data.props || {} }} />;
  }

  const status = data.aiStatus?.status ?? "idle";
  const canAiEdit = data.nodeId.startsWith("node:") || data.nodeId.startsWith("spec:");
  const canDescribe = data.nodeId.startsWith("node:") || data.nodeId.startsWith("spec:");

  const stop = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
  };

  const flowInput = data.ports.find((p) => p.direction === "input" && (p.kind === "data" || !p.kind));
  const flowOutput = data.ports.find((p) => p.direction === "output" && (p.kind === "data" || !p.kind));
  
  // Response ports are special - they go to bottom-left for triggers
  const responsePorts = data.ports.filter((p) => p.kind === "response");

  const configPorts = data.ports.filter((p) =>
    p !== flowInput && p !== flowOutput && p.kind !== "response"
  );
  const topConfigPorts = isProviderNode ? configPorts : [];
  const bottomConfigPorts = isProviderNode ? [] : configPorts;

  const nodeClasses = [
    'holonNode',
    selected ? 'holonNode-selected' : '',
    data.hasError ? 'holonNode-error' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={nodeClasses}>
      <div className="holonNodeInner">
        {/* Main Flow Input (Left Center) */}
        {flowInput && (
          <div style={{ position: 'absolute', left: '-6px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}>
            <Handle
              type="target"
              position={HandlePosition.Left}
              id={flowInput.id}
              className={`holonHandle holonHandle-${flowInput.kind ?? "data"} ${flowInput.multi ? 'holonHandle-multi' : ''}`}
            />
            <div className="group hidden hover:block">
              <PortTooltip port={flowInput} />
            </div>
          </div>
        )}

        {/* Main Flow Output (Right Center) */}
        {flowOutput && (
          <div style={{ position: 'absolute', right: '-6px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}>
            <Handle
              type="source"
              position={HandlePosition.Right}
              id={flowOutput.id}
              className={`holonHandle holonHandle-${flowOutput.kind ?? "data"} ${flowOutput.multi ? 'holonHandle-multi' : ''}`}
            />
            <div className="group hidden hover:block">
              <PortTooltip port={flowOutput} />
            </div>
          </div>
        )}

        <div className="holonNodeTop">
          <div>
            <div className="holonNodeTitle">
              {data.label}
              {isTrigger && (
                <span style={{ marginLeft: '8px', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#60a5fa', fontWeight: 'bold' }}>
                  ▶ TRIGGER
                </span>
              )}
            </div>
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

        {/* Response Ports (Bottom-Left Corner for triggers) - Re-entry point for conversation loops */}
        {responsePorts.length > 0 && responsePorts.map((p) => (
          <div key={p.id} style={{ 
            position: 'absolute', 
            left: '4px',  // Coin gauche
            bottom: '4px', // Coin bas
            zIndex: 10,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '6px'
          }}>
            {/* Loop indicator */}
            <div style={{ 
              fontSize: '16px', 
              color: 'rgba(168, 85, 247, 0.9)',
              fontWeight: 'bold',
              textShadow: '0 0 4px rgba(168, 85, 247, 0.5)',
              lineHeight: '1'
            }}>
              ↺
            </div>
            <Handle
              type="target"
              position={HandlePosition.Left}
              id={p.id}
              className={`holonHandle holonHandle-response ${p.multi ? 'holonHandle-multi' : ''}`}
              style={{ 
                position: 'relative', 
                transform: 'none', 
                background: 'rgba(168, 85, 247, 0.9)',
                border: '2px solid rgba(168, 85, 247, 1)',
                boxShadow: '0 0 10px rgba(168, 85, 247, 0.6)',
                width: '14px',
                height: '14px'
              }}
            />
            <div style={{ 
              fontSize: '9px', 
              color: 'rgba(168, 85, 247, 0.95)', 
              fontWeight: '700',
              whiteSpace: 'nowrap',
              background: 'rgba(168, 85, 247, 0.15)',
              padding: '3px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)'
            }}>
              {p.label || p.id}
            </div>
            <div className="group hidden hover:block">
              <PortTooltip port={p} />
            </div>
          </div>
        ))}

        {/* Provider Ports (Top) */}
        {topConfigPorts.length > 0 && (
          <div
            className="holonNodeProviderPorts"
            style={{
              position: 'absolute',
              top: '-8px',
              left: '0',
              right: '0',
              zIndex: 10,
              display: 'flex',
              gap: '10px',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}
          >
            {topConfigPorts.map((p) => (
              <div key={p.id} style={{ position: 'relative' }} className="group">
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Handle
                    type={p.direction === 'input' ? "target" : "source"}
                    position={HandlePosition.Top}
                    id={p.id}
                    className={`holonHandle holonHandle-${p.kind ?? "data"} ${p.multi ? 'holonHandle-multi' : ''}`}
                    style={{ position: 'relative', transform: 'none', left: 0, top: 0 }}
                  />
                </div>
                <div style={{ opacity: 0, transition: 'opacity 0.2s', position: 'absolute', pointerEvents: 'none' }} className="group-hover:opacity-100">
                  <PortTooltip port={p} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Config Ports (Bottom) */}
        {bottomConfigPorts.length > 0 && (
          <div className="holonNodeConfigPorts" style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {bottomConfigPorts.map((p) => (
              <div key={p.id} style={{ position: 'relative' }} className="group">
                <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '2px', textAlign: 'center' }}>
                  {p.label || p.id}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Handle
                    type={p.direction === 'input' ? "target" : "source"}
                    position={HandlePosition.Bottom}
                    id={p.id}
                    className={`holonHandle holonHandle-${p.kind ?? "data"} ${p.multi ? 'holonHandle-multi' : ''}`}
                    style={{ position: 'relative', transform: 'none', left: 0, top: 0 }}
                  />
                </div>
                {/* Tooltip on hover */}
                <div style={{ opacity: 0, transition: 'opacity 0.2s', position: 'absolute', pointerEvents: 'none' }} className="group-hover:opacity-100">
                  <PortTooltip port={p} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<UiNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const nodeTypes = useMemo(() => ({ holon: HolonNode }), []);
  const edgeTypes = useMemo(() => ({ holonEdge: EdgeWithDelete }), []);

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
    postToHost({ type: "ui.credentials.set", provider, credentials: creds });
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
    postToHost({ type: "ui.node.aiRequest", nodeId: aiModalNodeId, instruction });
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
    postToHost({ type: "ui.node.describeRequest", nodeId });
  }, []);

  const onDeleteNode = useCallback((nodeId: string) => {
    const ok = window.confirm(`Delete ${nodeId}? This edits the source code.`);
    if (!ok) {
      return;
    }
    postToHost({ type: "ui.node.deleteRequest", nodeId });
  }, []);

  const onPatchNode = useCallback((nodeId: string, props: Record<string, any>) => {
    postToHost({ type: "ui.node.patchRequest", nodeId, props });
  }, []);

  const onRunWorkflow = useCallback(() => {
    // Execute the main workflow (no longer depends on selecting a workflow node)
    console.log("onRunWorkflow: executing workflow 'main'");
    postToHost({ type: "ui.workflow.run", workflowName: "main" });
    console.log("posted ui.workflow.run", "main");
  }, [coreNodes]);

  useEffect(() => {
    postToHost({ type: "ui.ready" });
  }, []);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
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

      // Chat message handlers
      if (msg.type === "chat.messageReceived") {
        const { useChatStore } = await import("./store/chat.store");
        useChatStore.getState().receiveEnvelope(msg.nodeId, msg.envelope);
      }

      if (msg.type === "chat.event") {
        const { useChatStore } = await import("./store/chat.store");
        const { event, nodeId } = msg;

        if (event.action === "clear_history") {
          useChatStore.getState().clearHistory(nodeId);
        } else if (event.action === "message_sent") {
          useChatStore.getState().setWaiting(nodeId, false);
        } else if (event.action === "error") {
          useChatStore.getState().setWaiting(nodeId, false);
          console.error("Chat error:", event.details);
        }
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
    postToHost({
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
    postToHost({ type: "ui.nodesChanged", nodes: [{ id: node.id, position: node.position }] });
  };

  const onAutoLayout = useCallback(() => {
    const next = layoutWithDagre(nodes, edges, { direction: "LR" });
    if (next.length === 0) {
      return;
    }
    setNodes(next);
    postToHost({
      type: "ui.nodesChanged",
      nodes: next.map((n) => ({ id: n.id, position: n.position })),
    });
  }, [edges, nodes, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }
    postToHost({
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
            edgeTypes={edgeTypes}
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
          executionOutput={executionOutput}
        />

        {/* Global Workflow Play Button */}
        <button
          type="button"
          onClick={onRunWorkflow}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-16 py-6 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white font-black text-xl uppercase tracking-widest shadow-2xl hover:shadow-blue-500/50 hover:scale-105 transition-all duration-300 flex items-center gap-4"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          Run Workflow
        </button>
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

      <NodeSearchModal isOpen={isNodeSearchOpen} onClose={closeNodeSearch} existingNodes={coreNodes} />

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
