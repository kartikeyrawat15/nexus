"use client";
import { useQuery } from "@tanstack/react-query";
import { useRepository } from "@/context/repository-provider";
import { repositoryQueries } from "@/integration/repository-queries";
import { useIssues } from "./use-issues";

export function useIssueRead(issueKey: string | null) {
  const { repository, projectId } = useRepository();
  const { issues } = useIssues();
  const id = issues?.find((issue) => issue.key === issueKey)?.id;
  return useQuery({ ...repositoryQueries.issue(repository, projectId, id ?? ""), enabled: !!id });
}
