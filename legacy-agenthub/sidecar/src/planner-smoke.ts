import { planWorker, buildReadOnlyProposal } from "../../shared/planner";

const codePlan = planWorker("请帮我修复 TypeScript 编译错误");
if (codePlan.workerId !== "codex") throw new Error("代码任务应分配给 Codex");
const readPlan = planWorker("整理当前项目的文件结构");
if (readPlan.workerId !== "pi") throw new Error("阅读任务应分配给 Pi");
if (readPlan.toolPolicy.includes("terminal")) throw new Error("规划器不得包含危险工具");
const proposal = buildReadOnlyProposal("阅读 README", "pi");
if (proposal.writeScope !== "none") throw new Error("提案必须只读");
console.log("planner smoke test passed");


