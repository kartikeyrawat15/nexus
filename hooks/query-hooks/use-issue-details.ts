"use client";
import { useQuery } from "@tanstack/react-query";
import { useSelectedIssueContext } from "@/context/use-selected-issue-context";
import { useRepository } from "@/context/repository-provider";
import { repositoryQueries } from "@/integration/repository-queries";
import { useIssues } from "./use-issues";
import { useRepositoryCommands, useRepositoryMutation } from "./use-repository-mutation";
export function useIssueDetails() {
  const { repository, projectId } = useRepository(); const commands = useRepositoryCommands();
  const { issueKey } = useSelectedIssueContext(); const { issues } = useIssues();
  const issueId = issues?.find((issue) => issue.key === issueKey)?.id;
  const { data: comments, isLoading: commentsLoading } = useQuery({
    ...repositoryQueries.comments(repository, projectId, issueId ?? ""), enabled: !!issueId });
  const add = useRepositoryMutation(commands.addComment, "add comment");
  const update = useRepositoryMutation(commands.updateComment, "edit comment");
  const remove = useRepositoryMutation(commands.deleteComment, "delete comment");
  return { comments, commentsLoading, addComment: add.mutate, isAddingComment: add.isLoading,
    updateComment: update.mutate, commentUpdating: update.isLoading, deleteComment: remove.mutate, commentDeleting: remove.isLoading };
}
