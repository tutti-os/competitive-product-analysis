# 导出与同步

用途：持久导出设置、本地 canonical 产物、交付行为、最终交接通知。

## 1. 原则

- **持久设置缺失时，按 SKILL.md 第 3 节首跑 setup 流程走一遍问完再开跑**（语言 + 目标 + 各目标配置 + 是否记住默认）。已有持久设置则直接用，不再问。
- 用户在请求里给一次性覆盖（"这次用英文"/"这次存 Obsidian"）→ 本次生效，不写入持久设置。
- 配置后用存储的语言输出，除非用户给一次性覆盖。
- 输出语言：中文 / 英文。指令文件用中文，互不影响输出语言。
- 默认产出完整调研报告，深度 deep，角度综合。
- 用存储的交付目标，除非一次性覆盖。交付目标多选，一次 run 可交付多个。
- 文档交付目标：`local_markdown` / `obsidian` / `notion` / `feishu` / `lark`。
- 聊天 / IM 只是通知面，承载最终交接通知，不是报告导出目标。

## 2. 设置

持久设置默认存于下面这个 standalone 路径；脚本支持用 `--path` 覆盖到别处（例如宿主提供的 app 数据目录，用于运行时隔离）：

```text
~/.config/product-swipefile/settings.json
```

形状：

```json
{
  "setup": { "completed": false },
  "language": "",
  "default_targets": [],
  "local_markdown": { "directory": "" },
  "obsidian": { "vault_path": "", "folder": "" },
  "notion": { "token_env": "NOTION_TOKEN", "parent_type": "", "parent_id": "", "title_property": "Name" },
  "lark": { "workspace": "lark", "mode": "connector", "connector_ready": false, "staging_dir": "~/.config/product-swipefile/exports/lark" },
  "feishu": { "workspace": "feishu", "mode": "connector", "connector_ready": false, "staging_dir": "~/.config/product-swipefile/exports/feishu" }
}
```

不存原始 API token，只存环境变量名。首跑按 SKILL.md 第 3 节问 opencli、`language`、`default_targets` 及所选目标需要的路径/集成项。`language` 是报告语言（中 / 英），不提供「双语」选项；引用翻译由 `writing.md` 控制。安装或加载 skill 本身不提问。

## 3. 目标就绪策略

开始研究前必须检查所有已选择交付目标。多选目标是承诺，不是偏好排序：

- 所有所选目标均就绪，才可把 setup 标为 completed 并开始调研。
- 任一所选目标未就绪，先补齐该目标配置；不静默降级为其他目标。
- `local_markdown`：目录已存在且可写，或目录不存在但父目录可写（导出时自动创建）。
- `obsidian`：必须有可访问 vault 路径；folder 可不存在，导出时创建。
- `notion`：必须配置 parent type、parent id，且 token 环境变量存在；真正成功以返回 page URL/id 为准。
- `feishu` / `lark`：必须有可用 cloud-doc connector/MCP/插件配置；真正成功以返回文档 URL/token 为准。
- 若目标在 Phase 4 临时失败，canonical Markdown 仍保留在本地 run 目录，交接通知明确该目标失败原因；不要把失败目标伪装为已同步。

`setup.completed` 只在 `language` 与所有所选文档目标均可落地时置真。

## 4. 本地 canonical 产物

可用本机脚本时，采集前建 run 目录：

```bash
python3 scripts/research_helper.py new-run --product "<产品名>"
```

使用返回路径：`inventory.md`（事实总账）/ `report.md`（canonical 报告）/ `meta.json` / `raw/`（来源原料、audit/重跑用）。本地产物是 source of truth；各文档目标都从 canonical `report.md` 派生，不为每个目标造独立源。无本机脚本时用运行时提供的唯一 per-run 目录，不复用固定产品级路径。

## 5. 目标行为

- `local_markdown` / `obsidian`：写 Markdown 文件，写后校验文件存在且内容与 canonical 一致，返回绝对路径；不覆盖已存在文件，除非用户要求。
- `notion`：仅在 parent 设置与 token 环境变量齐备时用 API 建页；返回 page URL/id 才算成功，失败则保留 Markdown 并报原因。
- `feishu` / `lark`：作为一等文档导出目标；优先运行时 cloud-doc connector；connector 返回可验证文档 id 才算成功；无 connector 时暂存并说明。helper 的 staging fallback 退出码为 `3`（staged_not_synced），区别于成功的 `0`：交接通知必须如实说成「已暂存，待 connector 同步」，不得报成「已同步到飞书/Lark」。中国租户用 `feishu`，全球用 `lark`，用户未指定时按此默认。
- `chat` / `im`：不配为 `default_targets`；不通过聊天发完整报告，除非用户明确要预览；导出后发简洁交接通知。

## 6. 交付与交接

报告通过 Phase 3 完整性校验后：先把 canonical Markdown 写到 `new-run` 返回的 `report_path`（无脚本时用运行时唯一 per-run 路径，不用固定产品级路径）→ 按「当前请求显式目标 > 存储 default_targets」定目标 → 无任何文档目标则停下问首跑 setup，不静默退回聊天 → 每个目标从 canonical 派生导出并校验 → 导出尝试结束后发交接通知。

```bash
python3 scripts/research_helper.py export --input "<report_path>" --title "<标题>" --target local_markdown+feishu
```

交接通知必须含：交付目标；每个成功目标的 URL/token/绝对路径；canonical 的 body/inventory/meta 本地路径；导出失败或 connector 缺口；影响解读的来源/工具覆盖缺口。
