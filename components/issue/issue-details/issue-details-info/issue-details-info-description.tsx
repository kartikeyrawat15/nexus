import { Editor } from "@/components/text-editor/editor";
import { type SerializedEditorState } from "lexical";
import { EditorPreview } from "@/components/text-editor/preview";
import { Fragment, useState } from "react";
import { type IssueType } from "@/utils/types";
import { useIssues } from "@/hooks/query-hooks/use-issues";
const Description: React.FC<{ issue: IssueType }> = ({ issue }) => {
  const [isEditing, setIsEditing] = useState(false);
  const { updateIssue } = useIssues();

  const content = (
    (issue.description
      ? JSON.parse(issue.description)
      : undefined) as SerializedEditorState
  );

  function handleEdit(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    event.preventDefault();
    setIsEditing(true);
  }

  function handleSave(state: SerializedEditorState | undefined) {
    updateIssue({
      issueId: issue.id,
      expectedVersion: issue.version,
      description: state ? JSON.stringify(state) : undefined,
    }, { onSuccess: () => setIsEditing(false) });
  }

  function handleCancel() {
    setIsEditing(false);
  }
  return (
    <Fragment>
      <h2>Description</h2>
      <div>
        {isEditing ? (
          <Editor
            action="description"
            content={content}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <div onMouseDown={handleEdit}>
            <EditorPreview
              key={issue.description}
              action="description"
              content={content}
              className="transition-all duration-200 hover:bg-gray-100"
            />
          </div>
        )}
      </div>
    </Fragment>
  );
};

export { Description };
