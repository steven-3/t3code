import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveWorkflowRunCards,
  deriveWorkflowRuns,
  formatWorkflowElapsed,
  splitAgentLabel,
  workflowRunTaskIds,
} from "./workflowRuns";

const BASE_MS = Date.parse("2026-07-25T06:00:00.000Z");

function at(offsetSeconds: number): string {
  return new Date(BASE_MS + offsetSeconds * 1_000).toISOString();
}

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  createdAt: string,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt,
  };
}

function workflowActivities(): OrchestrationThreadActivity[] {
  return [
    makeActivity(
      "a1",
      "task.started",
      {
        taskId: "wf-1",
        taskType: "local_workflow",
        workflowName: "alvera-app-overhaul",
        detail: "Build every feature in the spec",
      },
      at(0),
    ),
    makeActivity(
      "a2",
      "task.progress",
      {
        taskId: "wf-1",
        title: "Backend: py:signals",
        usage: { total_tokens: 12_000, tool_uses: 3 },
      },
      at(5),
    ),
    makeActivity(
      "a3",
      "task.progress",
      {
        taskId: "wf-1",
        title: "Backend: py:scoring",
        usage: { total_tokens: 26_000, tool_uses: 7 },
      },
      at(9),
    ),
    makeActivity(
      "a4",
      "task.progress",
      {
        taskId: "wf-1",
        title: "Wiring: fe:panes",
        usage: { total_tokens: 41_000, tool_uses: 11 },
      },
      at(20),
    ),
  ];
}

describe("workflowRuns", () => {
  it("groups agent progress frames into phases under one run", () => {
    const runs = deriveWorkflowRuns(workflowActivities(), BASE_MS + 21_000);

    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.name).toBe("alvera-app-overhaul");
    expect(run.isWorkflow).toBe(true);
    expect(run.status).toBe("running");
    expect(run.totalTokens).toBe(41_000);
    expect(run.toolUses).toBe(11);
    expect(run.phases.map((phase) => phase.title)).toEqual(["Backend", "Wiring"]);
    expect(run.phases[0]?.agents.map((agent) => agent.label)).toEqual(["py:signals", "py:scoring"]);
    // A phase stops being active once a later phase reports in.
    expect(run.phases[0]?.done).toBe(true);
    expect(run.phases[1]?.done).toBe(false);
    expect(run.activeAgentCount).toBe(1);
    expect(run.anchorActivityId).toBe("a1");
  });

  it("marks agents idle when their frames go quiet while the run continues", () => {
    const runs = deriveWorkflowRuns(
      [
        ...workflowActivities(),
        makeActivity("a5", "task.progress", { taskId: "wf-1", title: "Wiring: fe:shell" }, at(120)),
      ],
      BASE_MS + 121_000,
    );

    const wiring = runs[0]?.phases.at(-1);
    expect(wiring?.agents.map((agent) => `${agent.label}:${agent.status}`)).toEqual([
      "fe:panes:idle",
      "fe:shell:running",
    ]);
  });

  it("marks agents stopped — not done — when the run was cut short", () => {
    const runs = deriveWorkflowRuns(
      [
        ...workflowActivities(),
        makeActivity(
          "a6",
          "task.completed",
          { taskId: "wf-1", status: "stopped", reconciled: true, summary: "Session ended" },
          at(30),
        ),
      ],
      BASE_MS + 31_000,
    );

    const run = runs[0]!;
    expect(run.status).toBe("stopped");
    expect(run.reconciled).toBe(true);
    expect(run.completedAt).toBe(at(30));
    expect(run.agents.every((agent) => agent.status === "stopped")).toBe(true);
    expect(run.activeAgentCount).toBe(0);
  });

  it("marks every agent done when the run completes cleanly", () => {
    const runs = deriveWorkflowRuns(
      [
        ...workflowActivities(),
        makeActivity("a8", "task.completed", { taskId: "wf-1", status: "completed" }, at(30)),
      ],
      BASE_MS + 31_000,
    );

    expect(runs[0]?.agents.every((agent) => agent.status === "done")).toBe(true);
    expect(runs[0]?.phases.every((phase) => phase.done)).toBe(true);
  });

  it("treats a killed state patch as terminal even without a completion frame", () => {
    const runs = deriveWorkflowRuns(
      [
        ...workflowActivities(),
        makeActivity("a7", "task.updated", { taskId: "wf-1", status: "killed" }, at(25)),
      ],
      BASE_MS + 26_000,
    );

    expect(runs[0]?.status).toBe("stopped");
    expect(runs[0]?.reconciled).toBe(false);
  });

  it("keeps plain background tasks out of the workflow cards", () => {
    const activities = [
      ...workflowActivities(),
      makeActivity(
        "b1",
        "task.started",
        { taskId: "sh-1", taskType: "local_bash", detail: "Run tests" },
        at(2),
      ),
    ];

    expect(deriveWorkflowRuns(activities, BASE_MS + 30_000)).toHaveLength(2);
    expect(deriveWorkflowRunCards(activities, BASE_MS + 30_000).map((run) => run.taskId)).toEqual([
      "wf-1",
    ]);
  });

  it("reports the task ids the cards already render", () => {
    const cards = deriveWorkflowRunCards(workflowActivities(), BASE_MS + 30_000);
    expect(Array.from(workflowRunTaskIds(cards))).toEqual(["wf-1"]);
  });

  it("splits phase-prefixed agent labels", () => {
    expect(splitAgentLabel("Wiring + panes: fe:ai+chat")).toEqual({
      phase: "Wiring + panes",
      label: "fe:ai+chat",
    });
    expect(splitAgentLabel("standalone")).toEqual({ phase: null, label: "standalone" });
  });

  it("formats elapsed time across units", () => {
    expect(formatWorkflowElapsed(at(0), at(45))).toBe("45s");
    expect(formatWorkflowElapsed(at(0), at(125))).toBe("2m 5s");
    expect(formatWorkflowElapsed(at(0), at(7_300))).toBe("2h 1m");
  });
});
