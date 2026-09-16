/**
 * Work status message pools for NPC characters.
 * Messages are categorized by tool type to match what the real agent is doing.
 * Each message simulates realistic developer thinking and work patterns.
 */

import { getLocale } from '../i18n';

// ─── Status message pools ──────────────────────────────────

interface StatusPool {
  zh: string[];
  en: string[];
}

/** Reading/reviewing code */
const READING: StatusPool = {
  zh: [
    '审查 API 逻辑...',
    '阅读源码注释',
    '检查依赖关系',
    '对比两个分支差异',
    '查看测试覆盖率',
    '分析错误日志',
    '追踪调用链路',
    '理解数据流向',
    '检索相关文档',
    '复查 PR 代码',
    '对比新旧实现',
    '查看 commit 记录',
    '审阅类型定义',
    '理清模块边界',
    '确认接口契约',
  ],
  en: [
    'Reviewing API logic...',
    'Reading source comments',
    'Checking dependencies',
    'Comparing branch diffs',
    'Checking test coverage',
    'Analyzing error logs',
    'Tracing call chain',
    'Understanding data flow',
    'Searching docs',
    'Reviewing PR code',
  ],
};

/** Writing/editing code */
const WRITING: StatusPool = {
  zh: [
    '编写单元测试',
    '重构 render 函数',
    '优化 SQL 查询',
    '添加错误处理',
    '实现新接口',
    '封装公共方法',
    '补充类型标注',
    '抽取共用组件',
    '编写 migration',
    '调整样式布局',
    '处理边界情况',
    '添加参数校验',
    '实现缓存策略',
    '编写中间件',
    '优化渲染逻辑',
  ],
  en: [
    'Writing unit tests',
    'Refactoring render()',
    'Optimizing SQL query',
    'Adding error handling',
    'Implementing interface',
    'Extracting component',
    'Adding type annotations',
    'Writing migration',
    'Handling edge cases',
    'Adding validation',
  ],
};

/** Running commands / debugging */
const DEBUGGING: StatusPool = {
  zh: [
    '调试 useEffect',
    '排查内存泄漏',
    '检查 API 响应',
    '分析性能瓶颈',
    '跑回归测试',
    '构建生产包',
    '检查环境变量',
    '分析堆栈信息',
    '监控资源占用',
    '验证修复效果',
    '定位死循环',
    '复现边界问题',
    '压力测试中...',
    '观察日志输出',
  ],
  en: [
    'Debugging useEffect',
    'Finding memory leak',
    'Checking API response',
    'Profiling performance',
    'Running regression tests',
    'Building for production',
    'Checking env vars',
    'Analyzing stack trace',
    'Monitoring resources',
    'Verifying the fix',
  ],
};

/** Thinking / planning (at desk, idle-ish) */
const THINKING: StatusPool = {
  zh: [
    '思考最优方案...',
    '对比两种实现...',
    '评估技术风险...',
    '规划下一步...',
    '权衡利弊中...',
    '梳理需求逻辑',
    '画脑图理思路',
    '琢磨命名...',
    '考虑向后兼容',
    '想想怎么拆分',
    '回忆之前的写法',
    '构思数据结构',
    '估算复杂度...',
    '想清楚再动手',
    '从顶层设计想起',
    '结果导向倒推',
    '这个抓手在哪',
    '灰度方案评估中',
  ],
  en: [
    'Thinking about approach...',
    'Comparing implementations...',
    'Evaluating tech risk...',
    'Planning next step...',
    'Weighing trade-offs...',
    'Mapping requirements',
    'Sketching architecture',
    'Naming things...',
    'Considering backwards compat',
    'Estimating complexity...',
  ],
};

/** Collaboration activities (whiteboard, pair, meeting) */
const COLLABORATING: StatusPool = {
  zh: [
    '讨论接口设计',
    '代码评审中',
    '同步进度',
    '确认需求细节',
    '讨论技术选型',
    '复盘方案',
    '对齐目标',
    '讨论异常处理',
    '确认排期',
    '沟通上下游',
    '澄清边界条件',
    '分享思路',
    '拉通资源',
    '信息拉齐',
    '快速迭代方案中',
    '小步快跑验证',
    '梳理底层逻辑',
    '确认颗粒度',
    '闭环这个链路',
    '拿结果导向推',
  ],
  en: [
    'Discussing API design',
    'Code reviewing',
    'Syncing progress',
    'Clarifying requirements',
    'Discussing tech stack',
    'Reviewing approach',
    'Aligning understanding',
    'Discussing error handling',
    'Confirming timeline',
    'Sharing ideas',
  ],
};

/** Searching / grepping */
const SEARCHING: StatusPool = {
  zh: [
    '搜索相关实现',
    '查找引用关系',
    '定位关键函数',
    '检索错误信息',
    '查找配置项',
    '搜集最佳实践',
    '翻阅历史记录',
    '查找类似模式',
  ],
  en: [
    'Searching implementations',
    'Finding references',
    'Locating key function',
    'Searching error messages',
    'Finding config options',
    'Gathering best practices',
    'Browsing git history',
    'Finding similar patterns',
  ],
};

/** Brief break activities (water, stretch) */
const BREAK: StatusPool = {
  zh: ['接杯咖啡', '喝口水', '活动活动', '深呼吸...', '揉揉眼睛', '伸个懒腰'],
  en: [
    'Getting coffee',
    'Grabbing water',
    'Stretching',
    'Taking a breath...',
    'Resting eyes',
    'Quick stretch',
  ],
};

// ─── Tool → Pool mapping ───────────────────────────────────

const TOOL_STATUS_POOL: Record<string, StatusPool> = {
  Read: READING,
  Grep: SEARCHING,
  Glob: SEARCHING,
  WebFetch: READING,
  WebSearch: SEARCHING,
  Write: WRITING,
  Edit: WRITING,
  Bash: DEBUGGING,
  Task: COLLABORATING,
  Agent: COLLABORATING,
};

// ─── Public API ────────────────────────────────────────────

/** Pick a random status message appropriate for the given tool */
export function pickWorkStatus(tool: string | null): string {
  const locale = getLocale();
  const lang = locale === 'zh-CN' ? 'zh' : 'en';

  if (!tool) {
    const pool = THINKING[lang];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const statusPool = TOOL_STATUS_POOL[tool] ?? THINKING;
  const pool = statusPool[lang];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pick a thinking/planning status */
export function pickThinkingStatus(): string {
  const locale = getLocale();
  const lang = locale === 'zh-CN' ? 'zh' : 'en';
  const pool = THINKING[lang];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pick a collaboration status (whiteboard, meeting, pair) */
export function pickCollabStatus(): string {
  const locale = getLocale();
  const lang = locale === 'zh-CN' ? 'zh' : 'en';
  const pool = COLLABORATING[lang];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pick a break activity status */
export function pickBreakStatus(): string {
  const locale = getLocale();
  const lang = locale === 'zh-CN' ? 'zh' : 'en';
  const pool = BREAK[lang];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Character personalities & mumbles ─────────────────────

/**
 * Each palette (0-5) has a unique personality with their own complaint/mumble style.
 * 比比拉布(0): 老实人，默默吐槽被欺负
 * 八嘎呀路(1): 暴躁，直接开骂
 * 我的刀盾(2): 佛系，啥都无所谓
 * 巴巴博一(3): 卷王，暗暗较劲
 * 歪比巴卜(4): 摸鱼达人，想划水
 * 咕咕嘎嘎(5): 社牛，话多爱聊天
 */
const MUMBLES: Record<number, { zh: string[]; en: string[] }> = {
  0: {
    zh: [
      '又是我一个人干...',
      '为什么总找老实人',
      '我不说不代表我没意见',
      '活都塞给我了是吧',
      '忍一时风平浪静...',
      '好人做到底吧',
      '明明说好一起的...',
      '算了 习惯了',
      '下次一定拒绝...吧',
      '我是工具人吗',
      '唉 谁让我好说话呢',
      '再欺负我我就...算了',
    ],
    en: [
      'Always me doing the work...',
      'Why always pick the quiet one',
      "I have opinions too y'know",
      "Fine, I'll do it myself",
      "One day I'll say no...",
      'Being nice is exhausting',
    ],
  },
  1: {
    zh: [
      '这代码谁写的！！',
      '离谱 真的离谱',
      '又出 bug 了？？',
      '我要提离职',
      '这需求改了几版了',
      '受不了了',
      '谁动了我的代码',
      '这接口是认真的吗',
      '烦死了 又返工',
      '产品经理出来挨打',
      '我不管 今天必须下班',
      '再改需求我翻桌',
    ],
    en: [
      'WHO wrote this code?!',
      'This is absolutely insane',
      'Another bug?? Seriously??',
      'I quit (not really)',
      'How many times changed now',
      'PM come fight me',
    ],
  },
  2: {
    zh: [
      '无所谓 都行',
      '随缘吧',
      '急也没用 慢慢来',
      '能跑就行',
      '差不多得了',
      '佛了 随便',
      '能用就不要动它',
      '别卷了 真的',
      '摆烂也是一种态度',
      '不急 慢慢调',
      '先这样吧',
      '心如止水.jpg',
    ],
    en: [
      'Whatever works',
      'No rush',
      'It is what it is',
      'Good enough',
      "Don't overthink it",
      'Zen mode activated',
    ],
  },
  3: {
    zh: [
      '我要做到最好',
      '这还能再优化',
      '比他们写得好就行',
      '今天必须搞定',
      '效率 效率 效率',
      '又比别人多干了',
      '这个绩效稳了',
      '卷死他们',
      '精益求精',
      '我的方案最优',
      '加把劲就完美了',
      '别人下班我加班',
    ],
    en: [
      'Must be the best',
      'Can still optimize this',
      'Gotta outperform everyone',
      'Finishing this TODAY',
      'Efficiency is everything',
      'My solution is superior',
    ],
  },
  4: {
    zh: [
      '划水中 勿扰',
      '假装在忙...',
      '还有多久下班',
      '摸鱼的艺术',
      '困了 好困',
      '午饭吃什么',
      '今天周几来着',
      '开小差中...',
      '在想今晚吃啥',
      '装作很认真的样子',
      '不想动 一点都不想',
      '偷偷摸手机',
    ],
    en: [
      'Slacking off... shh',
      'Pretending to be busy',
      'When is lunch',
      'The art of doing nothing',
      'So sleepy...',
      'What day is it again',
    ],
  },
  5: {
    zh: [
      '哎你们听说了吗',
      '来聊会天呗',
      '这个 bug 好有趣',
      '我跟你说哦',
      '有人要喝奶茶吗',
      '今天八卦好多',
      '谁要拼单外卖',
      '刚听到个大瓜',
      '群里又炸了',
      '快看快看那个',
      '一起团个下午茶',
      '这个梗太好笑了',
    ],
    en: [
      'Hey did you hear about...',
      "Let's chat for a sec",
      'This bug is kinda funny',
      'Anyone want bubble tea?',
      'OMG the group chat rn',
      'Who wants to order food',
    ],
  },
};

/** Chance that a status refresh shows a mumble instead of work status (30%) */
const MUMBLE_CHANCE = 0.3;

/** Pick a personality-appropriate mumble for a character */
export function pickMumble(palette: number): string {
  const locale = getLocale();
  const lang = locale === 'zh-CN' ? 'zh' : 'en';
  const pool = MUMBLES[palette]?.[lang] ?? MUMBLES[0][lang];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pick either a work status or a mumble, based on chance */
export function pickStatusOrMumble(tool: string | null, palette: number): string {
  if (Math.random() < MUMBLE_CHANCE) {
    return pickMumble(palette);
  }
  return pickWorkStatus(tool);
}

/** Status display duration range (seconds) */
export const STATUS_DURATION_MIN = 4;
export const STATUS_DURATION_MAX = 8;
