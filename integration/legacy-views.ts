/** Temporary old-UI projections. Canonical domain state never stores these fields. */
import { type DeepReadonly, type IssueStatus, type IssueKind, type ImmutableSnapshot, type Project,
  type User, type Sprint, type Comment, type RichTextDocument, type InlineNode } from "../domain/types";

export interface MemberView { id: string; name: string; email: string; avatar: string | null }
export interface ProjectView { id: string; key: string; name: string; defaultAssignee: string | null; imageUrl: string | null;
  createdAt: Date; updatedAt: Date | null; deletedAt: Date | null }
export interface SprintView { id: string; version: number; name: string; description: string; duration: string | null; startDate: Date | null;
  endDate: Date | null; creatorId: string; createdAt: Date; updatedAt: Date | null; deletedAt: Date | null; status: Sprint["status"] }
export interface IssueView { id: string; version: number; key: string; name: string; description: string | null; status: IssueStatus;
  type: IssueKind | "SUBTASK" | "EPIC"; sprintPosition: number; boardPosition: number; reporterId: string;
  assigneeId: string | null; parentId: string | null; sprintId: string | null; isDeleted: boolean;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null; sprintColor: string | null; creatorId: string;
  sprintIsActive: boolean; assignee: MemberView | null; reporter: MemberView | null; parent: IssueView | null; children: IssueView[] }
export interface CommentView { id: string; version: number; issueId: string; authorId: string; author: MemberView | null; content: string;
  isEdited: boolean; createdAt: Date; updatedAt: Date; deletedAt: Date | null; logId: string | null }

export function memberView(user: DeepReadonly<User>): MemberView {
  return { id: user.id, name: user.name, email: "", avatar: user.avatarPath };
}
export function projectView(project: DeepReadonly<Project>): ProjectView {
  return { id: project.id, key: project.keyPrefix, name: project.name, defaultAssignee: project.ownerId, imageUrl: null,
    createdAt: new Date(project.createdAt), updatedAt: new Date(project.updatedAt), deletedAt: null };
}
export function sprintView(sprint: DeepReadonly<Sprint>): SprintView {
  return { id: sprint.id, version: sprint.version, name: sprint.name, description: sprint.goal, duration: null, creatorId: "",
    startDate: sprint.startsAt ? new Date(sprint.startsAt) : null, endDate: sprint.endsAt ? new Date(sprint.endsAt) : null,
    createdAt: new Date(sprint.createdAt), updatedAt: new Date(sprint.updatedAt), deletedAt: sprint.deletedAt ? new Date(sprint.deletedAt) : null, status: sprint.status };
}

/** One-way JSON serialization for the existing Lexical preview; no Lexical domain dependency. */
export function legacyEditorContent(document: DeepReadonly<RichTextDocument>): string {
  const element = (type: string, children: unknown[], extra: Record<string, unknown> = {}) =>
    ({ type, version: 1, children, direction: null, format: "", indent: 0, ...extra });
  const inline = (nodes: readonly DeepReadonly<InlineNode>[]): unknown[] => nodes.map((node) => node.type === "text"
    ? { type: "text", version: 1, text: node.text, format: node.marks.reduce((bits, mark) => bits | ({ bold: 1, italic: 2, code: 16 }[mark]), 0), detail: 0, mode: "normal", style: "" }
    : element("link", inline(node.children), { url: node.url, rel: null, target: null, title: null }));
  const children = document.root.children.map((node) => node.type === "list"
    ? element("list", node.children.map((item, index) => element("listitem", inline(item.children), { value: index + 1 })), { listType: node.ordered ? "number" : "bullet", start: 1, tag: node.ordered ? "ol" : "ul" })
    : element(node.type, inline(node.children), node.type === "heading" ? { tag: `h${node.level}` } : {}));
  // Lexical refuses an empty root; an empty paragraph is its editable placeholder.
  return JSON.stringify({ root: element("root", children.length ? children : [element("paragraph", [])]) });
}

export function projectIssuesView(snapshot: ImmutableSnapshot, projectId: string): IssueView[] {
  const state = snapshot.state;
  const user = (id: string | null): MemberView | null => {
    const member = id ? state.usersById[id] : undefined; return member ? memberView(member) : null;
  };
  const board = state.boardOrderByProject[projectId]; const planning = state.planningOrderByProject[projectId];
  const boardRank = new Map(Object.values(board ?? {}).flat().map((id, index) => [id, index]));
  const planningRank = new Map([...(planning?.backlog ?? []), ...Object.values(planning?.sprints ?? {}).flat()].map((id, index) => [id, index]));
  const views = Object.values(state.issuesById).filter((issue) => issue.projectId === projectId && !issue.deletedAt).map((issue): IssueView => ({
    id: issue.id, version: issue.version, key: issue.key, name: issue.title, description: legacyEditorContent(issue.description), status: issue.status,
    type: issue.parentId ? "SUBTASK" : issue.kind, sprintPosition: planningRank.get(issue.id) ?? 0, boardPosition: boardRank.get(issue.id) ?? 0,
    reporterId: issue.reporterId, assigneeId: issue.assigneeId, parentId: issue.parentId, sprintId: issue.sprintId, isDeleted: false,
    createdAt: new Date(issue.createdAt), updatedAt: new Date(issue.updatedAt), deletedAt: null, sprintColor: null, creatorId: state.workspace.visitorId,
    sprintIsActive: issue.sprintId !== null && state.sprintsById[issue.sprintId]?.status === "ACTIVE",
    assignee: user(issue.assigneeId), reporter: user(issue.reporterId), parent: null, children: [],
  }));
  const byId = new Map(views.map((issue) => [issue.id, issue]));
  for (const view of views) {
    // Shallow parent summaries avoid cycles in React Query's structural sharing.
    if (view.parentId) {
      const parent = byId.get(view.parentId);
      if (parent) view.parent = { ...parent, parent: null, children: (state.childOrderByParent[parent.id] ?? []).flatMap((id) => {
        const child = byId.get(id); return child ? [{ ...child, parent: null, children: [] }] : [];
      }) };
    }
    view.children = (state.childOrderByParent[view.id] ?? []).flatMap((id) => {
      const child = byId.get(id); return child ? [{ ...child, parent: null, children: [] }] : [];
    });
  }
  return views;
}

export function commentView(comment: DeepReadonly<Comment>, members: readonly DeepReadonly<User>[]): CommentView {
  const author = members.find((member) => member.id === comment.authorId);
  return { id: comment.id, version: comment.version, issueId: comment.issueId, authorId: comment.authorId, author: author ? memberView(author) : null,
    content: legacyEditorContent(comment.body), isEdited: comment.editedAt !== null, createdAt: new Date(comment.createdAt),
    updatedAt: new Date(comment.updatedAt), deletedAt: null, logId: null };
}
