"use client";
import { useRepositoryCommands, useRepositoryMutation } from "../use-repository-mutation";
export function usePostIssue() {
  const commands = useRepositoryCommands();
  const mutation = useRepositoryMutation(commands.createIssue, "create issue");
  return { createIssue: mutation.mutate, isCreating: mutation.isLoading };
}
