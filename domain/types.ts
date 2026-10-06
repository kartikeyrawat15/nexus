export const ISSUE_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
export const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export const ISSUE_KINDS = ["TASK", "BUG", "STORY"] as const;
export const SPRINT_STATUSES = ["PENDING", "ACTIVE", "CLOSED"] as const;

export type Id = string;
export type ISODateTime = string;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type IssueKind = (typeof ISSUE_KINDS)[number];
export type SprintStatus = (typeof SPRINT_STATUSES)[number];
export type Blocker =
  | { blocked: false; reason: null }
  | { blocked: true; reason: string };

export interface Entity {
  id: Id;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface Workspace extends Entity {
  name: string;
  visitorId: Id;
  featuredProjectId: Id;
  labels: { id: Id; name: string; colorToken: string }[];
}

export interface User extends Entity {
  workspaceId: Id;
  name: string;
  roleLabel: string;
  avatarPath: string;
}

export interface Project extends Entity {
  workspaceId: Id;
  slug: string;
  keyPrefix: string;
  name: string;
  goal: string;
  ownerId: Id;
  memberIds: Id[];
}

export type TextMark = "bold" | "italic" | "code";
export interface TextNode {
  type: "text";
  text: string;
  marks: TextMark[];
}
export type InlineNode = TextNode | { type: "link"; url: string; children: TextNode[] };
export type RichTextNode =
  | { type: "paragraph" | "quote"; children: InlineNode[] }
  | { type: "heading"; level: 2 | 3; children: InlineNode[] }
  | { type: "list"; ordered: boolean; children: { type: "list-item"; children: InlineNode[] }[] };
export interface RichTextDocument {
  format: "nexus-rich-text";
  version: 1;
  root: { type: "root"; children: RichTextNode[] };
}

export interface Issue extends Entity {
  projectId: Id;
  key: string;
  number: number;
  title: string;
  description: RichTextDocument;
  kind: IssueKind;
  status: IssueStatus;
  priority: Priority;
  blocker: Blocker;
  labelIds: Id[];
  reporterId: Id;
  assigneeId: Id | null;
  parentId: Id | null;
  sprintId: Id | null;
  deletedAt: ISODateTime | null;
}

export interface Sprint extends Entity {
  /** Absent on the original seed; pending deletions retain their history. */
  deletedAt?: ISODateTime | null;
  projectId: Id;
  name: string;
  goal: string;
  status: SprintStatus;
  startsAt: ISODateTime | null;
  endsAt: ISODateTime | null;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
}

export interface Comment extends Entity {
  issueId: Id;
  authorId: Id;
  body: RichTextDocument;
  editedAt: ISODateTime | null;
  deletedAt: ISODateTime | null;
}

export type ActivityChange =
  | { field: "title"; before: string | null; after: string }
  | { field: "description"; before: RichTextDocument | null; after: RichTextDocument }
  | { field: "kind"; before: IssueKind | null; after: IssueKind }
  | { field: "reporterId"; before: Id | null; after: Id }
  | { field: "status"; before: IssueStatus | null; after: IssueStatus }
  | { field: "priority"; before: Priority | null; after: Priority }
  | { field: "assigneeId" | "sprintId" | "parentId"; before: Id | null; after: Id | null }
  | { field: "deletedAt"; before: ISODateTime | null; after: ISODateTime | null }
  | { field: "commentBody"; before: RichTextDocument | null; after: RichTextDocument }
  | { field: "sprintName" | "sprintGoal"; before: string | null; after: string }
  | { field: "startsAt" | "endsAt"; before: ISODateTime | null; after: ISODateTime | null }
  | { field: "blocker"; before: Blocker; after: Blocker }
  | { field: "sprintStatus"; before: SprintStatus; after: SprintStatus };

export type ActivityKind =
  | "ISSUE_CREATED" | "ISSUE_UPDATED" | "ISSUE_MOVED"
  | "ISSUE_DELETED" | "ISSUE_RESTORED"
  | "COMMENT_CREATED" | "COMMENT_UPDATED" | "COMMENT_DELETED"
  | "SPRINT_CREATED" | "SPRINT_UPDATED" | "SPRINT_DELETED" | "SPRINT_STARTED" | "SPRINT_COMPLETED";

export interface ActivityEvent {
  id: Id;
  transactionId: Id;
  sequence: number;
  actorId: Id;
  projectId: Id;
  issueId: Id | null;
  sprintId: Id | null;
  commentId: Id | null;
  kind: ActivityKind;
  changes: ActivityChange[];
  occurredAt: ISODateTime;
}

export type Placement = { beforeIssueId: Id } | { afterIssueId: Id } | { at: "end" };
export interface DeletionRecord {
  id: Id;
  issueIds: Id[];
  deletedAt: ISODateTime;
  /** Legacy tombstones may have no Undo metadata. Never restore a workspace snapshot. */
  placements?: Record<Id, { parentId: Id | null; board: OrderNeighbors; planning: OrderNeighbors; children: OrderNeighbors }>;
  detachedChildIds?: Id[];
}
export interface OrderNeighbors { beforeId: Id | null; afterId: Id | null }

export interface Snapshot {
  schemaVersion: 1;
  scenarioVersion: 1;
  generation: Id;
  revision: number;
  scenarioAnchor: ISODateTime;
  lastWriterId: Id;
  lastTransactionId: Id | null;
  state: {
    workspace: Workspace;
    projectsById: Record<Id, Project>;
    usersById: Record<Id, User>;
    issuesById: Record<Id, Issue>;
    sprintsById: Record<Id, Sprint>;
    commentsById: Record<Id, Comment>;
    activitiesById: Record<Id, ActivityEvent>;
    activityOrder: Id[];
    boardOrderByProject: Record<Id, Record<IssueStatus, Id[]>>;
    planningOrderByProject: Record<Id, { backlog: Id[]; sprints: Record<Id, Id[]> }>;
    childOrderByParent: Record<Id, Id[]>;
    nextIssueNumberByProject: Record<Id, number>;
    deletionRecordsById: Record<Id, DeletionRecord>;
  };
}

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ImmutableSnapshot = DeepReadonly<Snapshot>;

export class DomainError extends Error {
  constructor(
    public readonly code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "STALE_GENERATION" | "NOT_INITIALIZED",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
