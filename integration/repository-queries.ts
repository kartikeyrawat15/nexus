import { type FoundationRepository } from "../repositories/contracts";
import { commentView, memberView, projectIssuesView, projectView, sprintView } from "./legacy-views";
import { nexusKeys } from "./query-keys";

export const repositoryQueries = {
  workspace: (repository: FoundationRepository) => ({ queryKey: nexusKeys.workspace(), queryFn: () => repository.getWorkspace() }),
  projects: (repository: FoundationRepository) => ({ queryKey: nexusKeys.projects(), queryFn: async () => (await repository.getProjects()).map(projectView) }),
  project: (repository: FoundationRepository, id: string) => ({ queryKey: nexusKeys.project(id), queryFn: async () => projectView(await repository.getProject(id)) }),
  members: (repository: FoundationRepository, id: string) => ({ queryKey: nexusKeys.members(id), queryFn: async () => (await repository.getProjectMembers(id)).map(memberView) }),
  issues: (repository: FoundationRepository, id: string) => ({ queryKey: nexusKeys.issues(id), queryFn: async () => projectIssuesView(await repository.getSnapshot(), id) }),
  issue: (repository: FoundationRepository, projectId: string, issueId: string) => ({ queryKey: nexusKeys.issue(projectId, issueId), queryFn: async () => {
    await repository.getIssue(issueId);
    return projectIssuesView(await repository.getSnapshot(), projectId).find((issue) => issue.id === issueId) ?? null;
  } }),
  sprints: (repository: FoundationRepository, id: string) => ({ queryKey: nexusKeys.sprints(id), queryFn: async () =>
    (await repository.getProjectSprints(id)).filter((sprint) => sprint.status !== "CLOSED").map(sprintView) }),
  sprintHistory: (repository: FoundationRepository, id: string) => ({ queryKey: [...nexusKeys.sprints(id), "history"] as const, queryFn: async () =>
    (await repository.getProjectSprints(id)).map(sprintView) }),
  comments: (repository: FoundationRepository, projectId: string, issueId: string) => ({ queryKey: nexusKeys.comments(projectId, issueId), queryFn: async () => {
    const [comments, members] = await Promise.all([repository.getComments(issueId), repository.getProjectMembers(projectId)]);
    return comments.map((comment) => commentView(comment, members));
  } }),
};
