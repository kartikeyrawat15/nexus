# NEXUS

### A local-first engineering workbench for planning, tracking, and shipping product work.

NEXUS is a polished project-management workbench designed around the workflows of modern software teams.

It brings project planning, sprint management, issue tracking, backlog organization, blockers, activity, and team context into a fast, cohesive interface — while running entirely in the browser with no backend services or account setup required.

The project focuses on two things equally:

**engineering correctness** and **product-quality interaction design**.

---
[# NEXUS

A local-first engineering workbench for planning, tracking, and shipping product work.

### [→ Try the Live Demo]((https://nexus-five-mu-33.vercel.app/project/overview))

No account, database, or setup required — the demo runs entirely in your browser.
## Overview

NEXUS provides a complete demo workspace for exploring realistic software-development workflows.

The application ships with a deterministic demo organization containing multiple projects, team members, sprints, issues, comments, blockers, priorities, child work, and activity history.

Everything is immediately usable after launching the application.

No authentication, database provisioning, API keys, or external services are required.](https://nexus-five-mu-33.vercel.app/project/overview)

---

## Features

### Engineering Overview

A project command center that surfaces the information that matters most:

- Active sprint progress
- Work requiring attention
- Blocked issues
- Priority distribution
- Review workload
- Recent project activity
- Team context

All information is derived from the application's actual domain state rather than static dashboard data.

### Board

A responsive workflow board designed for day-to-day execution.

- Drag-and-drop issue movement
- Stable ordering across workflow columns
- Filter-aware movement
- Priority indicators
- Blocker visibility
- Child-work context
- Assignee filtering
- Sprint filtering
- Responsive desktop, tablet, and mobile behavior

On smaller screens, the board transitions from a multi-column workspace to focused status navigation rather than simply shrinking the desktop layout.

### Backlog & Sprint Planning

A dense planning ledger for organizing upcoming work.

- Reorder issues
- Move work between backlog and sprints
- Create and edit sprints
- Start sprints
- Complete sprints
- Carry unfinished work forward
- Preserve parent/child issue relationships
- Expand issue families
- Inline issue creation
- Priority and blocker context

Sprint completion is handled atomically so related work remains internally consistent.

### Issue Inspector

Issues open inside a shared workspace inspector without forcing navigation away from the current context.

Manage:

- Title
- Description
- Status
- Priority
- Assignee
- Issue type
- Epic relationships
- Blockers
- Child issues
- Comments

Rich-text descriptions and comments persist locally and survive page refreshes.

### Command Palette

NEXUS includes keyboard-driven navigation and search.

Press:

```text
Ctrl + K
```

to quickly navigate the workspace, find issues, inspect teammate workloads, and execute common navigation actions.

### Undo & Recovery

Destructive actions are designed to be recoverable.

Issue deletion supports targeted Undo without rolling back unrelated changes made afterward.

NEXUS also includes deterministic demo reset and automatic recovery from invalid persisted state.

---

## Local-First Architecture

NEXUS deliberately avoids requiring a backend for its portfolio/demo environment.

```text
Domain Model
     ↓
BrowserRepository
     ↓
Browser Persistence
     ↓
React Query
     ↓
React Interface
```

Business operations are expressed through an application-owned repository boundary rather than being coupled directly to UI components or HTTP endpoints.

This allows the same domain behavior to remain independent of the persistence mechanism.

### BrowserRepository

The browser repository provides the application's command and query boundary for operations including:

- Issue lifecycle
- Issue ordering
- Sprint lifecycle
- Comments
- Project data
- Activity
- Persistence
- Recovery

The current implementation persists the workspace locally in the browser.

This means NEXUS can be cloned and launched without provisioning infrastructure.

---

## Demo Workspace

NEXUS initializes with a deterministic **Wayline** engineering workspace containing realistic product-development data.

The seed includes:

- 3 projects
- 6 team members
- 48 issues
- 5 sprints
- 30 comments
- 52 activity events

The dataset includes priorities, blockers, child work, sprint assignments, issue relationships, and historical activity so the interface can be explored immediately.

The demo can be reset back to its original state at any time.

---

## Persistence

Changes are automatically persisted in the browser.

You can:

1. Create or modify work
2. Refresh the page
3. Return to the same workspace state

NEXUS also synchronizes repository changes between compatible browser tabs and can recover gracefully if stored demo data becomes invalid.

No remote account is required.

---

## Interaction Design

NEXUS was designed around a **quiet engineering-workbench** philosophy.

The interface prioritizes:

- Strong information hierarchy
- High information density without visual clutter
- Restrained semantic color
- Clear typography
- Context-preserving interactions
- Purposeful motion
- Responsive composition
- Fast keyboard navigation

Motion is used primarily to communicate state and spatial relationships rather than as decoration.

---

## Tech Stack

- **Next.js**
- **React**
- **TypeScript**
- **Tailwind CSS**
- **React Query**
- **Radix UI**
- **Lexical**
- **react-beautiful-dnd**
- **Vitest**

Persistence and application behavior are implemented locally through the NEXUS domain and repository layers.

---

## Getting Started

### Requirements

- Node.js
- npm

### Installation

Clone the repository:

```bash
git clone https://github.com/kartikeyrawat15/nexus.git
cd nexus
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local address printed by Next.js in your browser.

That's it.

There is no database to configure and no `.env` file or third-party credentials are required for the application.

---

## Validation

NEXUS includes automated coverage for its domain, repository, persistence, and integration behavior.

At the current release checkpoint:

```text
Test files:     10 passed
Tests:          168 passed
TypeScript:     passed
Production build: passed
```

The application has also been browser-tested across its primary workflows, including:

- Issue creation and editing
- Rich-text persistence
- Comments
- Drag-and-drop movement
- Filtered movement
- Backlog organization
- Sprint lifecycle
- Targeted Undo
- Project navigation
- Command palette
- Persistence
- Demo reset and recovery
- Responsive mobile workflows

---

## Project Structure

```text
app/                  Next.js application routes
components/
  workbench/          NEXUS workspace interface
context/              Repository and application contexts
demo/                 Deterministic demo workspace
domain/               Application domain model and rules
integration/          Integration behavior
persistence/          Browser persistence
repositories/         Repository contracts and implementations
tests/                Automated test suite
```

The application is structured so that domain behavior and persistence remain separate from the presentation layer.

---

## Why NEXUS?

Project-management software looks straightforward until interactions begin affecting one another.

Moving an issue can change ordering. Completing a sprint can affect multiple issue families. Undo must reverse one operation without destroying unrelated changes. Filtered drag-and-drop must preserve the ordering of work that isn't currently visible. Persisted state must remain valid across refreshes and application versions.

NEXUS explores those problems as an engineering system rather than treating the project as a collection of UI screens.

The goal is a workbench that feels simple to operate while maintaining explicit rules underneath.

---

## Author

**Kartikeyan Singh Rawat**

Computer Engineering — Deep Learning & AI  
Graphic Era (Deemed to be University)

GitHub: [kartikeyrawat15](https://github.com/kartikeyrawat15)

---

## Acknowledgements

NEXUS began as a substantial re-engineering and product-design evolution of the open-source `jira_clone` project by Sebastian Fernandez.

The original project provided the initial application foundation. NEXUS substantially changes the architecture, runtime model, data layer, workflows, interaction design, demo environment, testing strategy, and user experience.

The original project's license and attribution are preserved in accordance with its MIT License.

See [`LICENSE`](./LICENSE) for licensing information.

---

## License

This project includes software originally distributed under the MIT License.

See [`LICENSE`](./LICENSE) for the complete license and copyright notice.
