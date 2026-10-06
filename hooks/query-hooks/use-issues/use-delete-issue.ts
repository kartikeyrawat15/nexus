"use client";
import { toast } from "@/components/toast";
import { useSelectedIssueContext } from "@/context/use-selected-issue-context";
import { useRepositoryCommands, useRepositoryMutation } from "../use-repository-mutation";
export function useDeleteIssue() {
  const { setIssueKey } = useSelectedIssueContext();
  const commands = useRepositoryCommands();
  const restore = useRepositoryMutation(commands.restoreIssue, "restore issue");
  const mutation = useRepositoryMutation(commands.deleteIssue, "delete issue");
  const deleteIssue: typeof mutation.mutate = (input, options) => mutation.mutate(input, {
    ...options, onSuccess: (deleted, variables, context) => {
      setIssueKey(null);
      toast.undo({ message: `${deleted.key} deleted`, description: "Restore this issue and its children.",
        onUndo: () => restore.mutate({ issueId: deleted.id, expectedGeneration: deleted.generation }) });
      options?.onSuccess?.(deleted, variables, context);
    },
  });
  return { deleteIssue, isDeleting: mutation.isLoading };
}
