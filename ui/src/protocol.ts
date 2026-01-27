import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const HolonKindSchema = z.union([z.literal("node"), z.literal("workflow")]);

export const CoreNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: HolonKindSchema,
  position: PositionSchema.nullable().optional(),
});

export type CoreNode = z.infer<typeof CoreNodeSchema>;

export const CoreEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
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

export const ToExtensionMessageSchema = z.union([UiReadySchema, UiNodesChangedSchema, UiNodeAiRequestSchema]);
export type ToExtensionMessage = z.infer<typeof ToExtensionMessageSchema>;
