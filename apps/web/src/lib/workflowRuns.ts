import type { OrchestrationThreadActivity } from "@t3tools/contracts";

/**
 * Live view of provider background runs — Claude's dynamic workflows and the
 * subagent/shell tasks that fan out beside them.
 *
 * The provider reports a run as: one `task.started` (identity), a stream of
 * `task.progress` frames naming whichever agent is currently working, optional
 * `task.updated` state patches, and a terminal `task.completed`. Nothing in
 * that stream is a per-agent lifecycle, so agent state here is derived from
 * what the frames do say — which phase is currently producing updates, and how
 * recently each agent was heard from.
 */

/** Progress frames label the active agent as `"<phase>: <agent>"`. */
const AGENT_LABEL_SEPARATOR = ": ";

/**
 * An agent that has not produced a frame this recently, while its run is still
 * going, is shown as idle rather than active. The provider never says an agent
 * finished, so "idle" is the honest reading: it stopped reporting.
 */
const AGENT_IDLE_AFTER_MS = 45_000;

export type WorkflowRunStatus = "running" | "completed" | "failed" | "stopped";

export type WorkflowAgentStatus = "running" | "idle" | "done" | "stopped";

export interface WorkflowAgent {
  readonly key: string;
  readonly label: string;
  readonly phase: string | null;
  readonly status: WorkflowAgentStatus;
  readonly updates: number;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface WorkflowPhase {
  readonly title: string | null;
  readonly agents: ReadonlyArray<WorkflowAgent>;
  readonly done: boolean;
}

export interface WorkflowRun {
  readonly taskId: string;
  /** Dynamic workflows fan out into agents; other background runs do not. */
  readonly isWorkflow: boolean;
  readonly name: string;
  readonly taskType: string | null;
  readonly description: string | null;
  readonly status: WorkflowRunStatus;
  /** Terminal state was inferred locally (session died) rather than reported. */
  readonly reconciled: boolean;
  readonly error: string | null;
  readonly summary: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly phases: ReadonlyArray<WorkflowPhase>;
  readonly agents: ReadonlyArray<WorkflowAgent>;
  readonly activeAgentCount: number;
  readonly totalTokens: number | null;
  readonly toolUses: number | null;
  readonly turnId: string | null;
  /** Activity id the run should be anchored to in the timeline. */
  readonly anchorActivityId: string;
}

interface MutableAgent {
  key: string;
  label: string;
  phase: string | null;
  updates: number;
  startedAt: string;
  updatedAt: string;
}

interface MutableRun {
  taskId: string;
  taskType: string | null;
  workflowName: string | null;
  description: string | null;
  status: WorkflowRunStatus;
  reconciled: boolean;
  error: string | null;
  summary: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  agents: Map<string, MutableAgent>;
  phaseOrder: Array<string | null>;
  totalTokens: number | null;
  toolUses: number | null;
  turnId: string | null;
  anchorActivityId: string;
  anchorCreatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTaskActivity(kind: string): boolean {
  return (
    kind === "task.started" ||
    kind === "task.progress" ||
    kind === "task.updated" ||
    kind === "task.completed"
  );
}

/** Split `"Wiring + panes: fe:ai+chat"` into its phase and agent label. */
export function splitAgentLabel(description: string): {
  phase: string | null;
  label: string;
} {
  const separatorIndex = description.indexOf(AGENT_LABEL_SEPARATOR);
  if (separatorIndex <= 0) {
    return { phase: null, label: description.trim() };
  }
  const phase = description.slice(0, separatorIndex).trim();
  const label = description.slice(separatorIndex + AGENT_LABEL_SEPARATOR.length).trim();
  if (phase.length === 0 || label.length === 0) {
    return { phase: null, label: description.trim() };
  }
  return { phase, label };
}

/**
 * Task ids whose activities a run card already renders, so the flat work log
 * can skip them instead of printing one row per agent frame. Keyed by id
 * rather than by payload because only some frames carry the run's identity —
 * and activities persisted before that plumbing existed carry none.
 */
export function workflowRunTaskIds(runs: ReadonlyArray<WorkflowRun>): ReadonlySet<string> {
  return new Set(runs.map((run) => run.taskId));
}

function maxIso(left: string, right: string): string {
  return right.localeCompare(left) > 0 ? right : left;
}

function taskIdOf(activity: OrchestrationThreadActivity): string | null {
  return asTrimmedString(asRecord(activity.payload)?.taskId);
}

function readRunStatus(value: unknown): WorkflowRunStatus | null {
  switch (value) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    default:
      return null;
  }
}

/**
 * Build the run roster for a thread, newest run last. `now` decides which
 * agents count as idle; callers tick it so a stalled agent stops reading as
 * active without any provider event arriving.
 */
export function deriveWorkflowRuns(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  now: number = Date.now(),
): WorkflowRun[] {
  const runs = new Map<string, MutableRun>();

  for (const activity of activities) {
    if (!isTaskActivity(activity.kind)) continue;
    const taskId = taskIdOf(activity);
    if (!taskId) continue;
    const payload = asRecord(activity.payload) ?? {};

    let run = runs.get(taskId);
    if (!run) {
      run = {
        taskId,
        taskType: null,
        workflowName: null,
        description: null,
        status: "running",
        reconciled: false,
        error: null,
        summary: null,
        startedAt: activity.createdAt,
        updatedAt: activity.createdAt,
        completedAt: null,
        agents: new Map(),
        phaseOrder: [],
        totalTokens: null,
        toolUses: null,
        turnId: activity.turnId ?? null,
        anchorActivityId: activity.id,
        anchorCreatedAt: activity.createdAt,
      };
      runs.set(taskId, run);
    }

    run.updatedAt = maxIso(run.updatedAt, activity.createdAt);
    run.taskType = asTrimmedString(payload.taskType) ?? run.taskType;
    run.workflowName = asTrimmedString(payload.workflowName) ?? run.workflowName;
    run.turnId = run.turnId ?? activity.turnId ?? null;

    const usage = asRecord(payload.usage);
    if (usage) {
      const totalTokens = asFiniteNumber(usage.total_tokens);
      if (totalTokens !== null) {
        run.totalTokens = Math.max(run.totalTokens ?? 0, totalTokens);
      }
      const toolUses = asFiniteNumber(usage.tool_uses);
      if (toolUses !== null) {
        run.toolUses = Math.max(run.toolUses ?? 0, toolUses);
      }
    }

    switch (activity.kind) {
      case "task.started": {
        run.description = asTrimmedString(payload.detail) ?? run.description;
        // The start row is the natural anchor even when a progress frame
        // happened to be recorded first.
        if (activity.createdAt.localeCompare(run.anchorCreatedAt) <= 0) {
          run.anchorActivityId = activity.id;
          run.anchorCreatedAt = activity.createdAt;
        }
        run.startedAt = activity.createdAt;
        break;
      }
      case "task.progress": {
        run.summary = asTrimmedString(payload.summary) ?? run.summary;
        const title = asTrimmedString(payload.title) ?? asTrimmedString(payload.detail);
        if (title) {
          const { phase, label } = splitAgentLabel(title);
          const key = `${phase ?? ""}::${label}`;
          const existing = run.agents.get(key);
          if (existing) {
            existing.updates += 1;
            existing.updatedAt = maxIso(existing.updatedAt, activity.createdAt);
          } else {
            run.agents.set(key, {
              key,
              label,
              phase,
              updates: 1,
              startedAt: activity.createdAt,
              updatedAt: activity.createdAt,
            });
            if (!run.phaseOrder.some((entry) => entry === phase)) {
              run.phaseOrder.push(phase);
            }
          }
        }
        break;
      }
      case "task.updated": {
        run.error = asTrimmedString(payload.error) ?? run.error;
        const status = readRunStatus(payload.status);
        if (status) {
          run.status = status;
          run.completedAt = activity.createdAt;
        }
        break;
      }
      case "task.completed": {
        run.status = readRunStatus(payload.status) ?? "completed";
        run.completedAt = activity.createdAt;
        run.reconciled = payload.reconciled === true;
        run.summary = asTrimmedString(payload.summary) ?? run.summary;
        break;
      }
      default:
        break;
    }
  }

  return Array.from(runs.values())
    .map((run) => finalizeRun(run, now))
    .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function finalizeRun(run: MutableRun, now: number): WorkflowRun {
  const settled = run.status !== "running";
  const latestPhase = run.phaseOrder.at(-1) ?? null;
  const agents = Array.from(run.agents.values()).map((agent) => {
    const updatedAtMs = Date.parse(agent.updatedAt);
    const phaseAdvanced =
      agent.phase !== latestPhase && run.phaseOrder.some((entry) => entry === agent.phase);
    // A run that failed or was cut short never reported its agents finishing,
    // so they are not marked done — only a clean completion earns that.
    const status: WorkflowAgentStatus = settled
      ? run.status === "completed"
        ? "done"
        : "stopped"
      : phaseAdvanced
        ? "done"
        : Number.isFinite(updatedAtMs) && now - updatedAtMs > AGENT_IDLE_AFTER_MS
          ? "idle"
          : "running";
    return {
      key: agent.key,
      label: agent.label,
      phase: agent.phase,
      status,
      updates: agent.updates,
      startedAt: agent.startedAt,
      updatedAt: agent.updatedAt,
    } satisfies WorkflowAgent;
  });

  const phases = run.phaseOrder.map((title) => {
    const phaseAgents = agents.filter((agent) => agent.phase === title);
    return {
      title,
      agents: phaseAgents,
      done: phaseAgents.length > 0 && phaseAgents.every((agent) => agent.status === "done"),
    } satisfies WorkflowPhase;
  });

  const isWorkflow = run.taskType === "local_workflow" || run.workflowName !== null;

  return {
    taskId: run.taskId,
    isWorkflow,
    name: run.workflowName ?? run.description ?? run.taskId,
    taskType: run.taskType,
    description: run.description,
    status: run.status,
    reconciled: run.reconciled,
    error: run.error,
    summary: run.summary,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    phases,
    agents,
    activeAgentCount: agents.filter((agent) => agent.status === "running").length,
    totalTokens: run.totalTokens,
    toolUses: run.toolUses,
    turnId: run.turnId,
    anchorActivityId: run.anchorActivityId,
  };
}

/** Runs rendered as their own card. Plain shell/subagent tasks keep their work-log rows. */
export function deriveWorkflowRunCards(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  now: number = Date.now(),
): WorkflowRun[] {
  return deriveWorkflowRuns(activities, now).filter((run) => run.isWorkflow);
}

export function formatWorkflowTokens(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatWorkflowElapsed(startedAt: string, endedAtOrNow: string | number): string {
  const start = Date.parse(startedAt);
  const end = typeof endedAtOrNow === "number" ? endedAtOrNow : Date.parse(endedAtOrNow);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "0s";
  }
  const totalSeconds = Math.floor((end - start) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
