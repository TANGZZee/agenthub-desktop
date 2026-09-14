// 阶段2的 Agent 验证脚本。
// 默认打印环境变量后常驻；带 --once 时打印完立即退出。

const SECRET_NAME_PATTERN = /_TOKEN$|_API_KEY$|_KEY$/i;
const ROUTE_PREFIXES = ["ANTHROPIC_", "OPENAI_"];
const PREFERRED_ROUTE_ORDER = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];

function displayValue(name, value) {
  if (SECRET_NAME_PATTERN.test(name)) {
    return value.length > 0 ? `已设置（共 ${value.length} 位）` : "未设置";
  }
  return value;
}

function sortedRouteNames() {
  const names = Object.keys(process.env).filter((name) =>
    ROUTE_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );

  const preferred = PREFERRED_ROUTE_ORDER.filter((name) =>
    names.includes(name),
  );
  const remaining = names
    .filter((name) => !preferred.includes(name))
    .sort((left, right) => left.localeCompare(right));

  return [...preferred, ...remaining];
}

function printEnvironment() {
  const routeNames = sortedRouteNames();

  console.log("[env-dump] ===== 模型路由环境变量 =====");
  for (const name of routeNames) {
    console.log(`[env-dump] ${name}=${displayValue(name, process.env[name] ?? "")}`);
  }

  const agentHubNames = Object.keys(process.env)
    .filter((name) => name.startsWith("AGENTHUB_"))
    .sort((left, right) => left.localeCompare(right));

  console.log("[env-dump] ===== AGENTHUB_* 上下文 =====");
  for (const name of agentHubNames) {
    console.log(`[env-dump] ${name}=${displayValue(name, process.env[name] ?? "")}`);
  }
}

function stop() {
  console.log("[env-dump] 收到终止请求，退出");
  process.exit(0);
}

printEnvironment();

if (process.argv.includes("--once")) {
  process.exit(0);
}

let elapsedSeconds = 0;
setInterval(() => {
  elapsedSeconds += 1;
  console.log(`[env-dump] 仍在运行 t=${elapsedSeconds}s`);
}, 1000);

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
