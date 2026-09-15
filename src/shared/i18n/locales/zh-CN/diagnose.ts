export default {
  title: "配置健康检查",
  description:
    "检查桌面端的配置（环境变量、config.yaml、模型），找出常导致聊天失败的不一致之处，并在可以安全自动处理时提供一键修复。",
  rerun: "重新检查",
  allGood: "未发现问题。你的配置看起来是一致的。",
  banner: {
    lead: "检测到配置问题：",
    errors: "{{count}} 个错误",
    warnings: "{{count}} 个警告",
    infos: "{{count}} 条提示",
    showDetails: "显示详情",
  },
  apiKeyBanner: {
    lead: "未设置 API 服务器密钥——聊天将无法进行。",
    setNow: "立即设置",
  },
  apiKeyModal: {
    title: "设置 API 服务器密钥",
    description:
      "Hermes 网关需要 API_SERVER_KEY 才能认证请求。立即设置即可启用聊天。如果你把密钥存放在密码库中（KeePassXC、Bitwarden 等），并且 Hermes 的 `secrets.provider` 已指向该密码库，可以忽略这条警告——提供商会直接提供密钥。",
    label: "API 服务器密钥",
    placeholder: "sk-… 或任意密钥",
    autoGenerate: "自动生成",
    hint: "你可以粘贴自己的密钥，或生成一个随机 UUID。",
  },
  fix: {
    apply: "应用修复",
    running: "正在应用…",
    success: "修复已应用。",
    failure: "修复失败。",
  },
} as const;
