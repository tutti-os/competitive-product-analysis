# Product Swipefile

一个用 Claude 模型，会跑得很好的产品调研 skill。
描述"调研一下 xxx"，帮你输出一份结构稳定、所有内容都有证据可回溯的 GTM 深度拆解报告。

## 做这个 skill 的原因很简单

有一句断言是说，vibe coding 已经拉平了产品的开发门槛，未来的比拼在 GTM。那很多很棒的产品，他们的 GTM 路径到底是什么呢？如果想通过调研去"偷师"，交给 agent 这个方式已经非常成熟了：讲清楚上下文，附加一句"调研一下 xxx 产品"，很快就会有一份回答，甚至是一份报告。

但认真跑过几次就会发现，调研的内容并不能拿来直接用。

"通过开发者社区病毒式传播""达人合作""凭借优秀的产品体验赢得口碑"，这些话说的都对，可具体怎么做呢？在哪个社区，合作了什么达人，讲了什么内容，什么时间节奏，这些真正能帮我们更快"出师"的方法，好像并不多。

这个 skill 想做的，就是把产品调研变成一份你半年后还能拿出来再看的拆解。甚至有的时候，还能帮你在面试前避避雷。

## 具体是两件事

**第一，内容详实，结构稳定。** 17 个模块分别是：数据快照、品牌定位、竞品基准线、产品传播力、冷启动、增长路径、用户画像、商业化、传播 Roadmap、创作者策略、官方渠道、广告、信任、留存、市场差异、Notable Absences、可借鉴结论。每个模块都做了"应该在哪些渠道获取数据"的收敛。每次调研都按这一套走，多调研几个就能横向对比。

**第二，和人一样，先取证，证据足够详细了再分析撰写。** 报告里每个判断都能查到出处。Skill 强制先把公开证据梳理成一份事实总账（`inventory.md`），期间证据不充分时，还会反复做多次 gap check，最终再基于它写报告。写作阶段不再联网搜索，只用已经盘好的证据。没有证据的地方就明确标记，不糊弄，不瞎推断。

## 跑出来的案例给大伙瞧瞧（最终你跑出来的结果 & 内容结构类似）

![Lovart 调研报告示例](assets/lovart_report.png)

## 安装

把这个仓库放到 skills 目录：

```bash
git clone https://github.com/nothingbutcici/product-swipefile ~/.claude/skills/product-swipefile
```

或手动复制整个目录到 `~/.claude/skills/`。

## 用法

### 在 Claude Code 里直接说

```
> 调研一下 Notion
> research Cursor
> 分析一下 xxx 产品
```

skill 自动触发，按你的目标语言产出报告。支持本地 Markdown、飞书、Notion、Obsidian（推荐）。

> 备注：Notion 需要配 API，飞书 / Lark 需要配 connector；没配好的话，报告会先在本地暂存。

整个报告从取证、撰写到质量评估落稿，时长约 20-60 分钟，具体看产品公开证据多寡。

## 你会拿到什么

- **`report.md`**：17 模块完整报告，每个判断带状态标记
- **`inventory.md`**：证据总账，正文每个事实都能在这里查到出处
- **`raw/`**：原始来源缓存（网页、命令输出、转录）
- **`meta.json`**：标题加一句话摘要

## 架构

skill 用渐进式披露。SKILL.md 是入口，其他文件按阶段才加载：

| 文件 | 作用 | 加载时机 |
|---|---|---|
| `SKILL.md` | 入口、触发边界、阶段顺序、硬约束 | 每次触发 |
| `references/inventory.md` | 采集规范、9 节 inventory 结构、来源族、状态词表 | Stage 1 |
| `references/writing.md` | 17 模块写作契约、表格 schema、深度要求 | Stage 2 |
| `references/delivery.md` | 导出、本地产物规则 | 完成时 |
| `scripts/research_helper.py` | 建 run 目录、校验器、opencli 封装 | agent 按需调用 |
| `run.py` |  headless launcher 实测跑完效果很好 | Agent 自行调用 |

### 如果你好奇 scripts/ 里都是些什么文件

它们是 AI 在调研过程中自动调用的工具集，不用担心风险问题！以下是分工：

| 文件 | 它是什么 | 为什么需要它 |
|---|---|---|
| `research_helper.py` | **所有功能的命令总入口** | AI 建调研目录、跑校验、抓 YouTube 视频等，都从这一个文件进。 |
| `product_research/__init__.py` | 一个**空文件**， Python 会把这个文件夹识别成可导入的代码包 | Python 的规则要求，不写就没法 `from product_research import ...`。 |
| `product_research/lib.py` | **底层工具盒**：路径常量、状态词表（`verified` / `not_public` 等）、读写 JSON、解析 markdown 表格这些通用函数 | 其他文件都会用到，写一份大家共享，避免重复。 |
| `product_research/validators.py` | **质量检查员**：检查 AI 写的 inventory 和 report 是否符合规范 | 如果 inventory 还有未完成项就不让进入写作阶段；如果 report 章节缺失或抄表当分析就标记失败。是抗 AI 偷懒的关键。 |
| `product_research/runs.py` | **调研目录管家**：为每次调研建一个独立工作目录、记录到了哪一步、生成阶段交接文件 | 一次调研有几十个产物（inventory、报告、原始材料、日志），需要个地方井井有条地放。 |
| `product_research/opencli.py` | **平台抓取助手**：调用 opencli 外部工具，获取 X / YouTube / 小红书 / Bilibili / Reddit 等平台的详细内容数据 | 网页搜索只能搜到摘要，opencli 能拿到平台内的真实数据（比如粉丝数、内容原文、评论等）。 |
| `product_research/settings.py` | **配置读写**：管理 `~/.config/product-swipefile/settings.json` | 之前设置过的语言、存储地址都在这里，比如"报告语言为中文、报告存储到 Obsidian"，配置一次，永远生效。 |
| `product_research/exporters.py` | **导出器**：把最终报告导出到 Obsidian / Notion / 飞书 / Lark 这些云笔记 | 报告永远在本地有一份，这里负责"分发存储一份到你的笔记软件中，阅读体验会更好"。可选功能。 |



## 使用要求

- **Claude CLI**：`claude` 在 PATH 里。Claude Code 自带，或单独装 [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)。
- **Python 3.10+**：跑 `scripts/research_helper.py`。
- **opencli**（可选）：获取 X / YouTube / 小红书 / Bilibili 等平台详细内容时用，没安装会自动 fallback 到 WebSearch。如果希望报告质量比较好，建议安装哦～ 

## 鸣谢

灵感来自 vibe coding 的实践：让非工程师也能造出认真的东西。调研方法论是我自己长期使用过程中，多轮迭代沉淀下来的。

特别感谢 [opencli](https://github.com/jackwener/opencli)（[@jackwener](https://github.com/jackwener)）。平台数据靠它才能拿到站内真实内容，这个 skill 的调研深度很大程度上得益于这个出色的开源工具。

## License

MIT。用、改、分享，随意。
