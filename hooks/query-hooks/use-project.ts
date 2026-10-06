"use client";
import { useRepository } from "@/context/repository-provider";
import { repositoryQueries } from "@/integration/repository-queries";
import { useQuery } from "@tanstack/react-query";

export const useProject = () => {
  const { repository, projectId } = useRepository();
  const { data: project, isLoading: projectIsLoading } = useQuery(
    repositoryQueries.project(repository, projectId)
  );
  const { data: members } = useQuery(
    repositoryQueries.members(repository, projectId)
  );

  return {
    project,
    projectIsLoading,
    members,
  };
};
