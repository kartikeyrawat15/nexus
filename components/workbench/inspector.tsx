"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  FiX,
  FiArrowRight,
  FiTrash2,
  FiPlus,
  FiEdit2,
  FiMessageSquare,
  FiClock,
} from "react-icons/fi";
import { type SerializedEditorState } from "lexical";
import {
  ISSUE_STATUSES,
  ISSUE_KINDS,
  PRIORITIES,
  type IssueStatus,
  type Priority,
  type IssueKind,
  type DeepReadonly,
  type RichTextDocument,
  type InlineNode,
  type ActivityEvent,
} from "@/domain/types";
import { legacyEditorContent } from "@/integration/legacy-views";
import { editorDocument } from "@/integration/editor-document";
import { Editor } from "@/components/text-editor/editor";
import { SharedHistoryContext } from "@/components/text-editor/context/shared-history";
import { useWorkbench, statusNames, type WorkIssue } from "./data";
import { Modal, Person, Status, Blocked } from "./primitives";
import { MoveIssue } from "./dialogs";

export function Inspector() {
  const { selected, openIssue } = useWorkbench();
  const origin = useRef<HTMLElement | null>(null);
  const lastIssue = useRef<WorkIssue | undefined>(selected);
  useEffect(() => {
    if (selected) lastIssue.current = selected;
  }, [selected]);
  const visibleIssue = selected ?? lastIssue.current;
  return (
    <Dialog.Root
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) openIssue();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="nx-inspector-overlay" />
        <Dialog.Content
          className="nx-inspector"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            origin.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const target = origin.current?.isConnected
              ? origin.current
              : document.getElementById("workspace");
            target?.focus();
          }}
        >
          {visibleIssue && (
            <InspectorContent key={visibleIssue.id} issue={visibleIssue} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function InspectorContent({ issue }: { issue: WorkIssue }) {
  const {
    snapshot,
    update,
    repository,
    run,
    busy,
    openIssue,
    setCreate,
    notify,
  } = useWorkbench();
  const [title, setTitle] = useState(issue.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionVersion, setDescriptionVersion] = useState(issue.version);
  const [descriptionBase, setDescriptionBase] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [block, setBlock] = useState(false);
  const [reason, setReason] = useState(issue.blocker.reason ?? "");
  const [move, setMove] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState("comments");
  const state = snapshot.state;
  const project = state.projectsById[issue.projectId];
  const children = (state.childOrderByParent[issue.id] ?? []).flatMap((id) => {
    const i = state.issuesById[id];
    return i && !i.deletedAt ? [i] : [];
  });
  const comments = Object.values(state.commentsById)
    .filter((c) => c.issueId === issue.id && !c.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const events = state.activityOrder
    .flatMap((id) => {
      const e = state.activitiesById[id];
      return e?.issueId === issue.id ? [e] : [];
    })
    .reverse();
  const deleteIssue = () => {
    const generation = snapshot.generation;
    void run(() =>
      repository.deleteIssue({
        issueId: issue.id,
        expectedGeneration: generation,
        expectedVersion: issue.version,
        children: "delete",
      })
    ).then((ok) => {
      if (ok) {
        openIssue();
        notify({
          text: `${issue.key} deleted${
            children.length ? ` with ${children.length} child issues` : ""
          }`,
          undo: () =>
            repository.restoreIssue({
              issueId: issue.id,
              expectedGeneration: generation,
            }),
        });
      }
    });
  };
  const saveDocument = (value: SerializedEditorState | undefined) => {
    // Other field edits made while the editor is open must not block the save;
    // only a description changed elsewhere since editing began is a conflict.
    const expectedVersion =
      JSON.stringify(issue.description) === descriptionBase
        ? issue.version
        : descriptionVersion;
    return run(
      () =>
        repository.updateIssue({
          issueId: issue.id,
          expectedGeneration: snapshot.generation,
          expectedVersion,
          patch: {
            description: editorDocument(
              JSON.stringify(value ?? { root: { type: "root", children: [] } })
            ),
          },
        }),
      "Description saved"
    );
  };
  return (
    <SharedHistoryContext>
      <header className="nx-inspector-header">
        <span className="nx-key">
          {project?.keyPrefix} <span className="nx-slash">/</span> {issue.key}
        </span>
        <div>
          <button
            className="nx-icon"
            aria-label="Move issue"
            onClick={() => setMove(true)}
          >
            <FiArrowRight />
          </button>
          <button
            className="nx-icon"
            aria-label="Delete issue"
            onClick={() => setDeleting(true)}
          >
            <FiTrash2 />
          </button>
          <Dialog.Close className="nx-icon" aria-label="Close issue">
            <FiX />
          </Dialog.Close>
        </div>
      </header>
      <div className="nx-inspector-scroll">
        {issue.parentId && (
          <button
            className="nx-parent-link"
            onClick={() => openIssue(state.issuesById[issue.parentId ?? ""])}
          >
            ↳ {state.issuesById[issue.parentId]?.key} · Parent issue
          </button>
        )}
        <Dialog.Title className="nx-sr-only">
          {issue.key}: {issue.title}
        </Dialog.Title>
        {editingTitle ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void update(issue, { title }).then((ok) => {
                if (ok) setEditingTitle(false);
              });
            }}
          >
            <textarea
              autoFocus
              aria-label="Issue title"
              className="nx-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditingTitle(false);
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="nx-actions">
              <button
                type="button"
                className="nx-button"
                onClick={() => setEditingTitle(false)}
              >
                Cancel
              </button>
              <button
                className="nx-button primary"
                disabled={busy || !title.trim()}
              >
                Save title
              </button>
            </div>
          </form>
        ) : (
          <button
            className="nx-inspector-title"
            onClick={() => {
              setTitle(issue.title);
              setEditingTitle(true);
            }}
          >
            {issue.title}
            <FiEdit2 />
          </button>
        )}
        <div className="nx-properties">
          <label>
            Status
            <select
              aria-label="Issue status"
              value={issue.status}
              onChange={(e) => {
                void update(issue, { status: e.target.value as IssueStatus });
              }}
            >
              {ISSUE_STATUSES.map((s) => (
                <option value={s} key={s}>
                  {statusNames[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              aria-label="Issue priority"
              value={issue.priority}
              onChange={(e) => {
                void update(issue, { priority: e.target.value as Priority });
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0]}
                  {p.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select
              aria-label="Issue assignee"
              value={issue.assigneeId ?? ""}
              onChange={(e) => {
                void update(issue, { assigneeId: e.target.value || null });
              }}
            >
              <option value="">Unassigned</option>
              {project?.memberIds.map((id) => (
                <option key={id} value={id}>
                  {state.usersById[id]?.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              aria-label="Issue type"
              value={issue.kind}
              onChange={(e) => {
                void update(issue, { kind: e.target.value as IssueKind });
              }}
            >
              {ISSUE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <div>
            <span>Sprint</span>
            <button
              className="nx-property-button"
              onClick={() => setMove(true)}
            >
              {issue.sprintId
                ? state.sprintsById[issue.sprintId]?.name
                : "Backlog"}
              <FiArrowRight />
            </button>
          </div>
          <div>
            <span>Reporter</span>
            <Person user={state.usersById[issue.reporterId]} name />
          </div>
        </div>
        {issue.blocker.blocked ? (
          <div className="nx-blocker-detail">
            <Blocked reason={issue.blocker.reason} />
            <button
              className="nx-text-button"
              onClick={() => {
                void update(issue, {
                  blocker: { blocked: false, reason: null },
                });
              }}
            >
              Resolve blocker
            </button>
            <button className="nx-text-button" onClick={() => setBlock(true)}>
              Edit reason
            </button>
          </div>
        ) : (
          <button
            className="nx-text-button nx-blocker-add"
            onClick={() => setBlock(true)}
          >
            ＋ Flag a blocker
          </button>
        )}
        <section className="nx-detail-section">
          <div className="nx-section-heading">
            <h2>Context</h2>
            {!editingDescription && (
              <button
                className="nx-icon"
                aria-label="Edit description"
                onClick={() => {
                  setDescriptionVersion(issue.version);
                  setDescriptionBase(JSON.stringify(issue.description));
                  setEditingDescription(true);
                }}
              >
                <FiEdit2 />
              </button>
            )}
          </div>
          {editingDescription ? (
            <Editor
              compact
              action="description"
              content={
                JSON.parse(
                  legacyEditorContent(issue.description)
                ) as SerializedEditorState
              }
              onSave={(value) => {
                void saveDocument(value).then((ok) => {
                  if (ok) setEditingDescription(false);
                });
              }}
              onCancel={() => setEditingDescription(false)}
            />
          ) : (
            <RichDocument document={issue.description} />
          )}
        </section>
        {!issue.parentId && (
          <section className="nx-detail-section">
            <div className="nx-section-heading">
              <h2>
                Child work{" "}
                <span>
                  {children.filter((i) => i.status === "DONE").length}/
                  {children.length}
                </span>
              </h2>
              <button
                className="nx-icon"
                aria-label="Add child issue"
                onClick={() =>
                  setCreate({ sprintId: issue.sprintId, parentId: issue.id })
                }
              >
                <FiPlus />
              </button>
            </div>
            {children.map((child) => (
              <button
                className="nx-child-row"
                key={child.id}
                onClick={() => openIssue(child)}
              >
                <Status status={child.status} label={false} />
                <span className="nx-key">{child.key}</span>
                <span>{child.title}</span>
                <FiArrowRight />
              </button>
            ))}
            {!children.length && (
              <p className="nx-small nx-muted">
                Break a larger idea into focused pieces of work.
              </p>
            )}
          </section>
        )}
        <section className="nx-detail-section">
          <div className="nx-detail-tabs">
            <button
              className={tab === "comments" ? "active" : ""}
              onClick={() => setTab("comments")}
            >
              <FiMessageSquare />
              Discussion <span>{comments.length}</span>
            </button>
            <button
              className={tab === "activity" ? "active" : ""}
              onClick={() => setTab("activity")}
            >
              <FiClock />
              Activity
            </button>
          </div>
          {tab === "comments" ? (
            <>
              <div className="nx-comments">
                {comments.map((c) => (
                  <article key={c.id}>
                    <header>
                      <Person user={state.usersById[c.authorId]} name />
                      <time dateTime={c.createdAt}>
                        {dateLabel(c.createdAt)}
                        {c.editedAt ? " · edited" : ""}
                      </time>
                    </header>
                    {editingComment === c.id ? (
                      <Editor
                        compact
                        action="comment"
                        content={
                          JSON.parse(
                            legacyEditorContent(c.body)
                          ) as SerializedEditorState
                        }
                        onCancel={() => setEditingComment(null)}
                        onSave={(value) => {
                          void run(
                            () =>
                              repository.updateComment({
                                commentId: c.id,
                                expectedGeneration: snapshot.generation,
                                expectedVersion: c.version,
                                body: editorDocument(
                                  JSON.stringify(
                                    value ?? {
                                      root: { type: "root", children: [] },
                                    }
                                  )
                                ),
                              }),
                            "Comment updated"
                          ).then((ok) => {
                            if (ok) setEditingComment(null);
                          });
                        }}
                      />
                    ) : (
                      <RichDocument document={c.body} />
                    )}
                    {c.authorId === state.workspace.visitorId && (
                      <div className="nx-comment-actions">
                        <button onClick={() => setEditingComment(c.id)}>
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            void run(
                              () =>
                                repository.deleteComment({
                                  commentId: c.id,
                                  expectedGeneration: snapshot.generation,
                                  expectedVersion: c.version,
                                }),
                              "Comment deleted"
                            );
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              {commenting ? (
                <Editor
                  compact
                  action="comment"
                  content={undefined}
                  onCancel={() => setCommenting(false)}
                  onSave={(value) => {
                    void run(
                      () =>
                        repository.createComment({
                          issueId: issue.id,
                          expectedGeneration: snapshot.generation,
                          body: editorDocument(
                            JSON.stringify(
                              value ?? { root: { type: "root", children: [] } }
                            )
                          ),
                        }),
                      "Comment added"
                    ).then((ok) => {
                      if (ok) setCommenting(false);
                    });
                  }}
                />
              ) : (
                <button
                  className="nx-comment-compose"
                  onClick={() => setCommenting(true)}
                >
                  <Person user={state.usersById[state.workspace.visitorId]} />
                  Add to the discussion…<span>↵</span>
                </button>
              )}
            </>
          ) : (
            <div className="nx-activity">
              {events.map((e) => (
                <Activity key={e.id} event={e} />
              ))}
              {!events.length && <p className="nx-muted">No activity yet.</p>}
            </div>
          )}
        </section>
        <footer className="nx-detail-dates">
          Created {dateLabel(issue.createdAt)}
          <span>Updated {dateLabel(issue.updatedAt)}</span>
        </footer>
      </div>
      {move && <MoveIssue issue={issue} onClose={() => setMove(false)} />}
      {block && (
        <Modal
          title="What is blocking this issue?"
          onClose={() => setBlock(false)}
        >
          <form
            className="nx-dialog-body"
            onSubmit={(e) => {
              e.preventDefault();
              void update(issue, { blocker: { blocked: true, reason } }).then(
                (ok) => {
                  if (ok) setBlock(false);
                }
              );
            }}
          >
            <label className="nx-field">
              Blocker reason
              <textarea
                autoFocus
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe what needs to be resolved…"
              />
            </label>
            <div className="nx-actions">
              <button
                type="button"
                className="nx-button"
                onClick={() => setBlock(false)}
              >
                Cancel
              </button>
              <button
                className="nx-button primary"
                disabled={busy || !reason.trim()}
              >
                Save blocker
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title={`Delete ${issue.key}?`}
          onClose={() => setDeleting(false)}
        >
          <div className="nx-dialog-body">
            <p>
              {children.length
                ? `This issue and its ${children.length} child issues will be deleted. `
                : "This issue will be deleted. "}
              You can restore this deletion with Undo. Other work stays
              untouched.
            </p>
            <div className="nx-actions">
              <button className="nx-button" onClick={() => setDeleting(false)}>
                Keep issue
              </button>
              <button
                className="nx-button danger"
                disabled={busy}
                onClick={deleteIssue}
              >
                Delete issue
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SharedHistoryContext>
  );
}
function inline(nodes: readonly DeepReadonly<InlineNode>[]): ReactNode {
  return nodes.map((n, idx) => {
    if (n.type === "link")
      return (
        <a key={idx} href={n.url} target="_blank" rel="noreferrer">
          {inline(n.children)}
        </a>
      );
    let content: ReactNode = n.text;
    if (n.marks.includes("code")) content = <code>{content}</code>;
    if (n.marks.includes("bold")) content = <strong>{content}</strong>;
    if (n.marks.includes("italic")) content = <em>{content}</em>;
    return <span key={idx}>{content}</span>;
  });
}
export function RichDocument({
  document,
}: {
  document: DeepReadonly<RichTextDocument>;
}) {
  return (
    <div className="nx-rich">
      {document.root.children.length ? (
        document.root.children.map((n, idx) =>
          n.type === "list" ? (
            n.ordered ? (
              <ol key={idx}>
                {n.children.map((c, k) => (
                  <li key={k}>{inline(c.children)}</li>
                ))}
              </ol>
            ) : (
              <ul key={idx}>
                {n.children.map((c, k) => (
                  <li key={k}>{inline(c.children)}</li>
                ))}
              </ul>
            )
          ) : n.type === "heading" ? (
            <h3 key={idx}>{inline(n.children)}</h3>
          ) : n.type === "quote" ? (
            <blockquote key={idx}>{inline(n.children)}</blockquote>
          ) : (
            <p key={idx}>{inline(n.children)}</p>
          )
        )
      ) : (
        <p className="nx-muted">
          Add context, decisions, or acceptance criteria.
        </p>
      )}
    </div>
  );
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
export function Activity({ event }: { event: DeepReadonly<ActivityEvent> }) {
  const { snapshot, openIssue } = useWorkbench();
  const state = snapshot.state;
  const issue = event.issueId ? state.issuesById[event.issueId] : undefined;
  const labels: Record<string, string> = {
    ISSUE_CREATED: "created",
    ISSUE_UPDATED: "updated",
    ISSUE_MOVED: "moved",
    ISSUE_DELETED: "deleted",
    ISSUE_RESTORED: "restored",
    COMMENT_CREATED: "commented on",
    COMMENT_UPDATED: "edited a comment on",
    COMMENT_DELETED: "removed a comment from",
    SPRINT_CREATED: "created",
    SPRINT_UPDATED: "updated",
    SPRINT_DELETED: "deleted",
    SPRINT_STARTED: "started",
    SPRINT_COMPLETED: "completed",
  };
  const detail = event.changes
    .map((c) =>
      c.field === "status"
        ? statusNames[c.after]
        : c.field === "priority"
        ? `${c.after.toLowerCase()} priority`
        : c.field === "assigneeId"
        ? `Assigned to ${
            c.after ? state.usersById[c.after]?.name ?? c.after : "nobody"
          }`
        : c.field === "blocker"
        ? c.after.blocked
          ? "Flagged a blocker"
          : "Resolved blocker"
        : ""
    )
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="nx-activity-row">
      <Person user={state.usersById[event.actorId]} />
      <div>
        <p>
          <strong>{state.usersById[event.actorId]?.name.split(" ")[0]}</strong>{" "}
          {labels[event.kind]}{" "}
          {issue ? (
            <button
              disabled={!!issue.deletedAt}
              onClick={() => openIssue(issue)}
            >
              {issue.key}
            </button>
          ) : event.sprintId ? (
            state.sprintsById[event.sprintId]?.name
          ) : (
            "work"
          )}
        </p>
        {detail && <span>{detail}</span>}
        <time dateTime={event.occurredAt}>{dateLabel(event.occurredAt)}</time>
      </div>
    </article>
  );
}
