import { type IssueView } from "@/integration/legacy-views";

export type IssueCountType = {
  TODO: number;
  IN_PROGRESS: number;
  IN_REVIEW: number;
  DONE: number;
};

export type MenuOptionType = {
  label: string;
  id: string;
};

export type IssueType = IssueView;
