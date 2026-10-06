import { type Blocker, type DeepReadonly, type Id, type ImmutableSnapshot, type Issue, type IssueKind,
  type IssueStatus, type ISODateTime, type Placement, type Priority, type Project, type RichTextDocument,
  type Workspace, type User, type Sprint, type Comment, type ActivityEvent } from "../domain/types";

export interface CreateIssueInput {
  expectedGeneration: Id;
  projectId: Id;
  title: string;
  description?: RichTextDocument;
  kind?: IssueKind;
  status?: IssueStatus;
  priority?: Priority;
  assigneeId?: Id | null;
  parentId?: Id | null;
  sprintId?: Id | null;
  labelIds?: Id[];
  blocker?: Blocker;
}
export interface UpdateIssueInput {
  expectedGeneration: Id;
  expectedVersion?: number;
  issueId: Id;
  patch: Partial<Pick<Issue, "title" | "description" | "kind" | "reporterId" | "parentId" | "status" | "priority" | "assigneeId" | "blocker">>;
}
export type MoveDestination =
  | { view: "board"; status: IssueStatus }
  | { view: "planning"; sprintId: Id | null }
  | { view: "children"; parentId: Id };
export interface MoveIssueInput {
  expectedGeneration: Id;
  expectedVersion?: number;
  issueId: Id;
  destination: MoveDestination;
  placement: Placement;
}
export interface MutationResult {
  transactionId: Id | null;
  generation: Id;
  revision: number;
  changedEntityIds: readonly Id[];
  affectedProjectIds: readonly Id[];
  generatedEventIds: readonly Id[];
  persistenceStatus: "memory" | "persisted";
}
export interface IssueMutationResult extends MutationResult { issue: DeepReadonly<Issue> }

/** Public asynchronous domain boundary; memory transitions remain synchronous. */
export interface FoundationRepository extends PlannedRepositoryOperations {
  initialize(): Promise<ImmutableSnapshot>;
  getSnapshot(): Promise<ImmutableSnapshot>;
  getProjects(): Promise<readonly DeepReadonly<Project>[]>;
  getProject(projectId: Id): Promise<DeepReadonly<Project>>;
  getWorkspace(): Promise<DeepReadonly<Workspace>>;
  getProjectMembers(projectId: Id): Promise<readonly DeepReadonly<User>[]>;
  getProjectSprints(projectId: Id): Promise<readonly DeepReadonly<Sprint>[]>;
  getIssue(issueId: Id): Promise<DeepReadonly<Issue>>;
  getComments(issueId: Id): Promise<readonly DeepReadonly<Comment>[]>;
  getActivity(projectId: Id): Promise<readonly DeepReadonly<ActivityEvent>[]>;
  getIssues(projectId: Id): Promise<readonly DeepReadonly<Issue>[]>;
  createIssue(input: CreateIssueInput): Promise<IssueMutationResult>;
  updateIssue(input: UpdateIssueInput): Promise<IssueMutationResult>;
  moveIssue(input: MoveIssueInput): Promise<IssueMutationResult>;
  resetDemo(): Promise<ImmutableSnapshot>;
}

/** Core Phase 1 lifecycle operations. */
export interface PlannedRepositoryOperations {
  deleteIssue(input: { issueId: Id; expectedGeneration: Id; expectedVersion?: number; children?: "keep" | "delete" }): Promise<MutationResult>;
  /** Undo the deletion group containing this issue, using surviving canonical neighbors. */
  restoreIssue(input: { issueId: Id; expectedGeneration: Id }): Promise<MutationResult>;
  createComment(input: { issueId: Id; body: RichTextDocument; expectedGeneration: Id }): Promise<MutationResult>;
  updateComment(input: { commentId: Id; body: RichTextDocument; expectedGeneration: Id; expectedVersion: number }): Promise<MutationResult>;
  deleteComment(input: { commentId: Id; expectedGeneration: Id; expectedVersion: number }): Promise<MutationResult>;
  createSprint(input: { projectId: Id; name: string; goal: string; expectedGeneration: Id }): Promise<MutationResult>;
  updateSprint(input: { sprintId: Id; name?: string; goal?: string; startsAt?: ISODateTime | null; endsAt?: ISODateTime | null; expectedGeneration: Id; expectedVersion: number }): Promise<MutationResult>;
  deletePendingSprint(input: { sprintId: Id; expectedGeneration: Id; expectedVersion: number }): Promise<MutationResult>;
  startSprint(input: { sprintId: Id; expectedGeneration: Id; expectedVersion: number; name?: string; goal?: string; startsAt?: ISODateTime | null; endsAt?: ISODateTime | null }): Promise<MutationResult>;
  completeSprint(input: { sprintId: Id; destinationSprintId: Id | null; expectedGeneration: Id; expectedVersion: number }): Promise<MutationResult>;
}

export type LifecycleOperation = keyof PlannedRepositoryOperations;
export type OperationInput<K extends LifecycleOperation> = Parameters<PlannedRepositoryOperations[K]>[0];

export interface RepositoryOptions {
  clock?: () => ISODateTime;
  idFactory?: () => Id;
  writerId?: Id;
  initialSnapshot?: unknown;
}
