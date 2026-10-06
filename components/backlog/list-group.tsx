"use client";
import { useIssues } from "@/hooks/query-hooks/use-issues";
import clsx from "clsx";
import { BacklogList } from "./list-backlog";
import { SprintList } from "./list-sprint";
import {
  DragDropContext,
  type DropResult,
} from "react-beautiful-dnd";
import { type IssueType } from "@/utils/types";
import { useCallback } from "react";
import { useFiltersContext } from "@/context/use-filters-context";
import {
  assigneeNotInFilters,
  epicNotInFilters,
  isEpic,
  isNullish,
  isSubtask,
  issueNotInSearch,
  issueTypeNotInFilters,
} from "@/utils/helpers";
import { useSprints } from "@/hooks/query-hooks/use-sprints";
import { dragPlacement } from "@/integration/drag-placement";

const ListGroup: React.FC<{ className?: string }> = ({ className }) => {
  const { issues, moveIssue } = useIssues();
  const { search, assignees, issueTypes, epics } = useFiltersContext();
  const { sprints } = useSprints();

  const filterIssues = useCallback(
    (issues: IssueType[] | undefined, sprintId: string | null) => {
      if (!issues) return [];
      const filteredIssues = issues.filter((issue) => {
        if (
          issue.sprintId === sprintId &&
          !isEpic(issue) &&
          !isSubtask(issue)
        ) {
          if (issueNotInSearch({ issue, search })) return false;
          if (assigneeNotInFilters({ issue, assignees })) return false;
          if (epicNotInFilters({ issue, epics })) return false;
          if (issueTypeNotInFilters({ issue, issueTypes })) return false;
          return true;
        }
        return false;
      });

      return filteredIssues;
    },
    [search, assignees, epics, issueTypes]
  );

  const onDragEnd = (result: DropResult) => {
    const { destination, source } = result;
    if (isNullish(destination) || isNullish(source)) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    const sprintId = destination.droppableId === "backlog" ? null : destination.droppableId;
    moveIssue({
      issueId: result.draggableId,
      destination: { view: "planning", sprintId },
      placement: dragPlacement([...filterIssues(issues, sprintId)].sort((a, b) => a.sprintPosition - b.sprintPosition).map((issue) => issue.id), result.draggableId, destination.index),
    });
  };

  if (!sprints) return <div />;
  return (
    <div
      className={clsx(
        "min-h-full w-full max-w-full overflow-y-auto",
        className
      )}
    >
      <DragDropContext onDragEnd={onDragEnd}>
        {sprints.map((sprint) => (
          <div key={sprint.id} className="my-3">
            <SprintList
              sprint={sprint}
              issues={filterIssues(issues, sprint.id)}
            />
          </div>
        ))}
        <BacklogList id="backlog" issues={filterIssues(issues, null)} />
      </DragDropContext>
    </div>
  );
};

ListGroup.displayName = "ListGroup";
export { ListGroup };
