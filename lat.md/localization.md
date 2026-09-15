# Localization

Locale strings live in [[src/shared/i18n/index.ts]] under `src/shared/i18n/locales/<locale>/<namespace>.ts`, one flat object per namespace. A key missing from a locale silently falls back to English, so an untranslated page looks merely incomplete rather than broken.

A new English string must ship with its zh-CN counterpart in the same change; the guard below is what enforces it.

## Chinese coverage guard

Every key English ships must also exist in zh-CN, and placeholders must survive translation.

[[src/shared/i18n/coverage.test.ts]] fails when a key is missing and lists it, and fails when `{{name}}`-style placeholders differ from the English source. Values are not asserted — brand, font, and protocol names legitimately stay English — so only key presence and placeholder shape are locked.

## Terminology

One shared vocabulary keeps the Simplified Chinese UI from drifting between synonyms across screens.

- profile → 档案；agent → 智能体；worker → 智能体（Workers 页）
- gateway → 网关；provider → 提供商；model → 模型
- skill → 技能；tool → 工具；session → 会话
- memory → 记忆；persona → 人格；soul → 人格
- token → 令牌；API key → API 密钥；endpoint → 端点；base URL → 基础 URL
- kanban → 看板；schedule → 计划任务；office → 办公室；diagnose → 诊断

Brand and product names stay in their original form (Hermes、OpenAI、Anthropic、Ollama、OpenRouter、LM Studio、vLLM、llama.cpp、AtlasCloud…), as do font names and identifiers such as `API_SERVER_KEY`.

## Style rules

UI copy is terse, verb-first, and addresses the user as 你 rather than 您.

Sentences use full-width Chinese punctuation (`，。：？！`) and Chinese quotation marks; half-width marks survive only inside code, URLs, file paths, and model identifiers. Placeholders keep their exact spelling and may move to fit Chinese word order.

## Slash command labels

Desktop and fallback slash commands keep English `description` in code so existing tests stay stable. The palette, `/help`, and error bubbles translate those strings at display time via [[src/renderer/src/screens/Chat/slash/localizeSlashCommand.ts#localizedSlashDescription]].

Gateway-supplied command names that have no in-repo key keep their original description. Category badges map `chat`/`info`/`tools`/`agent` onto locale strings such as 页面与设置.

