"use client";
import { useQuery } from "@tanstack/react-query";
import { useRepository } from "@/context/repository-provider";
import { repositoryQueries } from "@/integration/repository-queries";
import { useRepositoryCommands, useRepositoryMutation } from "./use-repository-mutation";
export function useSprints() {
  const { repository, projectId } = useRepository(); const commands = useRepositoryCommands();
  const { data: sprints, isLoading: sprintsLoading } = useQuery(repositoryQueries.sprints(repository, projectId));
  const update = useRepositoryMutation(commands.updateSprint, "update sprint");
  const create = useRepositoryMutation(commands.createSprint, "create sprint");
  const remove = useRepositoryMutation(commands.deleteSprint, "delete sprint");
  const start = useRepositoryMutation(commands.startSprint, "start sprint");
  const complete = useRepositoryMutation(commands.completeSprint, "complete sprint");
  return { sprints, sprintsLoading, updateSprint: update.mutate, isUpdating: update.isLoading,
    createSprint: () => create.mutate(undefined), isCreating: create.isLoading, deleteSprint: remove.mutate, isDeleting: remove.isLoading,
    startSprint: start.mutate, isStarting: start.isLoading, completeSprint: complete.mutate, isCompleting: complete.isLoading };
}
