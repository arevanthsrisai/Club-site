/**
 * Shared workflow status helpers.
 *
 * Single source of truth for determining whether a Registration, Attendance,
 * or Feedback workflow is offline/stopped, live/open, or not-yet-started.
 * Used by /admin/forms and /admin/events/lifecycle so both routes share
 * identical action rules and status labels.
 *
 * Status determination is based on the server-authoritative event document
 * fields, never on stale client UI state.
 */

export type WorkflowType = "registration" | "attendance" | "feedback";

export type WorkflowStatus =
  | "not-started"   // workflow has never been opened
  | "live"          // workflow is open / active
  | "stopped";      // workflow was opened then closed

export interface WorkflowState {
  status: WorkflowStatus;
  label: string;
  activeLabel: string;
  canRestart: boolean;   // restart shown when stopped/not-started
  canStop: boolean;      // stop shown when live
  canStart: boolean;     // start shown when not-started
}

/** Determine the authoritative state of a workflow from the persisted event doc. */
export function workflowState(event: { registrationStatus?: string; attendanceStatus?: string; feedbackStatus?: string; isFeedbackOpen?: boolean } | null, workflow: WorkflowType): WorkflowState {
  const stoppedState: WorkflowState = {
    status: "stopped",
    label: "Stopped",
    activeLabel: "Stopped",
    canRestart: true,
    canStop: false,
    canStart: false,
  };
  const liveState: WorkflowState = {
    status: "live",
    label: "Live",
    activeLabel: "Live",
    canRestart: false,
    canStop: true,
    canStart: false,
  };
  const notStartedState: WorkflowState = {
    status: "not-started",
    label: "Not started",
    activeLabel: "Not started",
    canRestart: true,
    canStop: false,
    canStart: true,
  };

  if (!event) return notStartedState;

  if (workflow === "registration") {
    const regStatus = event.registrationStatus ?? "upcoming";
    if (regStatus === "open") return liveState;
    if (regStatus === "closed") return stoppedState;
    return notStartedState; // "upcoming"
  }

  if (workflow === "attendance") {
    const attStatus = event.attendanceStatus ?? "upcoming";
    if (attStatus === "active") return liveState;
    if (attStatus === "ended") return stoppedState;
    return notStartedState; // "upcoming"
  }

  // feedback
  const fbStatus = event.feedbackStatus ?? (event.isFeedbackOpen ? "active" : "upcoming");
  if (fbStatus === "active" || event.isFeedbackOpen === true) return liveState;
  if (fbStatus === "ended") return stoppedState;
  return notStartedState; // "upcoming"
}

/** Action labels per workflow for UI consistency. */
export const WORKFLOW_LABELS: Record<WorkflowType, { label: string; restartLabel: string }> = {
  registration: { label: "Registration", restartLabel: "Reopen registration" },
  attendance: { label: "Attendance", restartLabel: "Start new attendance session" },
  feedback: { label: "Feedback", restartLabel: "Reopen feedback" },
};
