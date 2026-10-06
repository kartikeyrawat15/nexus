"use client";
import { useRepositoryCommands, useRepositoryMutation } from "../use-repository-mutation";
export function useUpdateIssue() {
  const commands = useRepositoryCommands();
  const mutation = useRepositoryMutation(commands.updateIssue, "update issue");
  const movement = useRepositoryMutation(commands.moveIssue, "move issue");
  return { updateIssue: mutation.mutate, isUpdating: mutation.isLoading, moveIssue: movement.mutate, isMoving: movement.isLoading };
}
