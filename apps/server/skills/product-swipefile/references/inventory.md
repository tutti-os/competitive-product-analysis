# 产品调研 Inventory 规范

用途：指导 Phase 1 抓取公开信息、生成事实总账，并在写正文前完成 Gap Check。Inventory 是采集阶段和 Phase 2 正文写作之间的事实总账；正文必须能回溯到它，且不得引入它没有的事实。

## 1. Inventory 文件结构

生成本次 run 的 `inventory.md`，必须包含以下各节：

```markdown
# <产品名> 调研 Inventory

## 产品身份
## 竞品边界
## 研究计划
## 按市场、产品形态与受众确定覆盖
## 宽索引
## 深度证据
## 标准化事实
## 传播事件簇
## 缺口检查
```

## 状态 token（统一使用）

状态列只用以下 token，不翻译、不改写、不混用其他写法：

- 事实强度：`verified` / `uncertain` / `inferred` / `estimated`
- 缺失原因：`not_public` / `not_found` / `unavailable` / `blocked` / `login_required` / `syntax_unknown` / `not_checked` / `not_applicable`
- 计划覆盖：`pending` / `done`
- 广告状态：`active_ads_found` / `historical_ads_found` / `no_public_ads_found` / `library_unavailable` / `blocked` / `not_checked` / `not_applicable`
- 章节就绪：`ready` / `thin_but_explained` / `collection_gap` / `not_applicable`

工具失败、登录、反爬、地区限制写 `unavailable` / `blocked` / `login_required`，不得写成 `not_found`。

专有名词、指标值、URL、平台标识（如 Notion、$400M ARR、http 链接、X / Twitter、GitHub、opencli）保留原样；引用原文与报告输出语言不一致时，保留原文并在下方翻译成报告输出语言；二者一致时不翻译。

## 2. 产品身份

用于消歧、确认调研对象、确定抓取范围。

| 字段 | 结果 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 产品名 | | | verified / uncertain | |
| 官网 / 主域名 | | | verified / uncertain | |
| 公司主体 | | | verified / uncertain / not_public | |
| 创始人 / 核心团队 | | | verified / uncertain / not_public | |
| 成立时间 | | | verified / uncertain / not_public | |
| 调研日期 | | 系统日期 | verified | Roadmap、近 30/90 天口径以此为基准 |
| 所属市场 | 海外 / 国内 / 双线 / 出海回流 | | verified / inferred | |
| 产品形态 | Web / SaaS / App / 开源 / 硬件 / 服务 | | verified / inferred | 可多选 |
| 目标受众 / 商业类型 | B2B / Prosumer / ToC / Creator / Developer / Enterprise | | verified / inferred | 可多选 |
| 同名风险 | 有 / 无 | | checked | 有则填写同名排除表 |

同名排除表：

| 同名对象 | 排除理由 | 来源 |
|---|---|---|

## 3. 竞品边界

广泛采集前先定义竞品集。基准应比较「用户为同一件事会在它们之间做选择」的产品，不是价值链上每一个相邻公司。

层级：

1. 一级品类：宽市场，如 AI、设计软件、开发工具、金融科技、CRM。
2. 二级品类：具体产品品类，如 AI 视频、AI 图像、AI coding agent、社媒排期、客服机器人。
3. 用户工作：用户雇这个产品去完成的实际任务。
4. 买家 / 用户分群：消费者、创作者、prosumer、SMB、企业、开发者、营销、设计等。
5. 替代路径：标签不同但解决同一用户工作的产品。

纳入竞品基准线：

- 同二级品类的直接竞品。
- 用户会主动比较或切换、且替代同一核心产出或核心工作流的任务替代品。仅共享宽受众、宽品类或灵感模式不算。
- 报告覆盖多市场时，纳入区域等价产品。

排除出竞品基准线：

- 上游供应商、基础设施、模型供应商、硬件商、云厂商、市场平台、联盟、代理、分发渠道，除非用户为同一工作直接在它们之间选择。
- 不解决同一二级任务的宽一级邻居。例：AI 图像工具不是 AI 视频产品的默认竞品；Nvidia 不因处于上游就成为某 AI 模型公司的竞品。
- 只对战术有启发、但不在用户选择集里的灵感案例。放进宽索引或可借鉴结论，不放竞品基准线。

竞品候选筛选表：

| 候选 | 一级品类 | 二级品类 | 用户工作重叠 | 分群重叠 | 关系 | 纳入基准线? | 理由 |
|---|---|---|---|---|---|---|---|

关系列受控 token：`direct_competitor` / `task_substitute` / `regional_equivalent` / `adjacent_reference` / `upstream` / `downstream` / `distribution_channel` / `not_competitor`

若有效同品类竞品很少，不要用糟糕对照凑数。用有效竞品集，写明品类或公开对照集稀疏，只在真实成立处用 `not_applicable` / `not_found`。质量问题是「对照对错」，不是「数量多少」。

## 4. 研究计划

研究计划只定义来源覆盖，不为每个正文模块单独扩展 schema。每个证据族都因为支撑某个正文章节问题而存在，不做泛化堆料。

| 证据族 | 适用 | 工具 | 目标来源 | 支撑模块 | 状态 |
|---|---|---|---|---|---|
| 身份与官方叙事 | 是 | WebFetch | 官网、about、docs、pricing、blog、changelog、官方社媒 | 0/1/3/7/8/10/12 | pending |
| 产品体验与功能 | 是 | WebFetch + WebSearch | landing、demo、onboarding、docs、模板、案例、App Store、Google Play、GitHub | 3/13/16 | pending |
| 商业化与硬数据 | 是 | WebFetch + WebSearch | 定价、付费墙、融资、收入、用户披露、SimilarWeb、Sensor Tower | 0/6/7 | pending |
| 竞品基准线 | 是 | WebSearch + WebFetch + opencli | 通过竞品边界筛选的同二级品类玩家或任务替代品的官网、定价、产品、内容、社区、PR | 2/3/7/12/16 | pending |
| 传播节点与 PR | 是 | WebSearch + WebFetch | 发布报道、融资报道、媒体、ProductHunt、活动、公告 | 4/5/8/15 | pending |
| 官方内容渠道 | 是 / 否 | WebFetch + opencli | 官网确认官方账号；opencli 抓活跃度、粉丝和互动 | 8/10 | pending |
| 创作者 | 是 / 否 | opencli | 按命中市场和平台展开 | 5/8/9 | pending |
| 用户与社区声音 | 是 / 否 | opencli + WebFetch | Reddit、ProductHunt、Hacker News、X thread、评论区、App 评论、Discord/社区 | 3/4/6/13 | pending |
| 广告投放 | 是 / 否 | WebFetch + WebSearch + 平台广告库 | Meta Ad Library、Google Ads Transparency、TikTok/Reddit/LinkedIn 等公开广告库、平台投放线索 | 8/11 | pending |
| 信任与合规 | 是 / 否 | WebFetch + WebSearch | 客户案例、安全页、隐私政策、合规声明、备案、状态页、开源社区 | 12/14 | pending |
| 中国市场变量 | 命中中国市场时 | opencli + WebFetch + WebSearch | 中文平台、备案、微信生态、中文媒体、国内竞品、本地化叙事 | 14 及相关模块 | pending |

### 4.1 来源级覆盖明细

每个证据族都要拆到具体来源或平台。研究计划某一行只有在其适用来源均完成状态标记后，才可标 `done`。下表是结构模板，不是完整来源清单；实际执行必须按市场、产品形态与受众扩展到所有适用来源。

| 证据族 | 具体来源 | 展示名 | 工具 / 参数 | 覆盖状态 | 结果摘要 | 支撑模块 | 备注 |
|---|---|---|---|---|---|---|---|
| 官方内容渠道 | X / Twitter | X / Twitter | opencli: twitter + 官网链接核验 | pending | | 8/10 | |
| 创作者 | YouTube | YouTube | opencli: youtube | pending | | 5/8/9 | |
| 创作者 | TikTok | TikTok | opencli: tiktok | pending | | 5/8/9 | |
| 中国市场变量 | 小红书 | 小红书 | opencli: xiaohongshu | pending | | 9/10/14 | |

### 4.2 OpenCLI 执行硬规则

OpenCLI 是渠道抓取工具。研究计划中工具包含 `opencli` 的来源，必须留下实际命令日志；只在计划表写 `opencli` 不算完成覆盖。

执行要求：

1. Phase 1 开始后先确认本机 OpenCLI 是否可用（优先 `python3 scripts/research_helper.py opencli-check`，否则 `opencli --help`）。
2. 平台命令语法不确定时，先运行 `opencli <platform> --help`。
3. 对每个适用平台至少执行一次搜索或账号抓取命令；命令失败则记录失败原因并用 WebSearch/WebFetch 补充。
4. OpenCLI 不可用、未登录、反爬、地区限制或报错时，状态写 `unavailable` / `blocked` / `login_required`，不得写 `not_found`。
5. 工具包含 `opencli` 的平台，没有命令日志时，覆盖状态不得标 `done`。

OpenCLI 命令日志：

| 平台 | 目的 | 实际命令 | 状态 | 命中摘要 | 后续处理 |
|---|---|---|---|---|---|
| X / Twitter | 搜索产品声量 | `opencli twitter search "<产品名>"` | pending | | |
| YouTube | 搜索评测/教程 | `opencli youtube search "<产品名>"` | pending | | |
| 小红书 | 搜索中文种草 | `opencli xiaohongshu search "<产品名>"` | pending | | |

命令形态（示例，非穷举；本 .md 不维护第二份完整命令目录，避免与脚本目录漂移）：

- 搜索某平台：`opencli <platform> search "<query>"`（先用 `opencli <platform> --help` 确认语法）
- 读取具体对象：用平台帮助里的对象命令（post / thread / video / comment / detail / user 等）
- 下载微信公众号全文：先定位 `mp.weixin.qq.com` URL，再 `opencli weixin download --url <url>`

平台 → opencli 参数映射见第 12 节。确切子命令以 `opencli <platform> --help` 为准；可用脚本时优先 `python3 scripts/research_helper.py opencli-run`。脚本与本文件冲突时，以本文件的证据规则为准。

工具边界：

- LinkedIn：`opencli linkedin search` 主要搜职位；公司页、创始人页、帖子优先 WebSearch/WebFetch，opencli 只作登录态时间线或职位信号补充。
- 微信公众号：先用 WebSearch/WebFetch 找到 `mp.weixin.qq.com` 文章 URL，再用 `opencli weixin download --url <url>` 下载全文；opencli 不负责公众号搜索。
- ProductHunt：opencli 适合查当日/近期榜单；具体产品历史页优先用 WebSearch/WebFetch 定位 URL 再深抓。

## 5. 按市场、产品形态与受众确定覆盖

本节是强制覆盖下限，与第 4 节不同轴、不重复：第 4 节定义「为什么收集」（证据族 → 章节），本节定义「按本产品类型，哪些具体来源不可跳过」。缺第 4 节会收集跑偏；缺本节会该查的没查、只查几个来源就停。两节都要执行。

规则：命中某个市场、产品形态或受众类型时，对应基础来源都要检查；查不到也要记录为 `not_found` / `unavailable` / `not_applicable`；同一产品可命中多个类型，合并所有基础来源；优先级只决定深抓顺序，不决定是否跳过来源。

执行顺序：先查官网/定价/docs/about/blog/changelog 确认身份与范围 → 按市场范围选海外或中国基础必查 → 按产品形态或受众追加必查 → 合并去重写入研究计划与来源级覆盖明细。

### 5.1 海外市场基础必查

- 官方：官网、定价、docs、blog、changelog、官方社媒
- 数据：SimilarWeb、Google Trends、融资、收入、用户披露
- 创作者平台：X / Twitter、YouTube、Instagram、TikTok、LinkedIn
- 社区节点：Reddit、Hacker News、ProductHunt
- 媒体与 PR：英文媒体、融资报道、发布报道
- 竞品：同赛道海外竞品的官网、定价、核心叙事、渠道动作

### 5.2 中国市场基础必查

- 官方：官网、备案、中文官网、中文社媒、公众号
- 数据：备案、融资、收入、用户披露、下载量、中文搜索热度
- 创作者平台：小红书、哔哩哔哩、抖音、微信公众号、视频号、知乎、微博
- 微信生态：公众号、视频号、小程序、社群线索
- 媒体与 PR：中文媒体、融资报道、发布报道
- 竞品：国内同赛道玩家的官网、定价、本地化叙事、渠道动作

### 5.3 产品形态与受众额外必查

| 类型 | 额外必查 |
|---|---|
| Web / SaaS | SimilarWeb、定价页、docs、changelog、状态页、SEO 页面、客户案例 |
| App | App Store、Google Play、下载排名、评论、版本记录、TikTok、小红书、短视频平台 |
| 开源 | GitHub stars/forks/issues/releases、README、docs、Discord/社区、HN、Reddit、开发者创作者 |
| B2B / Prosumer | LinkedIn、客户案例、定价、团队规模、创始人、行业媒体、竞品定价 |
| ToC / Creator | TikTok、Instagram、YouTube、小红书、哔哩哔哩、抖音、UGC、评论区 |
| 硬件 / 服务 | 官网规格、渠道售卖、评测、售后、交付、认证、用户评价 |

## 6. 宽索引

宽索引记录可筛选线索，不要求全文，服务所有正文模块。宽索引线索不能直接支撑正文强判断；凡进入正文判断、引用、表格或结论的线索，必须升级为深度证据或标准化事实。

| 时间 | 来源 / 平台 | 类型 | 对象 | 作者 / 账号 | 标题 / Hook | 原始指标 | 摘要 | URL | 支撑模块 | 深抓? |
|---|---|---|---|---|---|---|---|---|---|---|

类型列受控 token：`official` / `product` / `data` / `media` / `creator` / `user` / `community` / `founder` / `ad` / `competitor` / `customer` / `compliance`

创作者线索摘要必须保留平台、账号、粉丝/订阅、内容形式、合作信号和受众匹配线索。

## 7. 深度证据

以下内容需要深抓：

1. 官方关键材料：hero、定价页、发布页、blog、changelog、manifesto、融资公告。
2. 产品体验证据：demo、onboarding、核心功能、模板、案例、App 版本记录、GitHub release。
3. 重大传播节点：尽量覆盖官方动作、媒体报道、创作者、代表性用户反馈和效果信号；缺失项写入缺口检查。
4. 高影响第三方内容：高互动 X thread、YouTube 视频、小红书、微信公众号、哔哩哔哩等。
5. 用户与社区证据：评论区、App 评论、Reddit、Hacker News、ProductHunt、Discord/社区讨论。
6. 信任与合规证据：客户案例、安全页、隐私政策、合规声明、备案、开源社区、状态页。
7. 广告证据：广告素材、投放平台、落地页、活跃状态、投放时间。
8. 异常内容：负面、危机、争议、竞品点名、与官方叙事冲突的用户声音。

### 7.1 广告投放证据口径

广告投放不能只写 `not_found`。必须区分「已检查但未见公开广告」与「广告库不可抓取 / 被拦截 / 未完成检查」。

广告检查表：

| 广告平台 | 检查入口 | 查询词 / domain | 状态 | 证据链接 | 局限 | 判断 |
|---|---|---|---|---|---|---|
| Meta Ad Library | facebook.com/ads/library | 品牌名 / 公司名 / 域名 | not_checked | | | |
| Google Ads Transparency | adstransparency.google.com | 品牌名 / 公司名 / 主域名 | not_checked | | | |
| 平台广告库 / 平台内线索 | TikTok / Reddit / LinkedIn / App Store 等 | 品牌名 / 域名 / app name | not_checked | | | |

判断规则：

- 只有检查过 Meta Ad Library、Google Ads Transparency 及与产品主要传播平台相关的公开广告库或平台线索后，才可写 `no_public_ads_found`。
- 广告库无法抓取、需登录、地区限制、接口不可用或反爬时，写 `library_unavailable` / `blocked`，不得写 `no_public_ads_found`。
- 创作者的 `#ad`、`#sponsored`、付费合作属于创作者合作信号，不等同平台广告投放；如同时出现，分别记录。
- 无公开广告证据时，正文只能写「公开广告库未见投放证据」或「广告库不可验证」，不能写「没有投广告」。

每条证据使用以下结构：

```markdown
### 证据 N: <标题>
- 类型:
- 时间:
- 来源:
- URL:
- 指标:
- 关联事件簇:
- 支撑模块:
- 证据用途:
- 关键事实:
- 可引用原文:
  > 原文（仅当原文措辞本身有证据价值）
  中文翻译（仅当原文非中文）
  解读（仅当有用）
- raw 缓存: 指向本次 run 的 raw 路径
```

关键事实不能只写一句泛摘要，必须保留足够上下文，使正文阶段不重新搜索也能完成事实判断。原文很长时缓存 raw 文件，证据条只记可复用事实、指标、时间和结论边界。

## 8. 标准化事实

### 8.1 标准硬数据表

本表用于「0. 数据快照」与全局事实引用。

| 字段 | 值 | 口径 | 来源 | 时间 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 产品名 | | official name | 官网 | | verified | |
| 主域名 | | domain | 官网 | | verified | |
| 调研日期 | | 执行日期 | 系统日期 | | verified | |
| 公司主体 | | 法律实体 | 官网/工商/LinkedIn | | verified/uncertain/not_public | |
| 成立时间 | | founded date | Crunchbase/工商 | | verified/uncertain/not_public | |
| 团队规模 | | employees | LinkedIn/官网 | | verified/estimated/not_public | |
| 创始人 | | 创始人身份 | LinkedIn/媒体 | | verified/uncertain | |
| 历轮融资 | | funding rounds | Crunchbase/媒体 | | verified/uncertain/not_public | |
| 估值 | | valuation | 融资报道 | | verified/uncertain/not_public | |
| ARR / 收入 | | revenue / ARR | 官方/媒体 | | verified/inferred/not_public | |
| MAU / DAU | | 活跃用户 | 官方披露 | | verified/not_public | 不得用 visits 代替 |
| 注册用户 / 付费用户 | | 用户数 | 官方/媒体 | | verified/not_public | |
| 网站月访问 | | visits，非 MAU | SimilarWeb | | verified/unavailable | |
| 流量地理/来源/画像 | | 网站流量 | SimilarWeb | | verified/unavailable | 不等同真实用户画像 |
| 下载量 | | app downloads | Sensor Tower / Store | | verified/unavailable/not_applicable | |
| 官方社媒账号 | | followers / subscribers | opencli | | verified/not_found/unavailable/blocked/login_required/syntax_unknown | 按平台拆分 |
| ProductHunt / Reddit / HN | | launch / discussion | opencli | | verified/not_found/unavailable/blocked | |
| 广告投放 | | 活跃/历史/未见公开/广告库不可用 | 广告库 | | active_ads_found/historical_ads_found/no_public_ads_found/library_unavailable/blocked/not_checked/not_applicable | |

### 8.2 模块结构化事实表

跨模块复用的聚合事实进入本表。

| 对象类型 | 对象 | 字段 | 值 | 口径 | 来源 | 时间 | 状态 | 支撑模块 |
|---|---|---|---|---|---|---|---|---|

对象类型受控 token：`product` / `competitor` / `official_account` / `founder` / `creator` / `user_segment` / `ad` / `customer` / `compliance` / `absence`

常见字段：

- `competitor`：一级/二级品类、关系、用户工作重叠、纳入基准线决策、融资/估值、用户/流量/收入、定价、核心叙事、产品架构、模型/技术、移动端、海外 PR、中文社区。
- `official_account`：平台、账号、粉丝/订阅、近 30 天发文数、近 90 天发文数、内容类型、互动数据、渠道角色。
- `creator`：平台、账号、层级、粉丝/订阅、代表内容指标、内容垂类、合作信号、合作价值。
- `user_segment`：职业、地域、使用场景、痛点、传播倾向、来源口径。
- `ad`：投放平台、检查入口、查询词/domain、广告状态、素材主题、落地页、投放时间、目标、局限。
- `customer` / `compliance`：客户案例、安全页、隐私政策、合规声明、备案、状态页、开源社区。
- `absence`：已覆盖但未见结果的高解释价值事项。

### 8.3 Claim Ledger

正文关键判断进入 Claim Ledger。它不替代证据，只记录结论的证据支撑。

| 模块 | 判断 / 事实 | 证据 ID | 口径 | 置信度 | 状态 | 备注 |
|---|---|---|---|---|---|---|

## 9. 传播事件簇

事件聚类还原传播脉络，不按自然月机械平铺。无明显动作的月份合并为「沉默期 / 产品迭代期」。

| 事件簇 | 时间范围 | 地域 | 官方/产品动作 | 媒体/PR | 创作者 | 官方内容/广告 | 用户反馈 | 效果信号 | 竞品同期 | 置信度 |
|---|---|---|---|---|---|---|---|---|---|---|

每个事件簇使用 10 项框架：

```markdown
### <事件簇名称>
1. 触发事件:
2. 官方叙事:
3. 产品变化:
4. 媒体 / PR:
5. 创作者:
6. 官方内容 / 广告:
7. 用户反应:
8. 效果信号:
9. 竞品同期:
10. 判断:
```

## 10. 缺口检查

写正文前完成缺口检查。

| 模块/事件 | 应有证据 | 当前证据 | 缺口 | 处理 |
|---|---|---|---|---|
| 数据快照 | 官网/融资/流量/社媒/定价 | | | 补抓 / not_public |
| 节点 1 | 官方/媒体/创作者/用户/效果/竞品 | | | 补抓 / 降置信度 |

### 10.1 章节级 Inventory Readiness 诊断

这是诊断闸门，不是数量闸门。它判断每章是否有足够证据回答其问题。稀疏只在原因明确且来源覆盖有记录时可接受。

就绪标签（受控 token）：

- `ready`：有足够证据回答该章问题。
- `thin_but_explained`：因产品新、品类稀疏、事实未公开或来源在已覆盖后受阻而稀疏。
- `collection_gap`：计划内来源族或相关平台未被充分检查。
- `not_applicable`：该章对本产品或市场范围不适用。

处理规则：`ready` → 正常写并保留关键证据；`thin_but_explained` → 写窄结论并说明证据限制；`collection_gap` → 回采集再写；`not_applicable` → 在允许处明确标注。

一致性硬规则：标 `ready` 的章节，必须能在深度证据 / 标准化事实 / 传播事件簇 中找到带 URL 或来源的可追溯证据指向它。标 `ready` 却零可追溯证据 = 自相矛盾，必须改为采集或如实降级。

采集深度纪律：标 `ready` 的章节，其支撑证据应优先来自深抓并缓存进 `raw/` 的一手来源（官方页、媒体长文、访谈、评论/弹幕、命令输出），而不是只停留在搜索结果摘要的转述。若某章只有搜索摘要级证据，标 `thin_but_explained` 并写明这一限制，不要把摘要级证据当成 `ready` 的确证支撑。

写作前必须填完章节就绪表。`Readiness` 单元格只能填一个受控 token，不要写 `ready / thin_but_explained` 这种候选占位。`依据/证据指针` 写证据编号、URL、raw 文件名或明确的来源行；`解释或下一步` 写为何足够、为何稀疏、为何不适用，或下一步回采集什么。

| 正文章节 | Readiness | 依据/证据指针 | 解释或下一步 |
|---|---|---|---|
| 0 数据快照 | | | |
| 1 品牌定位 | | | |
| 2 竞品基准线 | | | |
| 3 传播力与亮点 | | | |
| 4 冷启动 | | | |
| 5 增长路径 | | | |
| 6 核心用户画像 | | | |
| 7 商业化节奏 | | | |
| 8 传播 Roadmap | | | |
| 9 创作者策略 | | | |
| 10 官方内容渠道 | | | |
| 11 广告策略 | | | |
| 12 信任构建 | | | |
| 13 留存反哺传播 | | | |
| 14 中国/全球市场差异 | | | |
| 15 Notable Absences | | | |
| 16 可借鉴结论 | | | |

### 10.2 章节级支撑检查

| 正文模块 | 必须有的证据形态 | 主要依赖 | 不足时处理 |
|---|---|---|---|
| 0 数据快照 | 标准硬数据和状态 | 标准硬数据表 | 标 not_public / unavailable |
| 1 品牌定位 | 官方叙事 + 用户/媒体接收信号 | 官方 / 媒体 / 用户 | 降低定位判断强度 |
| 2 竞品基准线 | 竞品边界筛选 + 同二级品类竞品可比字段 | 竞品 / 标准化事实 | 补抓或缩小竞品集，不凑数 |
| 3 传播力与亮点 | Aha Moment + 官方/用户/媒体/创作者四类信号 | 官方 / 产品 / 用户 / 媒体 / 创作者 | 标为「品牌主张未被验证」 |
| 4 冷启动 | 上线时间、首批用户来源、早期动作 | 传播事件簇 / 官方 / 社区 | 补抓上线窗口 |
| 5 增长路径 | 增长机制、渠道变化、效果信号 | 传播事件簇 / 标准化事实 / 宽索引 | 标机制证据不足 |
| 6 核心用户画像 | 官方目标用户 + 行为/评论/流量画像 | 官方 / SimilarWeb / 用户 | 区分访问者画像和真实用户 |
| 7 商业化节奏 | 定价、付费墙、竞品价格、商业化节点 | 官方 / 竞品 / 标准化事实 | 标 not_public 或 inferred |
| 8 传播 Roadmap | 时间线、事件簇、渠道动作、效果信号 | 传播事件簇 / 深度证据 | 合并沉默期或降置信度 |
| 9 创作者策略 | 平台、账号、层级、指标、合作信号 | 创作者 / 宽索引 / 结构化事实 / 深度证据 | 标平台覆盖不足 |
| 10 官方内容渠道 | 官方账号、粉丝规模、发文频率、内容类型、互动、创始人 IP、内容质量 | 官方 / 创始人 / 宽索引 / 结构化事实 | 标 not_found |
| 11 广告策略 | 投放平台、检查入口、广告状态、素材、目标、是否活跃 | 广告 / 结构化事实 / 深度证据 | 标 no_public_ads_found / library_unavailable / blocked |
| 12 信任构建 | 客户、案例、安全、合规、背书 | 官方 / 媒体 / 客户 / 合规 | 标信任证据不足 |
| 13 留存反哺传播 | UGC、模板、社区、工作流或数据绑定 | 产品 / 用户 / 社区 | 标飞轮未验证 |
| 14 中国/全球市场差异 | 中国特有变量、合规、本地化、国内竞品、全球对比 | 官方 / 社区 / 合规 / 竞品 | 不适用则标 not_applicable |
| 15 Notable Absences | 已覆盖但缺席的高解释价值动作 | 缺口检查 / not_found | 只写有解释价值的缺席 |
| 16 可借鉴结论 | 可复用动作 + 条件 + 不可复制边界 | Claim Ledger / 深度证据 | 不写泛化总结 |

## 11. 证据强度

每个重点传播节点按以下证据类逐项判断是否存在。前 4 类判断传播强度；第 5 类解释竞争环境。不要为了凑齐类别编造或扩写；缺哪一类就标对应状态，并说明它如何限制判断。

1. 官方动作：发布、更新、定价、活动、公告、创始人发声。
2. 第三方传播：媒体、创作者、社区讨论。
3. 用户反馈：评论、帖子、问答、评价、投诉、二创。
4. 效果信号：流量、搜索热度、下载、粉丝、互动、声量变化。
5. 竞品同期动作：同时段竞品是否有相似动作或反向缺席。

| 等级 | 条件 | 可写判断 |
|---|---|---|
| strong | 官方动作 + 第三方传播 + 用户反馈 + 效果信号均存在 | 可写明确传播判断 |
| medium | 官方动作和第三方传播存在，但用户反馈或效果信号不足 | 写有限判断并说明缺口 |
| weak | 只有官方或媒体单边证据 | 不写强传播结论，只写可见动作 |
| not_found | 关键来源完成覆盖后仍无证据 | 写缺席信号或标无法判断 |

## 12. 工具与渠道映射

| 展示名 | 常见别名 | opencli 参数 |
|---|---|---|
| X / Twitter | X, Twitter | `twitter` |
| Reddit | Reddit | `reddit` |
| Hacker News | HN, Hacker News | `hackernews` |
| ProductHunt | ProductHunt, Product Hunt | `producthunt` |
| YouTube | YouTube | `youtube` |
| TikTok | TikTok | `tiktok` |
| Instagram | Instagram | `instagram` |
| LinkedIn | LinkedIn | `linkedin` |
| 小红书 | 小红书, Xiaohongshu, RED | `xiaohongshu` |
| 哔哩哔哩 | 哔哩哔哩, Bilibili, B站 | `bilibili` |
| 抖音 | 抖音, Douyin | `douyin` |
| 知乎 | 知乎 | `zhihu` |
| 微信公众号 | 微信公众号, WeChat Official Account | `weixin` |
| 微博 | 微博, Weibo | `weibo` |

GitHub 用 `gh` 或 WebFetch，不作 opencli 渠道。Discord 需登录或客户端权限时标 `blocked` 或改 WebSearch/WebFetch 搜公开页。微信生态拆分：公众号用 `weixin`；视频号、小程序、群线索用 WebSearch/WebFetch 并记录可见范围。

## 13. 抓取停止规则

停止规则只适用于已完成覆盖检查的平台。未完成基础覆盖前，不因「暂时没看到高价值内容」跳过来源。

可停止同平台继续深抓的条件：

1. 该平台已完成覆盖检查，并在宽索引或缺口检查中留痕。
2. 连续多个结果页或批次无新事件、新叙事、新创作者或新争议。
3. 搜索结果开始重复，或主要为搬运、SEO 聚合。
4. 需进入正文的强判断已有深度证据或标准化事实支撑。

只覆盖单一信号时，在缺口检查标「传播证据不足」，并降低对应节点证据强度。
