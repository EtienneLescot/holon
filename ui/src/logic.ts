import { CoreNode, CoreEdge, CoreGraph } from "./protocol";
import { inferPorts, type PortSpec } from "./ports";

export type UiNode = CoreNode & {
  ports: PortSpec[];
};

export type UiEdge = CoreEdge & {
  sourcePort: string;
  targetPort: string;
  kind: "code" | "link";
};

/**
 * Shared logic to transform a raw CoreGraph into a UI-ready graph.
 * This is the SINGLE SOURCE OF TRUTH for how data is prepared for the React Flow canvas.
 */
export function prepareUiGraph(
  graph: any, // Use any here because input might be snake_case (backend) or camelCase
  positions: Record<string, { x: number; y: number }>,
  annotations: Record<string, { summary?: string; badges?: string[] }>
): { nodes: UiNode[]; edges: UiEdge[] } {
  const nodes: UiNode[] = (graph.nodes || []).map((n: any) => {
    const pos = positions[n.id];
    const ann = annotations[n.id];

    // Map snake_case from backend or camelCase from webview
    const nodeType = n.nodeType ?? n.node_type;
    const label = n.label ?? (n.kind === "workflow" ? `workflow: ${n.name}` : n.name);

    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      label,
      nodeType,
      props: n.props,
      position: pos || n.position || { x: 0, y: 0 },
      summary: ann?.summary || n.summary,
      badges: ann?.badges || n.badges,
      ports: n.ports || inferPorts({ kind: n.kind, nodeType }),
    } as UiNode;
  });

  const edges: UiEdge[] = (graph.edges || []).map((e: any) => {
    const sourcePort = e.sourcePort ?? e.source_port ?? "output";
    const targetPort = e.targetPort ?? e.target_port ?? "input";
    const kind = e.kind ?? "code";

    return {
      source: e.source,
      target: e.target,
      sourcePort,
      targetPort,
      kind,
    } as UiEdge;
  });

  // Deduplicate edges
  const seen = new Set<string>();
  const dedupedEdges = edges.filter((e) => {
    const key = `${e.kind}:${e.source}:${e.sourcePort}->${e.target}:${e.targetPort}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { nodes, edges: dedupedEdges };
}

/**
 * Shared logic to extract a top-level function from Python source.
 */
export function extractTopLevelFunction(source: string, functionName: string): string | undefined {
  const lines = source.split(/\r?\n/);
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const defRe = new RegExp(`^(?<indent>\\s*)(async\\s+def|def)\\s+${escapedName}\\s*\\(`);

  let defLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(defRe);
    if (m && (m.groups?.["indent"] || "").length === 0) {
      defLine = i;
      break;
    }
  }

  if (defLine === -1) return undefined;

  let start = defLine;
  for (let i = defLine - 1; i >= 0; i--) {
    const line = lines[i] || "";
    if (line.trim().startsWith("@") || line.trim() === "") {
      if (line.trim().startsWith("@")) start = i;
    } else {
      break;
    }
  }

  let end = lines.length;
  const boundaryRe = /^(@|def\b|async\s+def\b|class\b)/;
  for (let i = defLine + 1; i < lines.length; i++) {
    const line = lines[i] || "";
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && boundaryRe.test(line)) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trimEnd() + "\n";
}

/**
 * Shared validation rules for spec props.
 */
export function validateSpecProps(nodeType: string, props: Record<string, any>): void {
  const ensureString = (k: string) => {
    if (props[k] !== undefined && typeof props[k] !== "string") {
      throw new Error(`props.${k} must be a string`);
    }
  };
  const ensureNumber = (k: string) => {
    if (props[k] !== undefined && typeof props[k] !== "number") {
      throw new Error(`props.${k} must be a number`);
    }
  };

  switch (nodeType) {
    case "langchain.agent":
      ensureString("system_prompt");
      ensureString("user_prompt");
      break;
    case "llm.model":
      ensureString("model_name");
      ensureNumber("temperature");
      break;
    case "memory.buffer":
      ensureNumber("maxMessages");
      break;
    default:
      break;
  }
}
