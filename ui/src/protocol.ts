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

export const GraphInitSchema = z.object({
  type: z.literal("graph.init"),
  nodes: z.array(CoreNodeSchema),
});

export const GraphErrorSchema = z.object({
  type: z.literal("graph.error"),
  error: z.string(),
});

export const ToUiMessageSchema = z.union([GraphInitSchema, GraphErrorSchema]);
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

export const ToExtensionMessageSchema = z.union([UiReadySchema, UiNodesChangedSchema]);
export type ToExtensionMessage = z.infer<typeof ToExtensionMessageSchema>;
