"use strict";

// 阶段1测试用子进程：模拟一个持续输出日志、随后正常结束的 Agent。
const TOTAL_LINES = 30;
const INTERVAL_MS = 500;
const FAST_EXIT = process.argv.includes("--fast-exit");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFastExit() {
  // 只输出一行就结束，用来复现“进程秒退”与前端异步结果竞争的问题。
  console.log("[Node 快速退出] 已启动，本行输出后立即正常退出");
}

async function runNormal() {
  console.log(`[Node 测试] 共 ${TOTAL_LINES} 行，每 ${INTERVAL_MS}ms 输出一行`);

  for (let index = 1; index <= TOTAL_LINES; index += 1) {
    const text = `[Node 测试] 第 ${index}/${TOTAL_LINES} 行`;

    // 第 10、18 行写入 stderr，用于检查两种输出流的颜色与顺序。
    if (index === 10 || index === 18) {
      console.error(`${text}（来自 stderr）`);
    } else {
      console.log(`${text}（来自 stdout）`);
    }

    if (index < TOTAL_LINES) {
      await wait(INTERVAL_MS);
    }
  }
}

async function main() {
  if (FAST_EXIT) {
    await runFastExit();
    return;
  }

  await runNormal();
}

main().catch((error) => {
  console.error("[Node 测试] 运行失败：", error);
  process.exitCode = 1;
});
