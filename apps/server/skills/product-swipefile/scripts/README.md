# scripts/

Deterministic helpers that the skill (or any agent / user running the skill) calls during a product research run. **不是规则文档**——规则在 `references/`。这里只放确定性可重复的"机器活儿"。

## 谁调用这些

- **agent**（被 skill 触发后）在调研过程中会反复调用 `validate-inventory` / `validate-report` / `new-run` / `opencli-run` 等命令。
- **launcher**（顶层 `run.py`，可选）启动时调 `new-run`，退出后调 `validate-*`。
- **人类用户** 可选用 `init-settings` 配置持久默认值、`check-tools` 看当前状态。

## 入口

只有一个：

```bash
python3 scripts/research_helper.py <command> [args]
python3 scripts/research_helper.py --help          # 看所有命令
python3 scripts/research_helper.py <command> --help # 看单个命令参数
```

`research_helper.py` 自己只是 argparse 派发器；实现都在 `product_research/` 包里。

## 文件分工（6 个实现文件 + 1 个入口）

```
scripts/
├── research_helper.py          入口：argparse 派发，无业务逻辑
├── README.md                   本文件
└── product_research/
    ├── __init__.py             包标记（空）
    ├── lib.py                  常量 + 共享工具函数（路径、设置 shape、token 词表、has_any/has_table/load_json 等）。无项目内依赖
    ├── validators.py           ★ 质量闸门 ★ validate-inventory + validate-report，含 markdown 解析助手
    ├── runs.py                 run 生命周期：new-run / stage-status / checkpoint / check-tools
    ├── settings.py             持久配置：show-settings / init-settings + 目标就绪判断
    ├── opencli.py              opencli 包装：opencli-check / opencli-run，做状态分类（login_required/blocked/...)
    └── exporters.py            导出：local_markdown / obsidian / notion / feishu·lark
```

依赖方向：`lib` 是叶子（被所有人 import，自己不 import 别人）；`settings` 依赖 `lib`；`runs` 依赖 `lib + settings`；`validators` 依赖 `lib`；`opencli` 依赖 `lib`；`exporters` 依赖 `lib + settings`。无环。

## 命令清单与归属

| 命令 | 文件 | 用途 |
|---|---|---|
| `new-run --product X` | runs.py | 建唯一 run 目录，返回所有 artifact 路径 JSON |
| `stage-status --run-dir X` | runs.py | 看一个 run 目录现在在哪个阶段，下一步该做什么 |
| `checkpoint --run-dir X --stage stage1\|stage2` | runs.py | 写阶段卡点 markdown 文件 |
| `check-tools` | runs.py | 诊断：settings 状态 + opencli 是否可用 |
| `validate-inventory --inventory X` | validators.py | 内部一致性闸门：pending 残留、ready 无证据、缺 readiness、硬数据无状态、opencli 用了无日志 → fail |
| `validate-report --report X --inventory Y` | validators.py | 章节齐全 + 抄表否决（有表必有表外解读）+ 每章契约 |
| `show-settings` | settings.py | 打印当前 `~/.config/product-swipefile/settings.json` |
| `init-settings --language X --default-targets Y ...` | settings.py | 写持久设置，可选 `--complete-setup` 校验配置完整 |
| `opencli-check [--platform X]` | opencli.py | 检查 opencli 整体或某平台可用 |
| `opencli-run --platform X --query Y --raw-dir Z` | opencli.py | 跑搜索命令，把 stdout/stderr 缓存到 raw-dir，返回带状态分类的 JSON |
| `export --input X --title Y [--target Z]` | exporters.py | 把 canonical Markdown 导出到 local/obsidian/notion/feishu/lark 中的一个或多个 |

## 不该在这里出现的东西

- 业务规则（这些在 `references/inventory.md` 和 `references/writing.md`）。
- 模型 prompt（模板规则不应固化到 Python 字符串里）。
- 任何对 agent 行为的命令式约束（agent 读 `SKILL.md`，不读这里）。

scripts 只做确定性 helper：建目录、读写 JSON、解析 markdown 表格、执行外部命令并分类返回。它们是工具，不是规则。
