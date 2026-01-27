import { useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useEdgesState,
  useNodesState,
  type NodeDragHandler,
} from "reactflow";
import "reactflow/dist/style.css";

import { ToUiMessageSchema, type CoreNode } from "./protocol";
import { postToExtension } from "./vscodeBridge";

type UiNodeData = {
  label: string;
};

function toReactFlowNodes(input: CoreNode[]): Array<Node<UiNodeData>> {
  return input.map((n, idx) => {
    const position = n.position ?? { x: 40 + idx * 220, y: n.kind === "workflow" ? 60 : 180 };
    return {
      id: n.id,
      position,
      data: { label: `${n.kind}: ${n.name}` },
      type: "default",
    };
  });
}

export default function App(): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<UiNodeData>([]);
  const [edges, , onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    postToExtension({ type: "ui.ready" });

    const handler = (event: MessageEvent) => {
      const parsed = ToUiMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        return;
      }

      const msg = parsed.data;
      if (msg.type === "graph.init") {
        setNodes(toReactFlowNodes(msg.nodes));
      }

      if (msg.type === "graph.error") {
        setNodes([
          {
            id: "error",
            position: { x: 40, y: 40 },
            data: { label: `error: ${msg.error}` },
          },
        ]);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [setNodes]);

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
          fitView
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
