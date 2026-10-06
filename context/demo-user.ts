"use client";
import { useQuery } from "@tanstack/react-query";
import { useRepository } from "./repository-provider";
import { repositoryQueries } from "../integration/repository-queries";
import { nexusKeys } from "../integration/query-keys";
import { demoIdentity } from "../integration/demo-identity";
export function useDemoUser() {
  const { repository, projectId } = useRepository();
  const workspace = useQuery(repositoryQueries.workspace(repository));
  const members = useQuery({ queryKey: [...nexusKeys.members(projectId), "identity"], queryFn: () => repository.getProjectMembers(projectId) });
  const user = members.data?.find((member) => member.id === workspace.data?.visitorId);
  return { user: user ? demoIdentity(user) : undefined };
}
