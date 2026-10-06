"use client";
import { useMutation } from "@tanstack/react-query";
import { ZodError } from "zod";
import { DomainError } from "@/domain/types";
import { toast } from "@/components/toast";
import { useRepository } from "@/context/repository-provider";
import { repositoryMutations } from "@/integration/repository-mutations";
export function useRepositoryCommands() {
  const { repository, projectId } = useRepository(); return repositoryMutations(repository, projectId);
}
export function useRepositoryMutation<T, V>(command: (variables: V) => Promise<T>, action: string) {
  return useMutation({ mutationFn: command, onError: (error: unknown) => {
    const description = error instanceof DomainError ? error.message : error instanceof ZodError ? error.issues[0]?.message ?? "Invalid input" : "Please try again.";
    toast.error({ message: `Unable to ${action}`, description });
  } });
}
