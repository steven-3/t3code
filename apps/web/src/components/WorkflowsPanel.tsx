import { memo } from "react";
import { NetworkIcon } from "lucide-react";

import { WorkflowRunCard } from "./chat/WorkflowRunCard";
import { ScrollArea } from "./ui/scroll-area";
import { useTickingNow } from "~/hooks/useTickingNow";
import type { WorkflowRun } from "../lib/workflowRuns";

/**
 * Every workflow run in the thread, newest first — the aggregate counterpart
 * to the inline cards, which stay anchored where each run was launched.
 */
const WorkflowsPanel = memo(function WorkflowsPanel({
  runs,
  label = "Workflows",
  mode = "sidebar",
}: {
  runs: ReadonlyArray<WorkflowRun>;
  label?: string;
  mode?: "sheet" | "sidebar" | "embedded";
}) {
  const hasRunning = runs.some((run) => run.status === "running");
  const now = useTickingNow(hasRunning);
  const orderedRuns = runs.toReversed();
  const runningCount = runs.filter((run) => run.status === "running").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mode !== "embedded" ? (
        <header className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
          <NetworkIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          <h2 className="font-medium text-[13px] text-foreground/90">{label}</h2>
          {runningCount > 0 ? (
            <span className="ml-auto text-[11px] text-muted-foreground/65">
              {runningCount} running
            </span>
          ) : null}
        </header>
      ) : null}

      {orderedRuns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
          <NetworkIcon className="size-5 text-muted-foreground/40" />
          <p className="font-medium text-[13px] text-foreground/80">No workflows yet</p>
          <p className="max-w-[36ch] text-[11px] text-muted-foreground/65">
            Dynamic workflows launched by the agent show up here with their phases and per-agent
            progress while they run.
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 p-3">
            {orderedRuns.map((run) => (
              <WorkflowRunCard
                key={run.taskId}
                run={run}
                now={now}
                defaultExpanded={run.status === "running"}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
});

export default WorkflowsPanel;
