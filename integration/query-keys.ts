/** Repository reads never share keys with legacy API mutations. */
export const nexusKeys = {
  all: ["nexus"] as const,
  workspace: () => ["nexus", "workspace"] as const,
  projects: () => ["nexus", "projects"] as const,
  project: (id: string) => ["nexus", "project", id] as const,
  issues: (projectId: string) => ["nexus", "issues", projectId] as const,
  issue: (projectId: string, issueId: string) => ["nexus", "issue", projectId, issueId] as const,
  sprints: (projectId: string) => ["nexus", "sprints", projectId] as const,
  members: (projectId: string) => ["nexus", "members", projectId] as const,
  comments: (projectId: string, issueId: string) => ["nexus", "comments", projectId, issueId] as const,
  activity: (projectId: string) => ["nexus", "activity", projectId] as const,
};
