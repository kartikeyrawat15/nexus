import { DomainError, type Blocker, type IssueKind, type IssueStatus, type Priority } from "../domain/types";
import { type FoundationRepository, type MoveIssueInput, type UpdateIssueInput } from "../repositories/contracts";
import { editorDocument } from "./editor-document";
import { projectIssuesView } from "./legacy-views";

export interface IssueCreate {
  name: string; type?: IssueKind | "SUBTASK" | "EPIC"; status?: IssueStatus; priority?: Priority;
  description?: string; assigneeId?: string | null; reporterId?: string | null;
  sprintId?: string | null; parentId?: string | null; blocker?: Blocker; sprintColor?: string | null;
}
export interface IssueEdit {
  issueId: string; expectedVersion?: number; name?: string; description?: string;
  type?: IssueCreate["type"]; status?: IssueStatus; priority?: Priority; assigneeId?: string | null;
  reporterId?: string; blocker?: Blocker; sprintId?: string | null; parentId?: string | null; sprintColor?: string;
}
export interface SprintEdit {
  sprintId: string; expectedVersion?: number; name?: string; description?: string; duration?: string;
  startDate?: string | null; endDate?: string | null;
}
export interface CommentEdit { commentId: string; issueId: string; content: string; expectedVersion?: number }
function kind(type: IssueCreate["type"]): IssueKind | undefined {
  if (type === "EPIC") throw new DomainError("VALIDATION", "Legacy epics are not supported by the NEXUS issue model");
  return type === "SUBTASK" ? "TASK" : type;
}
/** UI inputs become public repository commands. No cache patches, API client, or persistence I/O here. */
export function repositoryMutations(repository: FoundationRepository, projectId: string) {
  const issueView = async (id: string) => {
    const view = projectIssuesView(await repository.getSnapshot(), projectId).find((issue) => issue.id === id);
    if (!view) throw new DomainError("NOT_FOUND", "Issue does not exist in this project"); return view;
  };
  const issueContext = async (id: string, expectedVersion?: number) => {
    const snapshot = await repository.getSnapshot(); const issue = snapshot.state.issuesById[id];
    if (!issue || issue.deletedAt || issue.projectId !== projectId) throw new DomainError("NOT_FOUND", "Issue does not exist in this project");
    return { issue, expectedGeneration: snapshot.generation, expectedVersion: expectedVersion ?? issue.version };
  };
  const sprintContext = async (input: { sprintId: string; expectedVersion?: number }) => {
    const snapshot = await repository.getSnapshot(); const sprint = snapshot.state.sprintsById[input.sprintId];
    if (!sprint || sprint.deletedAt || sprint.projectId !== projectId) throw new DomainError("NOT_FOUND", "Sprint does not exist in this project");
    return { sprintId: sprint.id, expectedGeneration: snapshot.generation, expectedVersion: input.expectedVersion ?? sprint.version };
  };
  const commentContext = async (input: { commentId: string; issueId: string; expectedVersion?: number }) => {
    const snapshot = await repository.getSnapshot(); const comment = snapshot.state.commentsById[input.commentId];
    if (!comment || comment.deletedAt || comment.issueId !== input.issueId || snapshot.state.issuesById[comment.issueId]?.projectId !== projectId) throw new DomainError("NOT_FOUND", "Comment does not exist in this project");
    if (comment.authorId !== snapshot.state.workspace.visitorId) throw new DomainError("VALIDATION", "Only your own comments can be changed");
    return { commentId: comment.id, expectedGeneration: snapshot.generation, expectedVersion: input.expectedVersion ?? comment.version };
  };
  const sprintFields = (input: SprintEdit) => ({ name: input.name, goal: input.description, startsAt: input.startDate, endsAt: input.endDate });
  return {
    createIssue: async (input: IssueCreate) => {
      const snapshot = await repository.getSnapshot();
      if (input.reporterId && input.reporterId !== snapshot.state.workspace.visitorId) throw new DomainError("VALIDATION", "New issues use the current demo reporter");
      if (input.type === "SUBTASK" && !input.parentId) throw new DomainError("VALIDATION", "A child issue requires a parent");
      const result = await repository.createIssue({ expectedGeneration: snapshot.generation, projectId, title: input.name,
        kind: kind(input.type), description: input.description === undefined ? undefined : editorDocument(input.description),
        status: input.status, priority: input.priority, assigneeId: input.assigneeId, parentId: input.parentId,
        sprintId: input.sprintId, blocker: input.blocker });
      return issueView(result.issue.id);
    },
    updateIssue: async (input: IssueEdit) => {
      const { issue, ...context } = await issueContext(input.issueId, input.expectedVersion);
      if (input.sprintColor !== undefined) throw new DomainError("VALIDATION", "Legacy epic colors are unsupported");
      const patch: UpdateIssueInput["patch"] = {};
      if (input.name !== undefined) patch.title = input.name;
      if (input.description !== undefined) patch.description = editorDocument(input.description);
      if (input.type !== undefined && input.type !== "SUBTASK") patch.kind = kind(input.type);
      if (input.type === "SUBTASK" && !issue.parentId) throw new DomainError("VALIDATION", "Use a parent relationship to create a child issue");
      for (const field of ["status", "priority", "assigneeId", "reporterId", "blocker", "parentId"] as const) {
        if (input[field] !== undefined) Object.assign(patch, { [field]: input[field] });
      }
      if (input.sprintId !== undefined) {
        if (Object.keys(patch).length) throw new DomainError("VALIDATION", "Planning movement must be a separate command");
        await repository.moveIssue({ ...context, issueId: issue.id, destination: { view: "planning", sprintId: input.sprintId }, placement: { at: "end" } });
      } else await repository.updateIssue({ ...context, issueId: issue.id, patch });
      return issueView(issue.id);
    },
    moveIssue: async (input: Omit<MoveIssueInput, "expectedGeneration">) => {
      const { issue, ...context } = await issueContext(input.issueId, input.expectedVersion);
      return repository.moveIssue({ ...input, ...context, issueId: issue.id });
    },
    deleteIssue: async (input: { issueId: string; expectedVersion?: number }) => {
      const { issue, ...context } = await issueContext(input.issueId, input.expectedVersion);
      await repository.deleteIssue({ ...context, issueId: issue.id, children: "delete" });
      return { id: issue.id, key: issue.key, generation: context.expectedGeneration };
    },
    restoreIssue: (input: { issueId: string; expectedGeneration: string }) => repository.restoreIssue(input),
    addComment: async (input: { issueId: string; content: string; authorId?: string }) => {
      const context = await issueContext(input.issueId);
      return repository.createComment({ issueId: input.issueId, body: editorDocument(input.content), expectedGeneration: context.expectedGeneration });
    },
    updateComment: async (input: CommentEdit) => repository.updateComment({ ...await commentContext(input), body: editorDocument(input.content) }),
    deleteComment: async (input: Omit<CommentEdit, "content">) => repository.deleteComment(await commentContext(input)),
    createSprint: async () => {
      const snapshot = await repository.getSnapshot();
      const numbers = Object.values(snapshot.state.sprintsById).filter((sprint) => sprint.projectId === projectId).map((sprint) => Number(/\d+$/.exec(sprint.name)?.[0] ?? 0));
      return repository.createSprint({ expectedGeneration: snapshot.generation, projectId, name: `Sprint ${Math.max(0, ...numbers) + 1}`, goal: "Plan the next delivery" });
    },
    updateSprint: async (input: SprintEdit) => repository.updateSprint({ ...await sprintContext(input), ...sprintFields(input) }),
    deleteSprint: async (input: { sprintId: string; expectedVersion?: number }) => repository.deletePendingSprint(await sprintContext(input)),
    startSprint: async (input: SprintEdit) => repository.startSprint({ ...await sprintContext(input), ...sprintFields(input) }),
    completeSprint: async (input: { sprintId: string; destinationSprintId: string | null; expectedVersion?: number }) =>
      repository.completeSprint({ ...await sprintContext(input), destinationSprintId: input.destinationSprintId }),
  };
}
