import { describe, expect, it } from "vitest";
import { createSnapshot } from "../../demo/create-snapshot";
import { validateSnapshot } from "../../domain/invariants";
import { richTextDocumentSchema, snapshotSchema } from "../../domain/schema";
import { ISSUE_STATUSES, type Snapshot } from "../../domain/types";

const anchor = "2026-10-05T10:00:00.000Z";
const seed = () => createSnapshot({ anchor, generation: "seed-generation" });
function requireIssue(snapshot: Snapshot, id: string) {
  const issue = snapshot.state.issuesById[id];
  if (!issue) throw new Error(`Missing fixture ${id}`);
  return issue;
}

describe("complete Wayline scenario", () => {
  it("contains the approved workspace, people, projects, work, discussion and history", () => {
    const snapshot = seed();
    const state = snapshot.state;
    expect(state.workspace.name).toBe("Wayline Product Engineering");
    expect(state.workspace.visitorId).toBe("maya");
    expect(Object.values(state.projectsById).map((project) => project.name)).toEqual(["Live tracking", "Carrier API", "Operations console"]);
    expect(Object.values(state.usersById).map((user) => user.name)).toEqual(["Maya Chen", "Nina Patel", "Omar Haddad", "Elena Rossi", "Theo Brooks", "Sam Rivera"]);
    const issues = Object.values(state.issuesById);
    expect(issues).toHaveLength(48);
    expect(issues.filter((issue) => issue.parentId === null)).toHaveLength(38);
    expect(issues.filter((issue) => issue.parentId !== null)).toHaveLength(10);
    expect(issues.filter((issue) => issue.priority === "URGENT").map((issue) => issue.key)).toEqual(["API-42"]);
    expect(new Set(issues.map((issue) => issue.status))).toEqual(new Set(ISSUE_STATUSES));
    const sprints = Object.values(state.sprintsById);
    expect(sprints).toHaveLength(5);
    expect(sprints.filter((sprint) => sprint.status === "ACTIVE")).toHaveLength(2);
    expect(sprints.filter((sprint) => sprint.status === "PENDING")).toHaveLength(2);
    expect(sprints.filter((sprint) => sprint.status === "CLOSED")).toHaveLength(1);
    expect(Object.values(state.commentsById)).toHaveLength(30);
    expect(state.activityOrder).toHaveLength(52);
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("has the exact flagship sprint distribution, blockers and approved sample work", () => {
    const snapshot = seed();
    const issues = Object.values(snapshot.state.issuesById).filter((issue) => issue.sprintId === "lt-sprint-12" && issue.parentId === null);
    expect(issues).toHaveLength(12);
    expect(ISSUE_STATUSES.map((status) => issues.filter((issue) => issue.status === status).length)).toEqual([2, 4, 2, 4]);
    expect(issues.filter((issue) => issue.blocker.blocked).map((issue) => issue.key)).toEqual(["LT-121", "LT-124"]);
    expect(snapshot.state.sprintsById["lt-sprint-12"]?.goal).toBe("Trust the tracking feed");
    expect(requireIssue(snapshot, "live-tracking-118").title).toBe("Preserve selected shipment when live updates reorder table");
    expect(requireIssue(snapshot, "operations-console-35").title).toBe("Announce exception-count changes without interrupting screen readers");
    for (const issue of issues) {
      expect(issue.description.root.children.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(issue.description)).toContain("Acceptance criteria:");
    }
  });

  it("has valid ownership, assignees, child relations and counters across every record", () => {
    const { state } = seed();
    for (const issue of Object.values(state.issuesById)) {
      const project = state.projectsById[issue.projectId];
      if (!project) throw new Error("Missing issue project");
      expect(project?.memberIds).toContain(issue.reporterId);
      expect(project?.memberIds).toContain(issue.assigneeId);
      expect(issue.key).toBe(`${project.keyPrefix}-${issue.number}`);
      expect(state.nextIssueNumberByProject[issue.projectId]).toBeGreaterThan(issue.number);
      if (issue.parentId) {
        const parent = state.issuesById[issue.parentId];
        expect(parent?.parentId).toBeNull();
        expect(parent?.projectId).toBe(issue.projectId);
        expect(parent?.sprintId).toBe(issue.sprintId);
      }
    }
    expect(state.nextIssueNumberByProject).toEqual({ "live-tracking": 145, "carrier-api": 54, "operations-console": 40 });
  });

  it("has meaningful chronological events and local self-contained avatars", () => {
    const { state } = seed();
    let previous = -Infinity;
    for (const [index, id] of state.activityOrder.entries()) {
      const event = state.activitiesById[id];
      if (!event) throw new Error("Missing activity");
      expect(event.sequence).toBe(index + 1);
      expect(Date.parse(event.occurredAt)).toBeGreaterThanOrEqual(previous);
      previous = Date.parse(event.occurredAt);
      if (event.kind === "COMMENT_CREATED") {
        expect(event.commentId).not.toBeNull();
        expect(state.commentsById[event.commentId ?? ""]?.issueId).toBe(event.issueId);
      } else expect(event.changes.length).toBeGreaterThan(0);
    }
    for (const user of Object.values(state.usersById)) {
      expect(user.avatarPath).toMatch(/^data:image\/svg\+xml,/);
      expect(decodeURIComponent(user.avatarPath)).not.toContain("https://");
    }
  });

  it("is deterministic, independently cloned, JSON-roundtrippable and rebased only by its input anchor", () => {
    const first = seed(); const second = seed();
    expect(first).toEqual(second);
    requireIssue(first, "live-tracking-118").description.root.children.length = 0;
    expect(requireIssue(second, "live-tracking-118").description.root.children).toHaveLength(2);
    expect(seed()).toEqual(second);
    expect(validateSnapshot(JSON.parse(JSON.stringify(second)) as unknown)).toEqual(second);
    const later = createSnapshot({ anchor: "2026-10-12T10:00:00.000Z", generation: "later" });
    expect(Object.keys(later.state.issuesById)).toEqual(Object.keys(second.state.issuesById));
    expect(requireIssue(later, "live-tracking-118").key).toBe("LT-118");
    expect(Date.parse(requireIssue(later, "live-tracking-118").createdAt) - Date.parse(requireIssue(second, "live-tracking-118").createdAt)).toBe(7 * 86_400_000);
  });
});

describe("snapshot validation", () => {
  it.each([
    ["dangling project", (snapshot: Snapshot) => { requireIssue(snapshot, "live-tracking-118").projectId = "missing"; }],
    ["foreign assignee", (snapshot: Snapshot) => { requireIssue(snapshot, "carrier-api-42").assigneeId = "nina"; }],
    ["foreign sprint", (snapshot: Snapshot) => { requireIssue(snapshot, "live-tracking-130").sprintId = "api-sprint-8"; }],
    ["nested child", (snapshot: Snapshot) => { requireIssue(snapshot, "live-tracking-144").parentId = "live-tracking-140"; }],
    ["self parent", (snapshot: Snapshot) => { requireIssue(snapshot, "live-tracking-144").parentId = "live-tracking-144"; }],
    ["child sprint mismatch", (snapshot: Snapshot) => { requireIssue(snapshot, "live-tracking-144").sprintId = null; }],
    ["counter reuse", (snapshot: Snapshot) => { snapshot.state.nextIssueNumberByProject["live-tracking"] = 144; }],
    ["missing canonical issue", (snapshot: Snapshot) => { snapshot.state.boardOrderByProject["live-tracking"]?.IN_REVIEW.pop(); }],
    ["duplicate canonical issue", (snapshot: Snapshot) => { snapshot.state.boardOrderByProject["live-tracking"]?.IN_REVIEW.push("live-tracking-118"); }],
    ["unknown label", (snapshot: Snapshot) => { requireIssue(snapshot, "live-tracking-130").labelIds = ["missing"]; }],
    ["corrupt history", (snapshot: Snapshot) => {
      const event = Object.values(snapshot.state.activitiesById).find((item) => item.issueId === "live-tracking-118" && item.changes.some((change) => change.field === "status" && change.after === "IN_REVIEW"));
      if (!event) throw new Error("Missing history fixture");
      event.changes = [{ field: "status", before: "DONE", after: "IN_REVIEW" }];
    }],
  ] as const)("rejects %s", (_name, corrupt) => {
    const snapshot = seed(); corrupt(snapshot);
    expect(() => validateSnapshot(snapshot)).toThrow();
  });

  it("rejects unsupported schema versions, unknown statuses, empty blocker reasons and unsafe links", () => {
    expect(snapshotSchema.safeParse({ ...seed(), schemaVersion: 2 }).success).toBe(false);
    const invalid: unknown = { ...requireIssue(seed(), "live-tracking-118"), status: "BLOCKED" };
    const snapshot = seed();
    expect(snapshotSchema.safeParse({ ...snapshot, state: { ...snapshot.state, issuesById: { ...snapshot.state.issuesById, "live-tracking-118": invalid } } }).success).toBe(false);
    requireIssue(snapshot, "live-tracking-121").blocker = { blocked: true, reason: "   " };
    expect(() => validateSnapshot(snapshot)).toThrow();
    expect(richTextDocumentSchema.safeParse({ format: "nexus-rich-text", version: 1, root: { type: "root", children: [
      { type: "paragraph", children: [{ type: "link", url: "javascript:alert(1)", children: [] }] },
    ] } }).success).toBe(false);
  });
});
