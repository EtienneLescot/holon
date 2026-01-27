import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useEdgesState,
  useNodesState,
  type NodeDragHandler,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

import { ToUiMessageSchema, type CoreEdge, type CoreNode } from "./protocol";
import { postToExtension } from "./vscodeBridge";

type UiNodeData = {
  label: string;
  nodeId: string;
  name: string;
  kind: "node" | "workflow";
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
    return {
      id: n.id,
      position,
      data: {
        label: `${n.kind}: ${n.name}`,
        nodeId: n.id,
        name: n.name,
        kind: n.kind,
        ...(aiStatus ? { aiStatus } : {}),
        onAi: opts.onAi,
      },
      type: "holon",
    };
  });
}

function toReactFlowEdges(input: CoreEdge[]): Edge[] {
  return input.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    animated: false,
  }));
}

function HolonNode(props: NodeProps<UiNodeData>): JSX.Element {
  const { data } = props;
  const status = data.aiStatus?.status ?? "idle";

  return (
    <div className="holonNode">
      <div className="holonNodeTop">
        <div className="holonNodeTitle">{data.label}</div>
        <button
          className="holonAiButton"
          onClick={() => data.onAi(data.nodeId)}
          disabled={status === "working"}
          title={status === "working" ? "AI working..." : "Ask Copilot to patch this node"}
          type="button"
        >
          AI
        </button>
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
            data: { label: `error: ${msg.error}`, nodeId: "error", name: "error", kind: "workflow", onAi },
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

  const stats = useMemo(() => ({ nodes: nodes.length, edges: edges.length }), [nodes.length, edges.length]);

  return (
    <div className="holonRoot">
      <div className="header">
        <strong>Holon</strong>
        <span className="badge">Phase 4</span>
        <span className="badge">nodes: {stats.nodes}</span>
        <span className="badge">edges: {stats.edges}</span>
      </div>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
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
              className="holonModalTextarea"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="Describe the change you want (e.g. 'Add basic input validation and return a default on error')."
            />
            <div className="holonModalButtons">
              <button
                type="button"
                className="holonButton"
                onClick={() => {
                  setAiModalNodeId(null);
                  setAiInstruction("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="holonButton holonButtonPrimary"
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
