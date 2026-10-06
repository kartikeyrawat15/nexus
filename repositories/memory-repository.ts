/* eslint-disable @typescript-eslint/require-await -- The public adapter stays async; memory commits deliberately contain no await so transition/publication is atomic. */
import { ZodError } from "zod";
import { createSnapshot } from "../demo/create-snapshot";
import { deepFreeze, validateSnapshot } from "../domain/invariants";
import { idSchema } from "../domain/schema";
import { DomainError, type DeepReadonly, type Id, type ImmutableSnapshot, type Issue, type Project,
  type Workspace, type User, type Sprint, type Comment, type ActivityEvent } from "../domain/types";
import { applyCommand, type FoundationCommand } from "./apply-command";
import { applyLifecycleCommand, type LifecycleCommand } from "./apply-lifecycle-command";
import { type MutationResult, type OperationInput } from "./contracts";
import { type CreateIssueInput, type FoundationRepository, type IssueMutationResult, type MoveIssueInput, type RepositoryOptions, type UpdateIssueInput } from "./contracts";

export class MemoryRepository implements FoundationRepository {
  private snapshot: ImmutableSnapshot | null = null;
  protected readonly clock: NonNullable<RepositoryOptions["clock"]>;
  protected readonly idFactory: NonNullable<RepositoryOptions["idFactory"]>;
  protected writerId: Id;
  private readonly initialSnapshot: ImmutableSnapshot | null;
  private readonly usedGenerations = new Set<Id>();

  constructor(options: RepositoryOptions = {}) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
    this.writerId = idSchema.parse(options.writerId ?? "memory");
    this.initialSnapshot = options.initialSnapshot === undefined ? null : deepFreeze(validateSnapshot(options.initialSnapshot));
  }

  async initialize(): Promise<ImmutableSnapshot> {
    return this.initializeState();
  }

  protected initializeState(): ImmutableSnapshot {
    if (!this.snapshot) {
      this.snapshot = this.initialSnapshot ?? this.freshSnapshot();
      this.usedGenerations.add(this.snapshot.generation);
    }
    return this.snapshot;
  }

  private freshSnapshot(): ImmutableSnapshot {
    const generation = idSchema.parse(this.idFactory());
    if (this.usedGenerations.has(generation)) throw new DomainError("CONFLICT", "Reset requires a new generation");
    return deepFreeze(createSnapshot({ anchor: this.clock(), generation }));
  }

  protected read(): ImmutableSnapshot {
    if (!this.snapshot) throw new DomainError("NOT_INITIALIZED", "Initialize the repository before reading or mutating it");
    return this.snapshot;
  }

  async getSnapshot(): Promise<ImmutableSnapshot> { return this.read(); }

  async getProjects(): Promise<readonly DeepReadonly<Project>[]> {
    return Object.freeze(Object.values(this.read().state.projectsById));
  }

  async getProject(projectId: Id): Promise<DeepReadonly<Project>> {
    const project = this.read().state.projectsById[idSchema.parse(projectId)];
    if (!project) throw new DomainError("NOT_FOUND", "Project does not exist");
    return project;
  }

  async getIssues(projectId: Id): Promise<readonly DeepReadonly<Issue>[]> {
    const snapshot = this.read();
    if (!snapshot.state.projectsById[idSchema.parse(projectId)]) throw new DomainError("NOT_FOUND", "Project does not exist");
    return Object.freeze(Object.values(snapshot.state.issuesById).filter((issue) => issue.projectId === projectId && issue.deletedAt === null));
  }

  async getWorkspace(): Promise<DeepReadonly<Workspace>> { return this.read().state.workspace; }

  async getProjectMembers(projectId: Id): Promise<readonly DeepReadonly<User>[]> {
    const state = this.read().state;
    const project = state.projectsById[idSchema.parse(projectId)];
    if (!project) throw new DomainError("NOT_FOUND", "Project does not exist");
    return Object.freeze(project.memberIds.map((id) => {
      const user = state.usersById[id];
      if (!user) throw new DomainError("NOT_FOUND", "Member does not exist");
      return user;
    }));
  }

  async getProjectSprints(projectId: Id): Promise<readonly DeepReadonly<Sprint>[]> {
    const state = this.read().state;
    if (!state.projectsById[idSchema.parse(projectId)]) throw new DomainError("NOT_FOUND", "Project does not exist");
    return Object.freeze(Object.values(state.sprintsById).filter((sprint) => sprint.projectId === projectId && !sprint.deletedAt));
  }

  async getIssue(issueId: Id): Promise<DeepReadonly<Issue>> {
    const issue = this.read().state.issuesById[idSchema.parse(issueId)];
    if (!issue || issue.deletedAt) throw new DomainError("NOT_FOUND", "Issue does not exist");
    return issue;
  }

  async getComments(issueId: Id): Promise<readonly DeepReadonly<Comment>[]> {
    const state = this.read().state;
    const issue = state.issuesById[idSchema.parse(issueId)];
    if (!issue || issue.deletedAt) throw new DomainError("NOT_FOUND", "Issue does not exist");
    return Object.freeze(Object.values(state.commentsById).filter((comment) => comment.issueId === issueId && !comment.deletedAt));
  }

  async getActivity(projectId: Id): Promise<readonly DeepReadonly<ActivityEvent>[]> {
    const state = this.read().state;
    if (!state.projectsById[idSchema.parse(projectId)]) throw new DomainError("NOT_FOUND", "Project does not exist");
    return Object.freeze(state.activityOrder.flatMap((id) => {
      const event = state.activitiesById[id]; return event?.projectId === projectId ? [event] : [];
    }));
  }

  protected commit(command: FoundationCommand): IssueMutationResult {
    // There is no await inside the transition/publication boundary, so parallel callers serialize.
    try {
      const transition = applyCommand(this.read(), command, { now: this.clock(), idFactory: this.idFactory, writerId: this.writerId });
      this.snapshot = transition.snapshot;
      return transition.result;
    } catch (error) {
      if (error instanceof ZodError) throw new DomainError("VALIDATION", error.issues[0]?.message ?? error.message);
      throw error;
    }
  }

  async createIssue(input: CreateIssueInput): Promise<IssueMutationResult> { return this.commit({ kind: "create", input }); }
  async updateIssue(input: UpdateIssueInput): Promise<IssueMutationResult> { return this.commit({ kind: "update", input }); }
  async moveIssue(input: MoveIssueInput): Promise<IssueMutationResult> { return this.commit({ kind: "move", input }); }

  protected commitLifecycle(command: LifecycleCommand): MutationResult {
    try {
      const transition = applyLifecycleCommand(this.read(), command, { now: this.clock(), idFactory: this.idFactory, writerId: this.writerId });
      this.snapshot = transition.snapshot;
      return transition.result;
    } catch (error) {
      if (error instanceof ZodError) throw new DomainError("VALIDATION", error.issues[0]?.message ?? error.message);
      throw error;
    }
  }

  async deleteIssue(input: OperationInput<"deleteIssue">): Promise<MutationResult> { return this.commitLifecycle({ kind: "deleteIssue", input }); }
  async restoreIssue(input: OperationInput<"restoreIssue">): Promise<MutationResult> { return this.commitLifecycle({ kind: "restoreIssue", input }); }
  async createComment(input: OperationInput<"createComment">): Promise<MutationResult> { return this.commitLifecycle({ kind: "createComment", input }); }
  async updateComment(input: OperationInput<"updateComment">): Promise<MutationResult> { return this.commitLifecycle({ kind: "updateComment", input }); }
  async deleteComment(input: OperationInput<"deleteComment">): Promise<MutationResult> { return this.commitLifecycle({ kind: "deleteComment", input }); }
  async createSprint(input: OperationInput<"createSprint">): Promise<MutationResult> { return this.commitLifecycle({ kind: "createSprint", input }); }
  async updateSprint(input: OperationInput<"updateSprint">): Promise<MutationResult> { return this.commitLifecycle({ kind: "updateSprint", input }); }
  async deletePendingSprint(input: OperationInput<"deletePendingSprint">): Promise<MutationResult> { return this.commitLifecycle({ kind: "deletePendingSprint", input }); }
  async startSprint(input: OperationInput<"startSprint">): Promise<MutationResult> { return this.commitLifecycle({ kind: "startSprint", input }); }
  async completeSprint(input: OperationInput<"completeSprint">): Promise<MutationResult> { return this.commitLifecycle({ kind: "completeSprint", input }); }

  async resetDemo(): Promise<ImmutableSnapshot> {
    return this.resetState();
  }

  protected resetState(): ImmutableSnapshot {
    this.read();
    const fresh = this.freshSnapshot();
    this.snapshot = fresh;
    this.usedGenerations.add(fresh.generation);
    return fresh;
  }

  /** Adoption changes no domain revision/activity and still reserves reset generations. */
  protected adoptSnapshot(snapshot: ImmutableSnapshot): void {
    this.snapshot = deepFreeze(validateSnapshot(snapshot));
    this.usedGenerations.add(this.snapshot.generation);
  }
}
