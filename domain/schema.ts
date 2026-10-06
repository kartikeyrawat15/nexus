import { z } from "zod";
import {
  ISSUE_KINDS, ISSUE_STATUSES, PRIORITIES, SPRINT_STATUSES,
  type ActivityChange, type InlineNode, type RichTextDocument, type Snapshot,
} from "./types";

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
  .refine((id) => !["__proto__", "constructor", "prototype"].includes(id), "Unsafe identifier");
export const timestampSchema = z.string().datetime({ offset: true });
export const titleSchema = z.string().trim().min(1).max(240);
export const blockerSchema = z.discriminatedUnion("blocked", [
  z.object({ blocked: z.literal(false), reason: z.null() }).strict(),
  z.object({ blocked: z.literal(true), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
const entity = {
  id: idSchema, createdAt: timestampSchema, updatedAt: timestampSchema,
  version: z.number().int().positive().safe(),
};
const text = z.object({
  type: z.literal("text"), text: z.string(), marks: z.array(z.enum(["bold", "italic", "code"])),
}).strict();
const inline = z.union([text, z.object({
  type: z.literal("link"),
  url: z.string().url().refine((url) => /^(https?:|mailto:)/i.test(url), "Unsafe link"),
  children: z.array(text),
}).strict()]);
export const richTextDocumentSchema: z.ZodType<RichTextDocument> = z.object({
  format: z.literal("nexus-rich-text"), version: z.literal(1),
  root: z.object({ type: z.literal("root"), children: z.array(z.union([
    z.object({ type: z.enum(["paragraph", "quote"]), children: z.array(inline) }).strict(),
    z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), children: z.array(inline) }).strict(),
    z.object({ type: z.literal("list"), ordered: z.boolean(), children: z.array(
      z.object({ type: z.literal("list-item"), children: z.array(inline) }).strict(),
    ) }).strict(),
  ])) }).strict(),
}).strict();

export const commentBodySchema = richTextDocumentSchema.refine((body) => {
  const inlineText = (nodes: InlineNode[]): string => nodes.map((node) =>
    node.type === "text" ? node.text : node.children.map((child) => child.text).join("")).join("");
  return body.root.children.some((node) => node.type === "list"
    ? node.children.some((item) => inlineText(item.children).trim().length > 0)
    : inlineText(node.children).trim().length > 0);
}, "Comment body must contain text");

export const issueSchema = z.object({
  ...entity, projectId: idSchema, key: z.string().regex(/^[A-Z][A-Z0-9]*-[1-9]\d*$/),
  number: z.number().int().positive().safe(), title: titleSchema, description: richTextDocumentSchema,
  kind: z.enum(ISSUE_KINDS), status: z.enum(ISSUE_STATUSES), priority: z.enum(PRIORITIES),
  blocker: blockerSchema, labelIds: z.array(idSchema), reporterId: idSchema,
  assigneeId: idSchema.nullable(), parentId: idSchema.nullable(), sprintId: idSchema.nullable(),
  deletedAt: timestampSchema.nullable(),
}).strict();

export const activityChangeSchema: z.ZodType<ActivityChange> = z.discriminatedUnion("field", [
  z.object({ field: z.literal("description"), before: richTextDocumentSchema.nullable(), after: richTextDocumentSchema }).strict(),
  z.object({ field: z.literal("kind"), before: z.enum(ISSUE_KINDS).nullable(), after: z.enum(ISSUE_KINDS) }).strict(),
  z.object({ field: z.literal("reporterId"), before: idSchema.nullable(), after: idSchema }).strict(),
  z.object({ field: z.literal("title"), before: z.string().nullable(), after: titleSchema }).strict(),
  z.object({ field: z.literal("status"), before: z.enum(ISSUE_STATUSES).nullable(), after: z.enum(ISSUE_STATUSES) }).strict(),
  z.object({ field: z.literal("priority"), before: z.enum(PRIORITIES).nullable(), after: z.enum(PRIORITIES) }).strict(),
  z.object({ field: z.literal("assigneeId"), before: idSchema.nullable(), after: idSchema.nullable() }).strict(),
  z.object({ field: z.literal("sprintId"), before: idSchema.nullable(), after: idSchema.nullable() }).strict(),
  z.object({ field: z.literal("blocker"), before: blockerSchema, after: blockerSchema }).strict(),
  z.object({ field: z.literal("sprintStatus"), before: z.enum(SPRINT_STATUSES), after: z.enum(SPRINT_STATUSES) }).strict(),
  z.object({ field: z.literal("parentId"), before: idSchema.nullable(), after: idSchema.nullable() }).strict(),
  z.object({ field: z.literal("deletedAt"), before: timestampSchema.nullable(), after: timestampSchema.nullable() }).strict(),
  z.object({ field: z.literal("commentBody"), before: richTextDocumentSchema.nullable(), after: richTextDocumentSchema }).strict(),
  z.object({ field: z.literal("sprintName"), before: z.string().nullable(), after: titleSchema }).strict(),
  z.object({ field: z.literal("sprintGoal"), before: z.string().nullable(), after: z.string().trim().min(1) }).strict(),
  z.object({ field: z.literal("startsAt"), before: timestampSchema.nullable(), after: timestampSchema.nullable() }).strict(),
  z.object({ field: z.literal("endsAt"), before: timestampSchema.nullable(), after: timestampSchema.nullable() }).strict(),
]);

export const snapshotSchema: z.ZodType<Snapshot> = z.object({
  schemaVersion: z.literal(1), scenarioVersion: z.literal(1), generation: idSchema,
  revision: z.number().int().nonnegative().safe(), scenarioAnchor: timestampSchema,
  lastWriterId: idSchema, lastTransactionId: idSchema.nullable(),
  state: z.object({
    workspace: z.object({ ...entity, name: z.string().min(1), visitorId: idSchema, featuredProjectId: idSchema,
      labels: z.array(z.object({ id: idSchema, name: z.string().min(1), colorToken: idSchema }).strict()),
    }).strict(),
    projectsById: z.record(idSchema, z.object({ ...entity, workspaceId: idSchema,
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), keyPrefix: z.string().regex(/^[A-Z][A-Z0-9]*$/),
      name: z.string().min(1), goal: z.string().min(1), ownerId: idSchema, memberIds: z.array(idSchema),
    }).strict()),
    usersById: z.record(idSchema, z.object({ ...entity, workspaceId: idSchema, name: z.string().min(1),
      roleLabel: z.string().min(1), avatarPath: z.string().refine((path) => path.startsWith("/avatars/") || path.startsWith("data:image/svg+xml,"), "Avatar must be bundled locally"),
    }).strict()),
    issuesById: z.record(idSchema, issueSchema),
    sprintsById: z.record(idSchema, z.object({ ...entity, projectId: idSchema, name: z.string().min(1), goal: z.string().min(1),
      status: z.enum(SPRINT_STATUSES), startsAt: timestampSchema.nullable(), endsAt: timestampSchema.nullable(),
      startedAt: timestampSchema.nullable(), completedAt: timestampSchema.nullable(),
      deletedAt: timestampSchema.nullable().optional(),
    }).strict()),
    commentsById: z.record(idSchema, z.object({ ...entity, issueId: idSchema, authorId: idSchema,
      body: commentBodySchema, editedAt: timestampSchema.nullable(), deletedAt: timestampSchema.nullable(),
    }).strict()),
    activitiesById: z.record(idSchema, z.object({ id: idSchema, transactionId: idSchema,
      sequence: z.number().int().positive().safe(), actorId: idSchema, projectId: idSchema,
      issueId: idSchema.nullable(), sprintId: idSchema.nullable(), commentId: idSchema.nullable(),
      kind: z.enum(["ISSUE_CREATED", "ISSUE_UPDATED", "ISSUE_MOVED", "ISSUE_DELETED", "ISSUE_RESTORED",
        "COMMENT_CREATED", "COMMENT_UPDATED", "COMMENT_DELETED", "SPRINT_CREATED", "SPRINT_UPDATED", "SPRINT_DELETED", "SPRINT_STARTED", "SPRINT_COMPLETED"]),
      changes: z.array(activityChangeSchema), occurredAt: timestampSchema,
    }).strict()),
    activityOrder: z.array(idSchema),
    boardOrderByProject: z.record(idSchema, z.object({ TODO: z.array(idSchema), IN_PROGRESS: z.array(idSchema),
      IN_REVIEW: z.array(idSchema), DONE: z.array(idSchema),
    }).strict()),
    planningOrderByProject: z.record(idSchema, z.object({ backlog: z.array(idSchema), sprints: z.record(idSchema, z.array(idSchema)) }).strict()),
    childOrderByParent: z.record(idSchema, z.array(idSchema)),
    nextIssueNumberByProject: z.record(idSchema, z.number().int().positive().safe()),
    deletionRecordsById: z.record(idSchema, z.object({ id: idSchema, issueIds: z.array(idSchema), deletedAt: timestampSchema,
      placements: z.record(idSchema, z.object({ parentId: idSchema.nullable(),
        board: z.object({ beforeId: idSchema.nullable(), afterId: idSchema.nullable() }).strict(),
        planning: z.object({ beforeId: idSchema.nullable(), afterId: idSchema.nullable() }).strict(),
        children: z.object({ beforeId: idSchema.nullable(), afterId: idSchema.nullable() }).strict(),
      }).strict()).optional(), detachedChildIds: z.array(idSchema).optional(),
    }).strict()),
  }).strict(),
}).strict();

export const placementSchema = z.union([
  z.object({ beforeIssueId: idSchema }).strict(), z.object({ afterIssueId: idSchema }).strict(),
  z.object({ at: z.literal("end") }).strict(),
]);
const mutationContext = { expectedGeneration: idSchema, expectedVersion: z.number().int().positive().safe().optional() };
export const createIssueSchema = z.object({
  expectedGeneration: idSchema, projectId: idSchema, title: titleSchema,
  description: richTextDocumentSchema.optional(), kind: z.enum(ISSUE_KINDS).optional(),
  status: z.enum(ISSUE_STATUSES).optional(), priority: z.enum(PRIORITIES).optional(),
  assigneeId: idSchema.nullable().optional(), parentId: idSchema.nullable().optional(),
  sprintId: idSchema.nullable().optional(), labelIds: z.array(idSchema).optional(), blocker: blockerSchema.optional(),
}).strict();
export const updateIssueSchema = z.object({ ...mutationContext, issueId: idSchema,
  patch: z.object({ title: titleSchema.optional(), status: z.enum(ISSUE_STATUSES).optional(),
    description: richTextDocumentSchema.optional(), kind: z.enum(ISSUE_KINDS).optional(),
    reporterId: idSchema.optional(), parentId: idSchema.nullable().optional(),
    priority: z.enum(PRIORITIES).optional(), assigneeId: idSchema.nullable().optional(), blocker: blockerSchema.optional(),
  }).strict(),
}).strict();
export const moveIssueSchema = z.object({ ...mutationContext, issueId: idSchema,
  destination: z.discriminatedUnion("view", [
    z.object({ view: z.literal("board"), status: z.enum(ISSUE_STATUSES) }).strict(),
    z.object({ view: z.literal("planning"), sprintId: idSchema.nullable() }).strict(),
    z.object({ view: z.literal("children"), parentId: idSchema }).strict(),
  ]), placement: placementSchema,
}).strict();
