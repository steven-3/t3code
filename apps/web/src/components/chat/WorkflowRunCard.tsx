import { memo, useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  LoaderIcon,
  NetworkIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import {
  formatWorkflowElapsed,
  formatWorkflowTokens,
  type WorkflowAgent,
  type WorkflowPhase,
  type WorkflowRun,
} from "../../lib/workflowRuns";
import { Badge } from "../ui/badge";

function runStatusBadge(run: WorkflowRun) {
  switch (run.status) {
    case "running":
      return { variant: "info" as const, label: "running" };
    case "completed":
      return { variant: "success" as const, label: "completed" };
    case "failed":
      return { variant: "error" as const, label: "failed" };
    case "stopped":
      return { variant: "warning" as const, label: run.reconciled ? "interrupted" : "stopped" };
  }
}

function AgentStatusIcon({ status }: { status: WorkflowAgent["status"] }) {
  switch (status) {
    case "running":
      return <LoaderIcon className="size-3 shrink-0 animate-spin text-info-foreground" />;
    case "idle":
      return <CircleDashedIcon className="size-3 shrink-0 text-muted-foreground/70" />;
    case "stopped":
      return <CircleSlashIcon className="size-3 shrink-0 text-muted-foreground/70" />;
    case "done":
      return <CheckIcon className="size-3 shrink-0 text-success-foreground" />;
  }
}

/**
 * The right-hand note only appears when it says something: an agent seen in a
 * single frame has no measurable span, and "0s" would read as a result.
 */
function agentTimingNote(agent: WorkflowAgent, now: number): string | null {
  if (agent.status === "idle") {
    return `quiet ${formatWorkflowElapsed(agent.updatedAt, now)}`;
  }
  if (agent.status === "running") {
    return formatWorkflowElapsed(agent.startedAt, now);
  }
  const elapsed = formatWorkflowElapsed(agent.startedAt, agent.updatedAt);
  return elapsed === "0s" ? null : elapsed;
}

function AgentRow({ agent, now }: { agent: WorkflowAgent; now: number }) {
  const timing = agentTimingNote(agent, now);

  return (
    <li className="flex items-center gap-1.5 py-px pl-5 text-[12px] leading-5">
      <AgentStatusIcon status={agent.status} />
      <span
        className={cn(
          "truncate",
          agent.status === "running" ? "text-foreground/85" : "text-muted-foreground/80",
        )}
        title={agent.label}
      >
        {agent.label}
      </span>
      {timing ? (
        <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted-foreground/60">
          {timing}
        </span>
      ) : null}
    </li>
  );
}

function phaseSummary(phase: WorkflowPhase, settled: boolean): string {
  if (settled) {
    return phase.agents.length === 1 ? "1 agent" : `${phase.agents.length} agents`;
  }
  if (phase.done) {
    return `${phase.agents.length} done`;
  }
  const runningCount = phase.agents.filter((agent) => agent.status === "running").length;
  return `${runningCount}/${phase.agents.length} running`;
}

function PhaseSection({
  phase,
  now,
  settled,
}: {
  phase: WorkflowPhase;
  now: number;
  settled: boolean;
}) {
  return (
    <li className="py-0.5">
      <div className="flex items-center gap-1.5 text-[12px] leading-5">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            settled ? "bg-muted-foreground/40" : phase.done ? "bg-success/60" : "bg-info/70",
          )}
        />
        <span className="truncate font-medium text-foreground/80">{phase.title ?? "Agents"}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60">
          {phaseSummary(phase, settled)}
        </span>
      </div>
      <ul className="mt-px">
        {phase.agents.map((agent) => (
          <AgentRow key={agent.key} agent={agent} now={now} />
        ))}
      </ul>
    </li>
  );
}

/**
 * Live view of one background workflow run: which phase is producing agent
 * updates, which agents are active, and how much work the run has consumed.
 *
 * Deliberately not folded away with its turn — a workflow outlives the turn
 * that launched it, so the card stays put while it is still going.
 */
export const WorkflowRunCard = memo(function WorkflowRunCard({
  run,
  now,
  defaultExpanded,
}: {
  run: WorkflowRun;
  now: number;
  defaultExpanded?: boolean;
}) {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const running = run.status === "running";
  const expanded = expandedOverride ?? defaultExpanded ?? running;
  const badge = runStatusBadge(run);
  const tokens = formatWorkflowTokens(run.totalTokens);

  const elapsed = useMemo(
    () => formatWorkflowElapsed(run.startedAt, run.completedAt ?? now),
    [run.startedAt, run.completedAt, now],
  );

  return (
    <section
      className="-mx-1 rounded-lg border border-border/55 bg-card/40 px-2 py-1.5"
      aria-label={`Workflow ${run.name}`}
    >
      <button
        type="button"
        className="-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        aria-expanded={expanded}
        onClick={() => setExpandedOverride(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
        )}
        <NetworkIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        <span className="truncate font-medium text-[13px] text-foreground/90">{run.name}</span>
        <Badge size="sm" variant={badge.variant} className="ml-1 shrink-0">
          {badge.label}
        </Badge>
        <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted-foreground/65">
          {elapsed}
        </span>
      </button>

      <p className="truncate pl-5 text-[11px] text-muted-foreground/65">
        {[
          run.agents.length === 1 ? "1 agent" : `${run.agents.length} agents`,
          running && run.activeAgentCount > 0 ? `${run.activeAgentCount} running` : null,
          tokens ? `${tokens} tokens` : null,
          run.toolUses ? `${run.toolUses} tool calls` : null,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </p>

      {run.reconciled ? (
        <p className="flex items-start gap-1.5 pt-1 pl-5 text-[11px] text-warning-foreground">
          <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
          <span>
            The session ended while this run was going. Its final state was never reported —
            relaunch it to pick up where it left off.
          </span>
        </p>
      ) : null}

      {run.error ? (
        <p className="flex items-start gap-1.5 pt-1 pl-5 text-[11px] text-destructive-foreground">
          <CircleSlashIcon className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 break-words">{run.error}</span>
        </p>
      ) : null}

      {expanded ? (
        run.phases.length > 0 ? (
          <ul className="mt-1 border-border/40 border-t pt-1">
            {run.phases.map((phase) => (
              <PhaseSection
                key={phase.title ?? "__unphased__"}
                phase={phase}
                now={now}
                settled={!running}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-1 border-border/40 border-t pt-1 pl-5 text-[11px] text-muted-foreground/60">
            {running ? "Waiting for the first agent to report in…" : "No agent activity recorded."}
          </p>
        )
      ) : null}
    </section>
  );
});

export default WorkflowRunCard;
