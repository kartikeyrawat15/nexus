import { type IssueKind, type IssueStatus, type Priority, type RichTextDocument } from "../domain/types";

export const WAYLINE = {
  workspaceId: "wayline", visitorId: "maya", featuredProjectId: "live-tracking",
  name: "Wayline Product Engineering",
  labels: [
    { id: "reliability", name: "Reliability", colorToken: "label-reliability" },
    { id: "accessibility", name: "Accessibility", colorToken: "label-accessibility" },
    { id: "carrier-data", name: "Carrier data", colorToken: "label-carrier-data" },
    { id: "experience", name: "Experience", colorToken: "label-experience" },
  ],
} as const;

function avatar(initials: string, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${fill}"/><text x="32" y="39" text-anchor="middle" font-family="sans-serif" font-size="21" fill="#202923">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Inline SVG assets keep this foundation self-contained within the authorized files.
export const USERS = [
  { id: "maya", name: "Maya Chen", roleLabel: "Product engineer", avatarPath: avatar("MC", "#D7E8E0") },
  { id: "nina", name: "Nina Patel", roleLabel: "Frontend engineer", avatarPath: avatar("NP", "#E2E5F0") },
  { id: "omar", name: "Omar Haddad", roleLabel: "Backend engineer", avatarPath: avatar("OH", "#EADFCC") },
  { id: "elena", name: "Elena Rossi", roleLabel: "Infrastructure engineer", avatarPath: avatar("ER", "#D6E5EC") },
  { id: "theo", name: "Theo Brooks", roleLabel: "Product designer", avatarPath: avatar("TB", "#E8DDE7") },
  { id: "sam", name: "Sam Rivera", roleLabel: "QA engineer", avatarPath: avatar("SR", "#E5E7D1") },
];

export const PROJECTS = [
  { id: "live-tracking", slug: "live-tracking", keyPrefix: "LT", name: "Live tracking",
    goal: "Make shipment locations trustworthy and explain delays without losing context.", ownerId: "nina", memberIds: ["maya", "nina", "omar", "theo", "sam"] },
  { id: "carrier-api", slug: "carrier-api", keyPrefix: "API", name: "Carrier API",
    goal: "Normalize partner events and make ingestion predictable under retries.", ownerId: "omar", memberIds: ["maya", "omar", "elena", "sam"] },
  { id: "operations-console", slug: "operations-console", keyPrefix: "OPS", name: "Operations console",
    goal: "Help operators investigate exceptions without losing their working context.", ownerId: "theo", memberIds: ["maya", "nina", "theo", "sam"] },
];

export const SPRINTS = [
  { id: "lt-sprint-12", projectId: "live-tracking", name: "Sprint 12", goal: "Trust the tracking feed",
    status: "ACTIVE", startDays: -5, endDays: 9, completedDays: null },
  { id: "lt-sprint-13", projectId: "live-tracking", name: "Sprint 13", goal: "Make shipment changes easier to understand",
    status: "PENDING", startDays: 9, endDays: 23, completedDays: null },
  { id: "api-sprint-7", projectId: "carrier-api", name: "Sprint 7", goal: "Make carrier ingestion safe to retry",
    status: "ACTIVE", startDays: -4, endDays: 10, completedDays: null },
  { id: "api-sprint-8", projectId: "carrier-api", name: "Sprint 8", goal: "Explain integration failures at their source",
    status: "PENDING", startDays: 10, endDays: 24, completedDays: null },
  { id: "ops-sprint-3", projectId: "operations-console", name: "Sprint 3", goal: "Make investigation history dependable",
    status: "CLOSED", startDays: -28, endDays: -14, completedDays: -14 },
] as const;

export function documentFromParagraphs(...paragraphs: string[]): RichTextDocument {
  return { format: "nexus-rich-text", version: 1, root: { type: "root", children: paragraphs.map((text) => ({
    type: "paragraph", children: [{ type: "text", text, marks: [] }],
  })) } };
}

interface IssueSeed {
  id: string; projectId: string; number: number; status: IssueStatus; title: string;
  description: RichTextDocument; kind: IssueKind; priority: Priority; assigneeId: string;
  sprintId: string | null; parentId: string | null; labelIds: string[]; blockedReason: string | null;
}
function work(projectId: string, number: number, status: IssueStatus, title: string, context: string, acceptance: string,
  options: Partial<Pick<IssueSeed, "kind" | "priority" | "assigneeId" | "sprintId" | "parentId" | "labelIds" | "blockedReason">> = {},
): IssueSeed {
  return { id: `${projectId}-${number}`, projectId, number, status, title,
    description: documentFromParagraphs(context, `Acceptance criteria: ${acceptance}`),
    kind: "TASK", priority: "NORMAL", assigneeId: "maya", sprintId: null, parentId: null,
    labelIds: ["experience"], blockedReason: null, ...options,
  };
}
const lt = (number: number, status: IssueStatus, title: string, context: string, acceptance: string, options: Parameters<typeof work>[6] = {}) =>
  work("live-tracking", number, status, title, context, acceptance, { sprintId: "lt-sprint-12", assigneeId: "nina", ...options });
const api = (number: number, status: IssueStatus, title: string, context: string, acceptance: string, options: Parameters<typeof work>[6] = {}) =>
  work("carrier-api", number, status, title, context, acceptance, { sprintId: "api-sprint-7", assigneeId: "omar", labelIds: ["carrier-data"], ...options });
const ops = (number: number, status: IssueStatus, title: string, context: string, acceptance: string, options: Parameters<typeof work>[6] = {}) =>
  work("operations-console", number, status, title, context, acceptance, { assigneeId: "theo", ...options });

export const ISSUES: IssueSeed[] = [
  lt(118, "IN_REVIEW", "Preserve selected shipment when live updates reorder table", "Operators lose the detail selection when a fresh position changes the shipment sort order.", "Selection follows shipment ID, including when its row leaves the visible viewport.", { kind: "BUG", priority: "HIGH", assigneeId: "maya" }),
  lt(119, "DONE", "Expose received-at time alongside carrier location time", "Delayed ingestion makes a recent-looking location misleading.", "Both timestamps remain distinguishable in the timeline and use the shipment timezone.", { assigneeId: "omar", labelIds: ["carrier-data"] }),
  lt(120, "IN_PROGRESS", "Reconnect the tracking stream without duplicating timeline entries", "A reconnect currently repeats the last batch of positions.", "Replayed positions merge by event ID and the stream reconnects without clearing selection.", { kind: "BUG", labelIds: ["reliability"] }),
  lt(121, "IN_PROGRESS", "Ignore duplicate carrier events without dropping newer locations", "The duplicate guard can discard a newer location when a carrier reuses a delivery token.", "Deduplication uses carrier event identity and preserves a later location in the same batch.", { kind: "BUG", priority: "HIGH", assigneeId: "omar", labelIds: ["reliability"], blockedReason: "Waiting for Northstar's event-identity contract and a replay sample." }),
  lt(122, "DONE", "Keep map labels legible at dense delivery clusters", "Overlapping labels hide the selected shipment at distribution hubs.", "Selected labels stay visible and cluster expansion retains keyboard focus.", { assigneeId: "theo" }),
  lt(123, "IN_REVIEW", "Offer a retry after tracking-stream interruption", "An interrupted stream leaves stale rows without an explanation.", "A retry reconnects once, keeps the current shipment selected and announces recovery.", { assigneeId: "nina", labelIds: ["reliability"] }),
  lt(124, "TODO", "Explain stale locations without implying shipment stopped", "A missing carrier update is different from a vehicle that has stopped moving.", "The notice names the last update time without making a movement claim.", { assigneeId: "theo", blockedReason: "Carrier operations must approve the stale-location wording." }),
  lt(125, "DONE", "Use the latest trusted location when estimating arrival", "Late out-of-order positions can move an arrival estimate backwards.", "Only a newer trusted carrier timestamp advances the estimate.", { priority: "HIGH", assigneeId: "omar", labelIds: ["carrier-data"] }),
  lt(126, "IN_PROGRESS", "Keep tracking timeline usable at 200% zoom", "Timeline timestamps and controls overlap when browser text is enlarged.", "At 200% zoom every event and action is readable without two-axis scrolling.", { assigneeId: "nina", labelIds: ["accessibility"] }),
  lt(127, "IN_PROGRESS", "Retain location context while switching shipment tabs", "Switching between overview and timeline resets the map to the depot.", "Returning to the map restores the selected position and zoom.", { assigneeId: "maya" }),
  lt(128, "TODO", "Clarify tracking freshness in the compact shipment row", "The compact row uses an unlabeled dot to communicate freshness.", "Freshness includes readable text and does not depend on color.", { priority: "LOW", assigneeId: "theo", labelIds: ["accessibility"] }),
  lt(129, "DONE", "Avoid showing a zero-coordinate shipment in the ocean", "Some carriers omit coordinates by reporting zero values.", "Missing coordinates render a named unavailable state without a map marker.", { kind: "BUG", assigneeId: "sam", labelIds: ["carrier-data"] }),
  lt(130, "TODO", "Compare promised and updated arrival windows", "Dispatchers need to understand which arrival promise changed.", "The detail shows the original and latest window with the change source.", { sprintId: "lt-sprint-13", kind: "STORY" }),
  lt(131, "TODO", "Make carrier handoff visible in shipment history", "A carrier handoff currently looks like an unexplained route jump.", "The timeline names both carriers and keeps the handoff in timestamp order.", { sprintId: "lt-sprint-13", assigneeId: "omar", labelIds: ["carrier-data"] }),
  lt(132, "TODO", "Restore the last tracking filter after opening a shipment", "Returning from shipment detail loses the dispatcher's active region.", "Region and freshness filters survive detail navigation and browser Back.", { sprintId: "lt-sprint-13", assigneeId: "maya" }),
  lt(133, "TODO", "Name tracking controls for screen-reader navigation", "Icon-only map controls have inconsistent accessible names.", "Every map action has a specific name and focus remains visible.", { sprintId: "lt-sprint-13", assigneeId: "sam", labelIds: ["accessibility"] }),
  lt(134, "TODO", "Distinguish planned stops from confirmed carrier arrivals", "Planned waypoints can be mistaken for observed arrivals.", "Planned stops are labeled and never receive a confirmed-arrival timestamp.", { sprintId: "lt-sprint-13", assigneeId: "theo" }),
  lt(135, "TODO", "Keep shipment identifiers copyable on narrow screens", "Truncated references are hard to transfer into an investigation.", "Copy preserves the complete reference and confirms the result accessibly.", { sprintId: "lt-sprint-13", assigneeId: "nina" }),
  lt(136, "TODO", "Group overnight tracking gaps into one readable notice", "A long carrier outage floods the timeline with repeated gap notices.", "Contiguous gaps collapse into a single interval without hiding recovered events.", { sprintId: null, labelIds: ["reliability"] }),
  lt(137, "TODO", "Show the shipment timezone before exporting history", "Exports are interpreted incorrectly when recipients assume their own timezone.", "The export action states the timezone and exported timestamps include offsets.", { sprintId: null, assigneeId: "omar" }),
  lt(138, "TODO", "Preserve the focused row when the shipment list refreshes", "Keyboard users lose their place after a background list refresh.", "Focus stays on the same shipment or moves to a named nearby row if it disappears.", { sprintId: null, assigneeId: "nina", labelIds: ["accessibility"] }),
  lt(139, "TODO", "Explain location accuracy when a carrier sends an estimate", "An estimated carrier position looks identical to a precise GPS fix.", "Estimated positions have a plain-language accuracy note in map and timeline.", { sprintId: null, assigneeId: "theo", labelIds: ["carrier-data"] }),
  api(42, "IN_PROGRESS", "Make webhook retries idempotent across worker restarts", "Restarting a worker loses the in-flight receipt and can ingest a webhook twice.", "A repeated receipt returns the original result across restarts without duplicate shipment events.", { priority: "URGENT", labelIds: ["reliability"] }),
  api(43, "DONE", "Reject carrier payloads that exceed the documented envelope size", "An oversized payload can occupy the ingestion queue indefinitely.", "Oversized requests fail before enqueue with a stable field-level error.", { assigneeId: "elena" }),
  api(44, "IN_PROGRESS", "Record carrier clock skew without rewriting source timestamps", "Clock correction currently obscures the timestamp received from the partner.", "Store source and normalized timestamps separately and record the applied skew.", { assigneeId: "elena" }),
  api(45, "TODO", "Bound retry backoff for temporarily unavailable carriers", "Unbounded retries can keep a shipment update stuck for hours.", "Retries stop at the configured horizon and expose the final failure reason.", { labelIds: ["reliability"] }),
  api(46, "IN_REVIEW", "Trace rejected carrier events with the original receipt ID", "Investigation logs cannot reliably connect a rejection to its webhook receipt.", "Receipt ID is present in validation, queue and rejection records.", { assigneeId: "maya" }),
  api(47, "IN_REVIEW", "Return field-level errors for malformed carrier timestamps", "A generic bad-request response leaves partners guessing which timestamp failed.", "Each invalid field has a stable path and error code without exposing internal stack traces.", { priority: "HIGH", assigneeId: "omar" }),
  api(48, "TODO", "Document cursor behavior when a carrier replay crosses midnight", "Replay cursors are ambiguous at a day boundary.", "Examples show inclusive boundaries and avoid dropping an event at midnight.", { sprintId: "api-sprint-8", assigneeId: "maya" }),
  api(49, "TODO", "Verify partner signatures before parsing webhook bodies", "Signature validation must use the original request bytes.", "Signed payloads validate before parsing and modified bytes are rejected.", { sprintId: "api-sprint-8", assigneeId: "elena", priority: "HIGH", labelIds: ["reliability"] }),
  api(50, "TODO", "Make the sandbox replay report match production validation", "The integration sandbox accepts fields production rejects.", "Sandbox and production use the same validation result codes and field paths.", { sprintId: null, assigneeId: "sam" }),
  ops(31, "TODO", "Preserve investigation filters when returning from a shipment", "Opening a shipment discards the operator's exception filters.", "Back restores severity, carrier and date range without a second search.", { assigneeId: "maya", kind: "BUG" }),
  ops(32, "IN_PROGRESS", "Show the evidence behind an exception classification", "Operators cannot tell whether a classification came from carrier data or a rule.", "The detail names its source rule and links to the relevant event.", { assigneeId: "nina", kind: "STORY" }),
  ops(33, "TODO", "Keep investigation notes separate from carrier-provided messages", "Carrier text looks like an internal operator note.", "Message source is labeled and notes retain author and creation time.", { assigneeId: "theo" }),
  ops(34, "IN_REVIEW", "Confirm the selected shipment before resolving an exception", "Resolving from a stale selection can target the wrong shipment.", "The confirmation names the shipment and verifies the current exception version.", { assigneeId: "sam", priority: "HIGH" }),
  ops(35, "DONE", "Announce exception-count changes without interrupting screen readers", "Frequent count updates interrupt the operator's current reading.", "Counts use a polite live region and batch rapid updates into one announcement.", { assigneeId: "nina", labelIds: ["accessibility"] }),
  ops(36, "DONE", "Retain investigation author names after an operator is deactivated", "Historical notes lose their attribution when a user leaves the team.", "Existing notes retain the recorded author label without granting access.", { sprintId: "ops-sprint-3", assigneeId: "maya" }),
  ops(37, "DONE", "Order exception history by occurrence time and stable event ID", "Events with identical times can change order between reloads.", "A stable event-ID tie-breaker preserves the same history order.", { sprintId: "ops-sprint-3", assigneeId: "sam", labelIds: ["reliability"] }),
  lt(140, "DONE", "Cover shipment selection during a live sort change", "Exercise the selection regression under a replayed tracking feed.", "The regression test changes row order and asserts selection by shipment ID.", { parentId: "live-tracking-118", assigneeId: "sam" }),
  lt(141, "IN_PROGRESS", "Capture a duplicate delivery-token replay sample", "Northstar needs a small sample demonstrating the reused token.", "The sample includes both source event identities and their location timestamps.", { parentId: "live-tracking-121", assigneeId: "omar", labelIds: ["carrier-data"] }),
  lt(142, "TODO", "Review stale-location wording with carrier operations", "Confirm the notice does not promise a stationary vehicle.", "Carrier operations approve wording for delayed and missing updates.", { parentId: "live-tracking-124", assigneeId: "theo" }),
  lt(143, "IN_REVIEW", "Check timeline focus order at enlarged text sizes", "The zoom fix must preserve logical keyboard navigation.", "Tab order follows event content at 200% and 400% text enlargement.", { parentId: "live-tracking-126", assigneeId: "sam", labelIds: ["accessibility"] }),
  lt(144, "TODO", "Restore map bounds from shipment detail state", "Map bounds need to follow the selected shipment instead of the tab mount.", "Switching tabs restores bounds without re-centering on the depot.", { parentId: "live-tracking-127", assigneeId: "nina" }),
  api(51, "IN_PROGRESS", "Exercise webhook receipt replay after a worker crash", "Reproduce a crash between queue acknowledgement and response.", "Replaying the receipt produces one event and the same response body.", { parentId: "carrier-api-42", assigneeId: "sam", labelIds: ["reliability"] }),
  api(52, "DONE", "Publish examples of invalid timestamp field paths", "Partners need concrete examples of validation paths.", "Examples cover nested arrays and missing timezone offsets.", { parentId: "carrier-api-47", assigneeId: "maya" }),
  api(53, "TODO", "Test signature verification with preserved request bytes", "Whitespace changes must not be hidden by JSON reserialization.", "The test accepts original bytes and rejects a byte-modified payload.", { parentId: "carrier-api-49", sprintId: "api-sprint-8", assigneeId: "sam", labelIds: ["reliability"] }),
  ops(38, "TODO", "Encode the investigation date range in navigation state", "Date filters need a stable representation across detail navigation.", "The same range is restored through Back and Forward.", { parentId: "operations-console-31", assigneeId: "nina" }),
  ops(39, "DONE", "Verify exception-count announcements with a screen reader", "Confirm the live region does not interrupt focused controls.", "Rapid count updates produce one polite announcement.", { parentId: "operations-console-35", assigneeId: "sam", labelIds: ["accessibility"] }),
];

export const COMMENTS = [
  ["live-tracking-118", "sam", "The replay reproduces this when two shipments swap ETA order. Selection by ID survives the swap.", -72],
  ["live-tracking-118", "nina", "Please also cover the selected row leaving the viewport; the panel should remain open.", -48],
  ["live-tracking-118", "maya", "Added that regression and kept focus on the selected shipment action.", -20],
  ["live-tracking-121", "omar", "Northstar reuses a delivery token for a later location. We need event identity rather than receipt identity here.", -70],
  ["live-tracking-121", "sam", "The sample shows the second update is newer by eleven minutes, so dropping both would hide movement.", -40],
  ["live-tracking-121", "maya", "Carrier operations is requesting the identity contract. Keep this blocked until the replay sample arrives.", -18],
  ["live-tracking-124", "theo", "Proposed wording: last location received 24 minutes ago. It deliberately avoids saying the vehicle stopped.", -66],
  ["live-tracking-124", "maya", "That distinction is right. We still need carrier operations to approve the wording.", -24],
  ["live-tracking-126", "nina", "The timestamp column now wraps instead of covering the event controls.", -60],
  ["live-tracking-126", "sam", "At 200% the layout is readable. Checking focus order at 400% as well.", -16],
  ["live-tracking-123", "sam", "Retry now makes one reconnect attempt and preserves the selected shipment.", -54],
  ["live-tracking-123", "nina", "The recovered state also announces that live tracking resumed.", -14],
  ["live-tracking-120", "omar", "Replay events keep their original IDs, so the client can merge them without guessing from coordinates.", -52],
  ["live-tracking-127", "theo", "Keep the user's zoom level when switching tabs; automatic recentering feels like losing my place.", -50],
  ["live-tracking-129", "sam", "Verified that a zero-coordinate event no longer creates an ocean marker.", -46],
  ["carrier-api-42", "elena", "The receipt record must be durable before queue acknowledgement, otherwise restart still loses the guard.", -68],
  ["carrier-api-42", "omar", "Using the receipt ID as the idempotency key across worker attempts.", -44],
  ["carrier-api-42", "sam", "Crash replay currently passes before response delivery. Adding the acknowledgement boundary case.", -12],
  ["carrier-api-47", "maya", "Partners can now distinguish an invalid offset from a missing timestamp by field path.", -64],
  ["carrier-api-47", "sam", "Nested event arrays report the correct index; no internal exception text is exposed.", -22],
  ["carrier-api-46", "elena", "The receipt ID is present in both rejection logs and queue traces.", -42],
  ["carrier-api-44", "omar", "Preserving the source timestamp should make the skew correction auditable.", -38],
  ["carrier-api-49", "elena", "Verification needs the raw request bytes, before the JSON parser changes whitespace.", -36],
  ["carrier-api-50", "sam", "I collected three payloads accepted by sandbox but rejected by production for the shared validator tests.", -34],
  ["operations-console-31", "maya", "Opening shipment detail should preserve all three filters, including the date range.", -62],
  ["operations-console-31", "nina", "Encoding the range in navigation state will also make browser Back predictable.", -26],
  ["operations-console-35", "sam", "Rapid count updates are now batched into one polite announcement without interrupting the current control.", -58],
  ["operations-console-35", "nina", "Checked the region with the exception list focused; the update no longer steals attention.", -10],
  ["operations-console-34", "sam", "The confirmation includes the shipment reference and checks the latest exception version.", -32],
  ["operations-console-32", "theo", "Showing the rule and source event together gives operators the evidence they need.", -8],
] as const;

/** A bounded history window: these issues have creation and transition events. */
export const HISTORY_ISSUE_IDS = ["live-tracking-118", "live-tracking-121", "live-tracking-124", "live-tracking-126",
  "carrier-api-42", "carrier-api-47", "operations-console-31", "operations-console-35"];
