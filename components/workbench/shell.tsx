"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  FiArrowUpRight,
  FiColumns,
  FiList,
  FiGrid,
  FiSearch,
  FiPlus,
  FiMenu,
  FiHelpCircle,
} from "react-icons/fi";
import { WorkbenchProvider, useWorkbench } from "./data";
import { Person, Modal } from "./primitives";
import { useRepositoryStatus } from "@/context/repository-provider";
import { Inspector } from "./inspector";
import { CreateIssue, CommandMenu } from "./dialogs";

export function WorkbenchShell({ children }: { children: ReactNode }) {
  return (
    <WorkbenchProvider>
      <Shell>{children}</Shell>
    </WorkbenchProvider>
  );
}
function Shell({ children }: { children: ReactNode }) {
  const {
    snapshot,
    projectId,
    navigate,
    setCreate,
    selected,
    repository,
    run,
  } = useWorkbench();
  const { persistence } = useRepositoryStatus();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [reset, setReset] = useState(false);
  const [command, setCommand] = useState(false);
  const project = snapshot.state.projectsById[projectId];
  const view = path.endsWith("overview")
    ? "overview"
    : path.endsWith("backlog")
    ? "backlog"
    : "board";
  return (
    <div className="nx-app">
      <a href="#workspace" className="nx-skip">
        Skip to workspace
      </a>
      <aside className={`nx-sidebar ${menu ? "is-open" : ""}`}>
        <Link
          className="nx-brand"
          href="/project/overview"
          onClick={() => setMenu(false)}
        >
          <span className="nx-mark" aria-hidden="true">
            N
          </span>
          NEXUS<span className="nx-edition">/ 01</span>
        </Link>
        <div className="nx-workspace-label">
          <span className="nx-workspace-avatar">W</span>
          <div>
            Wayline<span>Product engineering</span>
          </div>
        </div>
        <button
          className="nx-search-trigger"
          onClick={() => {
            setCommand(true);
            setMenu(false);
          }}
        >
          <FiSearch />
          Search anything<kbd>⌘ K</kbd>
        </button>
        <nav aria-label="Workspace">
          <Link
            onClick={() => setMenu(false)}
            href={`/project/overview?project=${projectId}`}
            className={`nx-nav ${view === "overview" ? "active" : ""}`}
          >
            <FiGrid />
            Overview
          </Link>
          <div className="nx-nav-label">
            PROJECTS <span>03</span>
          </div>
          {Object.values(snapshot.state.projectsById).map((p) => (
            <button
              key={p.id}
              className={`nx-project ${
                projectId === p.id && view !== "overview" ? "active" : ""
              }`}
              onClick={() => {
                navigate(view === "overview" ? "board" : view, p.id);
                setMenu(false);
              }}
            >
              <span className={`nx-project-mark nx-project-${p.keyPrefix}`}>
                {p.keyPrefix}
              </span>
              {p.name}
              <span className="nx-project-dot" />
            </button>
          ))}
        </nav>
        <div className="nx-sidebar-bottom">
          <div className="nx-note">
            <span className="nx-live-dot" />
            Your own working copy
            <p>
              Explore freely. Changes stay
              <br />
              in this browser.
            </p>
          </div>
          <button className="nx-nav" onClick={() => setHelp(true)}>
            <FiHelpCircle />
            About this workspace
            <FiArrowUpRight />
          </button>
          <div className="nx-identity">
            <Person
              user={
                snapshot.state.usersById[snapshot.state.workspace.visitorId]
              }
              name
            />
            <span>Demo</span>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          aria-label="Close navigation"
          className="nx-nav-scrim"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="nx-main">
        <header className="nx-topline">
          <button
            className="nx-icon nx-mobile-nav"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <FiMenu />
          </button>
          <span>
            WAYLINE <span className="nx-slash">/</span>{" "}
            {view === "overview" ? "WORKSPACE" : project?.name.toUpperCase()}
          </span>
          <div className="nx-topline-right">
            <span
              className={`nx-save-state ${
                persistence?.warning ? "warning" : ""
              }`}
              title={persistence?.warning ?? "Changes are saved on this device"}
            >
              <span className="nx-live-dot" />
              {persistence?.status === "persisted"
                ? "Saved locally"
                : "Memory only"}
            </span>
            <button
              className="nx-icon"
              aria-label="Search workspace"
              onClick={() => setCommand(true)}
            >
              <FiSearch />
            </button>
          </div>
        </header>
        <main
          id="workspace"
          tabIndex={-1}
          className={`nx-workspace ${selected ? "has-inspector" : ""}`}
        >
          <div className="nx-page-header">
            <div>
              <div className="nx-eyebrow">
                {view === "overview"
                  ? "THE WORK, IN FOCUS"
                  : `${project?.keyPrefix ?? ""} / PROJECT WORKSPACE`}
              </div>
              <h1>
                {view === "overview"
                  ? "A clear view of what’s moving."
                  : project?.name}
              </h1>
              <p>
                {view === "overview"
                  ? "Three projects. One team. The signals that deserve your attention."
                  : project?.goal}
              </p>
            </div>
            <button
              className="nx-button primary"
              onClick={() => setCreate({ sprintId: null })}
            >
              <FiPlus />
              Create issue<span className="nx-button-key">+</span>
            </button>
          </div>
          {view !== "overview" && (
            <nav className="nx-view-tabs" aria-label="Project view">
              <Link
                href={`/project/board?project=${projectId}`}
                className={view === "board" ? "active" : ""}
              >
                <FiColumns />
                Board
              </Link>
              <Link
                href={`/project/backlog?project=${projectId}`}
                className={view === "backlog" ? "active" : ""}
              >
                <FiList />
                Backlog
              </Link>
              <span>Built for the work between ideas and delivery.</span>
            </nav>
          )}
          {persistence?.warning && (
            <div className="nx-warning" role="status">
              {persistence.warning}
            </div>
          )}
          {children}
        </main>
      </div>
      <Inspector />
      <CreateIssue />
      <CommandMenu
        open={command}
        setOpen={setCommand}
        onReset={() => setReset(true)}
      />
      {help && (
        <Modal
          title="A workspace worth exploring"
          onClose={() => setHelp(false)}
        >
          <div className="nx-dialog-body">
            <p>
              NEXUS is an engineering workbench. You’re Maya Chen at Wayline,
              working across live tracking, carrier integrations, and
              operations.
            </p>
            <p>
              This is your own browser copy. Create, move, and discuss real
              work. Your changes persist on this device; another visitor won’t
              see them.
            </p>
            <div className="nx-help-keys">
              <span>Search & navigate</span>
              <kbd>Ctrl / ⌘ K</kbd>
              <span>Close a panel</span>
              <kbd>Esc</kbd>
              <span>Pick up a drag handle</span>
              <kbd>Space</kbd>
            </div>
            <button
              className="nx-button"
              onClick={() => {
                setHelp(false);
                setReset(true);
              }}
            >
              Reset Wayline demo
            </button>
            <p className="nx-muted nx-small">
              Built on the open-source Jira Clone foundation.{" "}
              <a
                href="https://github.com/sebastianfdz/jira_clone"
                target="_blank"
                rel="noreferrer"
              >
                Original project ↗
              </a>
            </p>
          </div>
        </Modal>
      )}
      {reset && (
        <Modal
          title="Start with a fresh workspace?"
          onClose={() => setReset(false)}
        >
          <div className="nx-dialog-body">
            <p>
              This resets all three projects, issues, comments, and sprints to
              the Wayline scenario. Your local edits will be replaced. This
              cannot be undone.
            </p>
            <div className="nx-actions">
              <button className="nx-button" onClick={() => setReset(false)}>
                Keep my work
              </button>
              <button
                className="nx-button danger"
                onClick={() => {
                  void run(
                    () => repository.resetDemo(),
                    "Wayline reset to a fresh start"
                  ).then((ok) => {
                    if (ok) {
                      setReset(false);
                      navigate("overview");
                    }
                  });
                }}
              >
                Reset workspace
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
