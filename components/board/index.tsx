"use client";
import React, { Fragment, useCallback, useLayoutEffect, useRef } from "react";
import { type IssueStatus } from "@/domain/types";
import "@/styles/split.css";
import { BoardHeader } from "./header";
import {
  DragDropContext,
  type DropResult,
} from "react-beautiful-dnd";
import { useIssues } from "@/hooks/query-hooks/use-issues";
import { type IssueType } from "@/utils/types";
import {
  assigneeNotInFilters,
  epicNotInFilters,
  isEpic,
  isNullish,
  isSubtask,
  issueNotInSearch,
  issueSprintNotInFilters,
  issueTypeNotInFilters,
} from "@/utils/helpers";
import { IssueList } from "./issue-list";
import { IssueDetailsModal } from "../modals/board-issue-details";
import { useSprints } from "@/hooks/query-hooks/use-sprints";
import { useProject } from "@/hooks/query-hooks/use-project";
import { useFiltersContext } from "@/context/use-filters-context";
import { dragPlacement } from "@/integration/drag-placement";

const STATUSES: IssueStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];

const Board: React.FC = () => {
  const renderContainerRef = useRef<HTMLDivElement>(null);

  const { issues } = useIssues();
  const { sprints } = useSprints();
  const { project } = useProject();
  const {
    search,
    assignees,
    issueTypes,
    epics,
    sprints: filterSprints,
  } = useFiltersContext();

  const filterIssues = useCallback(
    (issues: IssueType[] | undefined, status: IssueStatus) => {
      if (!issues) return [];
      const filteredIssues = issues.filter((issue) => {
        if (
          issue.status === status &&
          issue.sprintIsActive &&
          !isEpic(issue) &&
          !isSubtask(issue)
        ) {
          if (issueNotInSearch({ issue, search })) return false;
          if (assigneeNotInFilters({ issue, assignees })) return false;
          if (epicNotInFilters({ issue, epics })) return false;
          if (issueTypeNotInFilters({ issue, issueTypes })) return false;
          if (issueSprintNotInFilters({ issue, sprintIds: filterSprints })) {
            return false;
          }
          return true;
        }
        return false;
      });

      return filteredIssues;
    },
    [search, assignees, epics, issueTypes, filterSprints]
  );

  const { moveIssue } = useIssues();

  useLayoutEffect(() => {
    if (!renderContainerRef.current) return;
    const calculatedHeight = renderContainerRef.current.offsetTop + 20;
    renderContainerRef.current.style.height = `calc(100vh - ${calculatedHeight}px)`;
  }, []);

  if (!issues || !sprints || !project) {
    return null;
  }

  const onDragEnd = (result: DropResult) => {
    const { destination, source } = result;
    if (isNullish(destination) || isNullish(source)) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    const status = destination.droppableId as IssueStatus;
    moveIssue({
      issueId: result.draggableId,
      destination: { view: "board", status },
      placement: dragPlacement([...filterIssues(issues, status)].sort((a, b) => a.boardPosition - b.boardPosition).map((issue) => issue.id), result.draggableId, destination.index),
    });
  };

  return (
    <Fragment>
      <IssueDetailsModal />
      <BoardHeader project={project} />
      <DragDropContext onDragEnd={onDragEnd}>
        <div
          ref={renderContainerRef}
          className="relative flex w-full max-w-full gap-x-4 overflow-y-auto"
        >
          {STATUSES.map((status) => (
            <IssueList
              key={status}
              status={status}
              issues={filterIssues(issues, status)}
            />
          ))}
        </div>
      </DragDropContext>
    </Fragment>
  );
};

export { Board };
