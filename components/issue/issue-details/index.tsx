"use client";
import React, { useEffect } from "react";
import { useIssueRead } from "@/hooks/query-hooks/use-issue-read";
import { useIsInViewport } from "@/hooks/use-is-in-viewport";
import { IssueDetailsHeader } from "./issue-details-header";
import { IssueDetailsInfo } from "./issue-details-info";
import { type IssueType } from "@/utils/types";

const IssueDetails: React.FC<{
  issueKey: string | null;
  setIssueKey: React.Dispatch<React.SetStateAction<IssueType["key"] | null>>;
}> = ({ issueKey, setIssueKey }) => {
  const { data: issueInfo } = useIssueRead(issueKey);
  const renderContainerRef = React.useRef<HTMLDivElement>(null);
  const [isInViewport, viewportRef] = useIsInViewport({ threshold: 1 });

  useEffect(() => {
    if (renderContainerRef.current) {
      renderContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [issueKey]);

  if (!issueInfo) return <div />;

  return (
    <div
      ref={renderContainerRef}
      data-state={issueKey ? "open" : "closed"}
      className="relative z-10 flex w-full flex-col overflow-y-auto pl-4 pr-2 [&[data-state=closed]]:hidden"
    >
      <IssueDetailsHeader
        issue={issueInfo}
        setIssueKey={setIssueKey}
        isInViewport={isInViewport}
      />
      <IssueDetailsInfo issue={issueInfo} ref={viewportRef} />
    </div>
  );
};

export { IssueDetails };
