"use client";
import { useRepository } from "@/context/repository-provider";
import { repositoryQueries } from "@/integration/repository-queries";
import { useQuery } from "@tanstack/react-query";
import { useUpdateIssue } from "./use-update-issue";
import { usePostIssue } from "./use-post-issue";
import { useDeleteIssue } from "./use-delete-issue";

export const TOO_MANY_REQUESTS = {
  message: `You have exceeded the number of requests allowed per minute.`,
  description: "Please try again later.",
};

export const useIssues = () => {
  const { repository, projectId } = useRepository();
  const { data: issues, isLoading: issuesLoading } = useQuery(
    repositoryQueries.issues(repository, projectId)
  );

  const { updateIssue, isUpdating, moveIssue, isMoving } = useUpdateIssue();
  const { createIssue, isCreating } = usePostIssue();
  const { deleteIssue, isDeleting } = useDeleteIssue();

  return {
    issues,
    issuesLoading,
    updateIssue,
    isUpdating,
    moveIssue,
    isMoving,
    createIssue,
    isCreating,
    deleteIssue,
    isDeleting,
  };
};
