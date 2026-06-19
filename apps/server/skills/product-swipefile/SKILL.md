---
name: product-swipefile
description: "对一个明确命名的产品或产品集做深度产品调研（网站、App、SaaS、AI 工具、开源项目或创业公司），仅当用户用任意语言明确要求「调研 / 分析某个具名产品」时使用。"
---

# 产品调研 Skill（入口）

本文件是唯一入口。先读本文件，再按阶段读取 `references/` 下对应的补充文件。

目标模型：本 skill 为 Claude 模型设计。可由任何能运行 Claude 的宿主使用——Claude Code 自带 skills、终端直接 `claude -p`、OpenCode 等通过 Anthropic API 接 Claude 的 CLI——只要后端是 Claude 模型即可。换用其他模型可能因纪律遵循度、上下文窗口或工具支持差异而无法稳定产出 skill 承诺的质量级报告。

质量级执行：若当前环境能运行本地脚本，完整深度调研默认走仓库根 `run.py`。它把采集和写作拆成两个 headless 进程，中间强制验证与 checkpoint，以分阶段证据驱动方式产出“先证据、后写作”的质量级报告。交互式执行只作为 fallback：可以手动完成同样阶段、同样产物、同样验证，但不得把未完成卡点的交互式草稿当作质量级报告。

## 1. 触发边界

- 用户用任意语言明确要求「调研 / 分析 <产品>」时使用。
- 行业或宏观市场问题：只有当能明确出一个产品对象或产品集时，才转为产品调研；否则先问清产品或品类边界。
- 闲聊式产品问答、文案、写代码、泛泛建议：不使用本 skill。
- 用户给一次性覆盖（如「这次用英文」「这次存到 Obsidian」）：本次生效，不改持久设置。

## 2. 文件边界

产品调研只允许读取：

1. 本文件 `SKILL.md`
2. `references/inventory.md`
3. `references/writing.md`
4. `references/delivery.md`
5. 本次 run 的 `inventory.md` 与 `inventory.md` 明确引用的 `raw/` 文件

不得读取与本任务无关的其他模板或文件。`references/` 与 `scripts/` 相对本 skill 目录解析。

## 3. 首跑 Setup（陌生用户 / 持久设置缺失时走这一遍）

**已有持久设置就跳过这一节，直接进 Phase 0。** 没有持久设置的用户第一次触发时，按下面顺序问完再开跑。问答全部在调研开始**前**完成；问完用户选"记住"，下次就不再问。

### 3.1 采集工具 opencli（建议先装）

开跑前先跑 `python3 scripts/research_helper.py opencli-check`。如果 `available: false`，给用户这段告知（不阻塞，用户可以选择装或跳过）：

```
检测到没装 opencli。

调研仍然能做，我会用网页搜索兜底。但装上 opencli 信息会全面很多——很多平台的「站内真实数据」只有 opencli 能抓到，网页搜索只能看到摘要。

涉及 opencli 的信息举例：
• X / Twitter：官方账号粉丝数、发帖、互动量
• YouTube / TikTok / Bilibili：创作者视频、播放、评论
• 小红书 / 微博 / 抖音：中文平台的种草内容和热度
• Reddit / Hacker News / Product Hunt：社区讨论、真实用户声音

没有它，以上模块（创作者策略、用户声音、官方渠道、中国市场）会偏薄。

安装（约 1 分钟）：
  npm i -g @jackwener/opencli

装好回来告诉我，或直接说"跳过"用网页搜索继续。
```

`available: true` 时这一步无感跳过，不提示。

### 3.2 报告语言

```
检测到你用 <中文/英文> 输入，默认 <中文/英文>。要换吗？
• 中文（默认）
• 英文
```

### 3.3 报告存到哪（多选）

```
存到哪？前三个阅读体验最好，可多选：

• Obsidian — 本地离线、Markdown 原生
• 飞书 / Lark — 团队协作场景
• Notion — 已有 Notion 工作流

都没装也可以选：
• 本地 Markdown 文件 — 最简单，但阅读体验不如上面三个
```

用户每选一个目标，按 3.4 走该目标的配置子流程。**多目标分别问完所有配置后再进 Phase 0**。

### 3.4 各目标的配置子流程

**Obsidian** — 必须问 vault 路径：
```
Obsidian vault 路径是？
（vault 通常在 Obsidian 应用 "Vault 设置 → Files & Links" 能看到，
 或直接告诉我 vault 文件夹路径，例如 /Users/你/Documents/MyVault）
```
检查路径是否存在 + 可写。**不存在直接报错让用户重输**，不自动建目录、不列候选位置猜。vault 内不再问 folder 子目录——报告直接落在 vault 根目录，用户既然指定了这个 vault 就视为可写。

**飞书 / Lark** — 必须问 connector 是否配过：
```
飞书 Page Connector 配过吗？
• 配过
• 没配过
```
没配过时给三个选项：
```
(a) 现在给你配置指引（一段说明，按指引装好 connector 再回来）
(b) 本次先跳过飞书，导其他已选目标
(c) 不导飞书了
```
选 (a) 时给一段简短指引：飞书开放平台 → 建 app → 开启文档读写权限 → 拿 connector 配置 → 粘到 `~/.config/product-swipefile/settings.json` 或对应 MCP 配置。完成后用户回来确认 connector_ready。

**Notion** — 必须问两样：
```
Notion 需要：
• NOTION_TOKEN 环境变量
• parent page 或 database 的 ID

缺哪个？要配置指引吗？
```
指引：Notion → Settings → Connections → Develop or manage integrations → 建 internal integration → 复制 token，**把 token 设成环境变量**（如 `export NOTION_TOKEN=...`，可写进 shell 配置）；**settings.json 只存环境变量名（`NOTION_TOKEN`），绝不写 token 原文**。再把目标 page 或 database 分享给 integration → 复制 page/database ID，把 parent type、parent id 写入 settings.json。

**本地 Markdown** — 必须问目录：
```
本地 Markdown 存到哪个目录？
• 默认 ~/Documents/ProductResearch
• 或告诉我别的路径
```
不存在则建一个。

### 3.5 记住默认

所有配置完成后、调研开始**前**问一次：
```
要不要把这套配置（语言 + 已选目标 + 各目标路径与环境变量名，不含 token 原文）记成默认？
• 是 — 以后说"调研 X"直接跑，不再问
• 否 — 只这次用
```
选"是"写入 `~/.config/product-swipefile/settings.json`。

### 3.6 改默认

已经记过默认的用户，**第二次起一律不再问，触发即跑**。

## 4. 强制阶段顺序

按下表执行，不跳阶段、不颠倒、不合并。一次深度调研是分阶段产物流水线，不是一次连续写作。

| 阶段 | 干什么 | 读哪个文件 | 落地产物 |
|---|---|---|---|
| Phase 0 | 建 run 目录 → 读 writing.md → 建章节渲染映射 | writing.md | run 目录 + 章节映射 |
| Phase 1 | 公开证据采集 → 写 inventory + raw | inventory.md | inventory.md + raw/ |
| Phase 1 卡点 | Gap Check + Inventory Readiness + validate-inventory → 冻结 inventory 或回采集 | inventory.md | 校验通过的 inventory + 卡点 |
| Phase 2 | 基于已冻结 inventory 写正文 | writing.md | report.md |
| Phase 3 | Evidence-Relative 完整性 + validate-report → 修正或回采集 | writing.md | 校验通过的 report.md |
| Phase 4 | 导出 / 同步 + 交接通知 | delivery.md | 各目标产物 + 交接通知 |

可用本机脚本时，优先用根目录 launcher 完整执行质量级调研：

```bash
./run.py "<产品名>" --language zh
```

`run.py` 启动一个 `claude -p` headless 子进程跑 Stage 1 采集，validate-inventory 通过后再启动**全新的** headless 子进程跑 Stage 2 写作（工具白名单移除 WebSearch/WebFetch，并在 prompt 中禁止新增 inventory 之外的事实），最后 validate-report。整个流程外部 timeout 默认 90 分钟/阶段，关闭 auto-memory。

需要手动分阶段或恢复时，Phase 0 先建 run 目录，全程使用其返回路径：

```bash
python3 scripts/research_helper.py new-run --product "<产品名>"
```

不复用固定的产品级临时路径；陈旧产物会让新报告看起来「有来源」实则没有。恢复任务或进入下一阶段前，先运行 `stage-status --run-dir <run_dir>` 取机械化的下一步读数，不靠对上次对话的记忆。

## 5. 硬约束（贯穿全程）

- 不跳阶段：Phase 1 未全部完成不进 Phase 1 卡点；卡点未完成不进 Phase 2。
- 写作期不回头临时查：Phase 2 发现缺字段，回 Phase 1 走采集与 Gap Check 流程并更新 inventory，不在 Phase 2 临时 search/fetch 绕过。
- 零幻觉、可追溯：正文每个数据、融资额、用户数、人名、时间、引用都能回溯到 inventory 的具体字段；inventory 没有的，标状态，不补全、不编造。
- 口径不混：网站访问量 ≠ MAU；下载量 ≠ 活跃用户；社媒粉丝 ≠ 用户规模；自报用户 / 注册 / MAU / DAU / 付费 / ARR 分别记录。
- 不抄表：inventory 是证据总账，正文是解读层。不得把 inventory 表格逐字搬进正文当分析。
- 不读无关模板：只读第 2 节列出的文件。

## 6. 脚本

可用本机脚本执行时，确定性操作走脚本，相对本 skill 目录解析。完整深度调研优先用根目录 `run.py`；以下命令用于恢复、诊断或手动分阶段：

```bash
python3 scripts/research_helper.py new-run --product "<产品名>"
python3 scripts/research_helper.py stage-status --run-dir <run_dir>
python3 scripts/research_helper.py validate-inventory --inventory <inventory.md>
python3 scripts/research_helper.py checkpoint --run-dir <run_dir> --stage stage1
python3 scripts/research_helper.py validate-report --report <report.md> --inventory <inventory.md>
python3 scripts/research_helper.py opencli-check
python3 scripts/research_helper.py opencli-run --platform youtube --query "<产品名>" --raw-dir <raw_dir>/opencli
python3 scripts/research_helper.py export --input <report.md> --title "<标题>" --target local_markdown
```

无本机脚本执行能力时，以下等价物全部强制、不可因无脚本而跳过：

- `new-run` → 在运行时提供的唯一 per-run 目录手动建 `inventory.md` / `report.md` / `meta.json` / `raw/`，不复用固定产品级路径，并在 `meta.json` 记录「无脚本」限制。
- `stage-status` → 手动检查上述产物是否存在/非空，据此判定当前阶段，不靠对上次对话的记忆。
- `validate-inventory` / `validate-report` → 按 `inventory.md` 的缺口检查与一致性硬规则、`writing.md` 的最终检查清单逐条人工核对，记录结论。
- `checkpoint` → 在 run 目录手动写 `checkpoint_stage1.md` / `checkpoint_stage2.md`，含 run 目录、各产物路径、校验结论、剩余证据限制、下一阶段指令。
- `opencli-run` → 按 `references/inventory.md` 第 4.2 节手动执行 opencli 并把原始输出存入 `raw/opencli`，保留确切命令日志。

## 7. 阶段隔离

Phase 1 卡点后必须先通过 `validate-inventory`，再创建卡点交接：

```bash
python3 scripts/research_helper.py validate-inventory --inventory <inventory.md>
python3 scripts/research_helper.py checkpoint --run-dir <run_dir> --stage stage1
```

证据丰富或采集量大的 run，卡点后停止，Phase 2 在全新上下文继续：只读已冻结的 `inventory.md` 与 `references/writing.md`，仅用定向片段打开 raw，不把采集上下文带进写作。不得以「上下文还安全」为由跳过这条隔离。根目录 `run.py` 已按此规则拆成 Stage 1 / Stage 2 两个 headless 进程。

交互式 fallback 也必须完成同等隔离：若不能创建 checkpoint、不能运行验证、不能保留 raw 证据，就停在当前阶段并交接缺口，不输出完整报告。不要用聊天里的“看起来差不多”替代验证文件。

## 8. 输出与交接

正文是文档交付目标（local_markdown / obsidian / notion / feishu / lark）的唯一 canonical Markdown 源。聊天 / IM 只承载最终交接通知（在哪读报告、哪些导出成功或失败、影响判断的来源缺口、本地 canonical 路径），不作为报告导出目标。导出与同步细节读 `references/delivery.md`。

结束时给一段简洁交接：报告位置、用到的导出目标、本地 canonical 路径、导出失败（若有）、影响解读的来源/工具覆盖缺口。不进入交互模式。
