"use client";
import {
  FiArrowUpRight,
  FiArrowRight,
  FiAlertCircle,
  FiGitPullRequest,
} from "react-icons/fi";
import { useWorkbench } from "./data";
import { Person, Status } from "./primitives";
import { Activity, dateLabel } from "./inspector";
export function WorkOverview() {
  const { snapshot, navigate, openIssue } = useWorkbench();
  const state = snapshot.state;
  const issues = Object.values(state.issuesById).filter((i) => !i.deletedAt);
  const top = issues.filter((i) => !i.parentId);
  const blocked = issues.filter(
    (i) => i.blocker.blocked && i.status !== "DONE"
  );
  const reviews = top.filter((i) => i.status === "IN_REVIEW");
  const events = [...state.activityOrder]
    .reverse()
    .slice(0, 7)
    .flatMap((id) => {
      const event = state.activitiesById[id];
      return event ? [event] : [];
    });
  return (
    <div className="nx-overview">
      <div className="nx-overview-main">
        <section className="nx-overview-section">
          <div className="nx-section-heading">
            <h2>Across the workspace</h2>
            <span className="nx-eyebrow">
              {Object.keys(state.projectsById)
                .length.toString()
                .padStart(2, "0")}{" "}
              PROJECTS /{" "}
              {Object.keys(state.usersById).length.toString().padStart(2, "0")}{" "}
              PEOPLE
            </span>
          </div>
          <div className="nx-project-ledger">
            {Object.values(state.projectsById).map((p) => {
              const work = top.filter((i) => i.projectId === p.id);
              const sprint = Object.values(state.sprintsById).find(
                (s) =>
                  s.projectId === p.id && s.status === "ACTIVE" && !s.deletedAt
              );
              const planned = sprint
                ? work.filter((i) => i.sprintId === sprint.id)
                : work;
              const done = planned.filter((i) => i.status === "DONE").length;
              return (
                <button
                  key={p.id}
                  className="nx-ledger-project"
                  onClick={() => navigate("board", p.id)}
                >
                  <span className={`nx-project-mark nx-project-${p.keyPrefix}`}>
                    {p.keyPrefix}
                  </span>
                  <div>
                    <h3>
                      {p.name}
                      <FiArrowUpRight />
                    </h3>
                    <p>{sprint?.goal ?? p.goal}</p>
                    <div
                      className="nx-project-progress"
                      aria-label={`${done} of ${planned.length} ${
                        sprint ? "sprint" : "project"
                      } issues done`}
                    >
                      {planned.map((i) => (
                        <span
                          className={`nx-segment nx-segment-${i.status}`}
                          key={i.id}
                        />
                      ))}
                    </div>
                    <footer>
                      <span>
                        {sprint?.name ?? "Continuous planning"}
                        {sprint?.endsAt
                          ? ` · ends ${dateLabel(sprint.endsAt)}`
                          : ""}
                      </span>
                      <span>
                        {done} / {planned.length} done
                      </span>
                    </footer>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <section className="nx-overview-section">
          <div className="nx-section-heading">
            <h2>
              <FiAlertCircle />
              Needs a clear path <span>{blocked.length}</span>
            </h2>
            <span className="nx-section-caption">Blockers across projects</span>
          </div>
          {blocked.map((i) => (
            <button
              className="nx-attention-row"
              key={i.id}
              data-open-issue={i.id}
              onClick={() => openIssue(i)}
            >
              <span className="nx-key">{i.key}</span>
              <div>
                <strong>{i.title}</strong>
                <p>{i.blocker.blocked ? i.blocker.reason : ""}</p>
              </div>
              <Person user={state.usersById[i.assigneeId ?? ""]} />
              <FiArrowUpRight />
            </button>
          ))}
          {!blocked.length && (
            <p className="nx-muted nx-small">No blockers. The path is clear.</p>
          )}
        </section>
        <section className="nx-overview-section">
          <div className="nx-section-heading">
            <h2>
              <FiGitPullRequest />
              Ready for another pair of eyes <span>{reviews.length}</span>
            </h2>
          </div>
          {reviews.map((i) => (
            <button
              className="nx-review-row"
              key={i.id}
              data-open-issue={i.id}
              onClick={() => openIssue(i)}
            >
              <Status status={i.status} label={false} />
              <span className="nx-key">{i.key}</span>
              <span>{i.title}</span>
              <Person user={state.usersById[i.assigneeId ?? ""]} />
              <FiArrowRight />
            </button>
          ))}
        </section>
      </div>
      <aside className="nx-overview-aside">
        <section>
          <div className="nx-section-heading">
            <h2>The team’s focus</h2>
            <span className="nx-section-caption">Open work</span>
          </div>
          {Object.values(state.usersById).map((u) => {
            const assigned = issues.filter(
              (i) => i.assigneeId === u.id && i.status !== "DONE"
            );
            return (
              <div className="nx-workload" key={u.id}>
                <Person user={u} name />
                <span>{assigned.length}</span>
                <div className="nx-load-track">
                  <span
                    style={{
                      width: `${Math.min(
                        100,
                        (assigned.length /
                          Math.max(
                            1,
                            ...Object.values(state.usersById).map(
                              (person) =>
                                issues.filter(
                                  (i) =>
                                    i.assigneeId === person.id &&
                                    i.status !== "DONE"
                                ).length
                            )
                          )) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
          <p className="nx-workload-note">
            Assigned issues, including child work.
            <br />A view of focus, not a measure of capacity.
          </p>
        </section>
        <section className="nx-overview-activity">
          <div className="nx-section-heading">
            <h2>Recent movement</h2>
            <span className="nx-live-dot" />
          </div>
          {events.map((e) => (
            <Activity key={e.id} event={e} />
          ))}
        </section>
      </aside>
    </div>
  );
}
