import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const HolonKindSchema = z.union([z.literal("node"), z.literal("workflow"), z.literal("spec")]);

export const PortDirectionSchema = z.union([z.literal("input"), z.literal("output")]);

export const PortKindSchema = z.union([
  z.literal("data"),
  z.literal("llm"),
  z.literal("memory"),
  z.literal("tool"),
  z.literal("parser"),
  z.literal("control"),
]);

export const PortSpecSchema = z.object({
  id: z.string(),
  direction: PortDirectionSchema,
  kind: PortKindSchema.optional(),
  label: z.string().optional(),
  multi: z.boolean().optional(),
});

export const CoreNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: HolonKindSchema,
  position: PositionSchema.nullable().optional(),
  label: z.string().optional(),
  nodeType: z.string().optional(),
  summary: z.string().optional(),
  badges: z.array(z.string()).optional(),
  ports: z.array(PortSpecSchema).optional(),
});

export type CoreNode = z.infer<typeof CoreNodeSchema>;

export const CoreEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  sourcePort: z.string().nullable().optional(),
  targetPort: z.string().nullable().optional(),
  kind: z.union([z.literal("code"), z.literal("link")]).optional(),
});

export type CoreEdge = z.infer<typeof CoreEdgeSchema>;

export const GraphInitSchema = z.object({
  type: z.literal("graph.init"),
  nodes: z.array(CoreNodeSchema),
  edges: z.array(CoreEdgeSchema),
});

export const GraphUpdateSchema = z.object({
  type: z.literal("graph.update"),
  nodes: z.array(CoreNodeSchema),
  edges: z.array(CoreEdgeSchema),
});

export const GraphErrorSchema = z.object({
  type: z.literal("graph.error"),
  error: z.string(),
});

export const AiStatusSchema = z.object({
  type: z.literal("ai.status"),
  nodeId: z.string(),
  status: z.union([z.literal("idle"), z.literal("working"), z.literal("error"), z.literal("done")]),
  message: z.string().optional(),
});

export const ToUiMessageSchema = z.union([GraphInitSchema, GraphUpdateSchema, GraphErrorSchema, AiStatusSchema]);
export type ToUiMessage = z.infer<typeof ToUiMessageSchema>;

export const UiReadySchema = z.object({
  type: z.literal("ui.ready"),
});

export const UiNodesChangedSchema = z.object({
  type: z.literal("ui.nodesChanged"),
  nodes: z.array(
    z.object({
      id: z.string(),
      position: PositionSchema,
    })
  ),
});

export const UiNodeAiRequestSchema = z.object({
  type: z.literal("ui.node.aiRequest"),
  nodeId: z.string(),
  instruction: z.string(),
});

export const UiNodeDescribeRequestSchema = z.object({
  type: z.literal("ui.node.describeRequest"),
  nodeId: z.string(),
});

export const UiEdgeCreatedSchema = z.object({
  type: z.literal("ui.edgeCreated"),
  edge: z.object({
    source: z.string(),
    target: z.string(),
    sourcePort: z.string().nullable().optional(),
    targetPort: z.string().nullable().optional(),
  }),
});

export const UiNodeCreatedSchema = z.object({
  type: z.literal("ui.nodeCreated"),
  node: z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    inputs: z
      .array(z.object({ id: z.string(), kind: PortKindSchema.optional(), label: z.string().optional(), multi: z.boolean().optional() }))
      .optional()
      .default([]),
    outputs: z
      .array(z.object({ id: z.string(), kind: PortKindSchema.optional(), label: z.string().optional(), multi: z.boolean().optional() }))
      .optional()
      .default([]),
    props: z.record(z.unknown()).optional(),
  }),
  position: PositionSchema.optional(),
});

export const ToExtensionMessageSchema = z.union([
  UiReadySchema,
  UiNodesChangedSchema,
  UiNodeAiRequestSchema,
  UiNodeDescribeRequestSchema,
  UiEdgeCreatedSchema,
  UiNodeCreatedSchema,
]);
export type ToExtensionMessage = z.infer<typeof ToExtensionMessageSchema>;
