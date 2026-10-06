"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode } from "react";
import {
  FiX,
  FiCircle,
  FiCheckCircle,
  FiDisc,
  FiGitPullRequest,
  FiAlertCircle,
} from "react-icons/fi";
import { type DeepReadonly, type User, type IssueStatus } from "@/domain/types";
import { statusNames } from "./data";
export function Status({
  status,
  label = true,
}: {
  status: IssueStatus;
  label?: boolean;
}) {
  const Icon = {
    TODO: FiCircle,
    IN_PROGRESS: FiDisc,
    IN_REVIEW: FiGitPullRequest,
    DONE: FiCheckCircle,
  }[status];
  return (
    <span className={`nx-status nx-${status}`}>
      <Icon aria-hidden="true" />
      {label && statusNames[status]}
    </span>
  );
}
export function Person({
  user,
  name = false,
}: {
  user?: DeepReadonly<User>;
  name?: boolean;
}) {
  return (
    <span className="nx-person" title={user?.name ?? "Unassigned"}>
      <span
        className={`nx-avatar nx-person-${user?.id ?? "none"}`}
        aria-label={user?.name ?? "Unassigned"}
      >
        {user
          ? user.name
              .split(" ")
              .map((n) => n[0])
              .join("")
          : "–"}
      </span>
      {name && <span>{user?.name ?? "Unassigned"}</span>}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="nx-overlay" />
        <Dialog.Content
          className={`nx-dialog ${className}`}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            const content = event.currentTarget;
            if (content instanceof HTMLElement) {
              const input =
                content.querySelector<HTMLElement>("input,textarea");
              if (input) {
                event.preventDefault();
                input.focus();
              }
            }
          }}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="nx-icon" aria-label="Close dialog">
              <FiX />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="nx-empty">
      <FiCircle />
      <p>{children}</p>
    </div>
  );
}
export function Blocked({ reason }: { reason: string }) {
  return (
    <div className="nx-blocked">
      <FiAlertCircle aria-hidden="true" />
      <span>{reason}</span>
    </div>
  );
}
