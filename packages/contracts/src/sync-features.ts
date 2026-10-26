import { z } from "zod";

export const projectSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(100),
  parentId: z.uuid().nullable().default(null), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#b49bdf"),
  favorite: z.boolean().default(false),
  sections: z.array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100) })).max(100).default([]),
  /** Board columns hidden in this project: section IDs, or "none" for the No section column. */
  hiddenColumns: z.array(z.string().max(36)).max(101).optional(),
});
export const recoveryInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  expectedAccountId: z.uuid().optional(),
  password: z.string().min(12).max(128), recoveryCode: z.string().regex(/^[0-9a-f]{64}$/i),
});
export const syncFeatureCommandSchemas = [
  z.object({ type: z.literal("sync.recovery.create") }),
  recoveryInputSchema.extend({ type: z.literal("sync.recover"), endpoint: z.string().url() }),
  z.object({ type: z.literal("sync.devices") }),
  z.object({ type: z.literal("sync.device.revoke"), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ type: z.literal("sync.project.share"), project: projectSchema }),
  z.object({ type: z.literal("sync.project.invite"), projectId: z.uuid(), email: z.string().trim().toLowerCase().pipe(z.email()) }),
  z.object({ type: z.literal("sync.project.remove"), projectId: z.uuid(), email: z.string().trim().toLowerCase().pipe(z.email()) }),
] as const;
export const syncFeatureCommandSchema = z.discriminatedUnion("type", syncFeatureCommandSchemas);
export type SyncFeatureCommand = z.infer<typeof syncFeatureCommandSchema>;
export const sharedProjectSchema = projectSchema.extend({
  ownerEmail: z.email(), members: z.array(z.object({ email: z.email(), role: z.enum(["owner", "member"]) })),
});
export const deviceSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/), name: z.string().max(100), expiresAt: z.iso.datetime(), current: z.boolean(),
});
export const syncFeaturesSchema = z.object({
  recoveryCode: z.string().default(""), devices: z.array(deviceSchema).default([]),
  projects: z.array(sharedProjectSchema).default([]), error: z.string().default(""),
}).default({ recoveryCode: "", devices: [], projects: [], error: "" });
export type SyncFeatures = z.infer<typeof syncFeaturesSchema>;
export const sharedProjectsResponseSchema = z.object({ projects: z.array(sharedProjectSchema), records: z.array(z.object({ item: z.unknown(), version: z.number().int().positive() })) });

export const privateProjectsSchema = z.object({
  version: z.number().int().nonnegative(), projects: z.array(projectSchema).max(500),
});
export const privateProjectsMutationSchema = z.object({
  baseVersion: z.number().int().nonnegative(), mutationId: z.string().regex(/^[0-9a-f]{32}$/),
  projects: z.array(projectSchema).max(500),
});
export const privateProjectsResultSchema = privateProjectsSchema.extend({ accepted: z.boolean() });
