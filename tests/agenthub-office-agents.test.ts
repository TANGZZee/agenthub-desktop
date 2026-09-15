import { describe, expect, it } from "vitest";
import {
  officeAgentsChanged,
  workerToOfficeAgent,
  workersToOfficeAgents,
} from "../src/renderer/src/screens/Office/office3d/agents";

// @lat: [[agenthub-workers#Office mapping]]
describe("AgentHub office worker mapping", () => {
  it("maps a running worker to working and a failed run to error", () => {
    const base = { id: "pi", name: "Pi (controlled CLI)" };
    expect(
      workerToOfficeAgent({
        ...base,
        runningCount: 1,
        latestStatus: "succeeded",
      }).status,
    ).toBe("working");
    expect(
      workerToOfficeAgent({ ...base, runningCount: 0, latestStatus: "failed" })
        .status,
    ).toBe("error");
    expect(
      workerToOfficeAgent({
        ...base,
        runningCount: 0,
        latestStatus: "timed_out",
      }).status,
    ).toBe("error");
    expect(
      workerToOfficeAgent({ ...base, runningCount: 0, latestStatus: null })
        .status,
    ).toBe("idle");
  });

  it("marks workers with workerId, a namespaced id, and CLI subtitle", () => {
    const agent = workerToOfficeAgent({
      id: "pi",
      name: "Pi",
      model: "gpt-5.1",
      runningCount: 0,
    });
    expect(agent.workerId).toBe("pi");
    expect(agent.id).toBe("worker:pi");
    expect(agent.subtitle).toBe("gpt-5.1");
    expect(agent.position).toBe("employee");
    expect(agent.name).toBe("Pi");
    const withoutModel = workerToOfficeAgent({
      id: "pi",
      name: "Pi",
      runningCount: 0,
    });
    expect(withoutModel.subtitle).toBe("AgentHub CLI");
  });

  it("keeps a deterministic color per worker across calls", () => {
    const input = { id: "codex", name: "Codex", runningCount: 0 };
    expect(workerToOfficeAgent(input).color).toBe(
      workerToOfficeAgent(input).color,
    );
  });

  it("maps a list in order and reports worker changes", () => {
    const agents = workersToOfficeAgents([
      { id: "pi", name: "Pi", runningCount: 0 },
      { id: "codex", name: "Codex", runningCount: 2 },
    ]);
    expect(agents.map((agent) => agent.workerId)).toEqual(["pi", "codex"]);
    expect(agents[1].status).toBe("working");

    const previous = workersToOfficeAgents([
      { id: "pi", name: "Pi", runningCount: 0 },
      { id: "codex", name: "Codex", runningCount: 0 },
    ]);
    expect(officeAgentsChanged(previous, agents)).toBe(true);
    expect(officeAgentsChanged(previous, previous)).toBe(false);
  });
});
