# VMOS Edge Flowsmith Skill

写 VMOS Edge 的 YAML flow 自动化脚本 —— "顶部 `appId` 配置 + `---` + 命令数组"这种格式。
覆盖从需求到交付的整条链路:上设备抓界面结构 → 写脚本 → 静态校验 → 提交执行 → 读回执排障。

## 安装

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-flowsmith
```

## 目录结构

- `SKILL.md`
  - skill 入口:工作流程六步、四条铁律、交付前自检、参考文件分流表
- `references/gotchas.md`
  - **动手前必读**。静默失效表 / 当场报错表 / 失败语义 / 排障表
- `references/syntax.md`
  - 语法查表:文件结构 → 命令索引 → 字段 shape → 选择器 → 条件 → 变量 → 默认值与限制
- `references/patterns.md`
  - 骨架 + 9 个可抄的结构(启动锚点、轮询、有界批量、长时浏览、取验证码…)
- `references/device.md`
  - 上设备查包名 / 界面语言 / 界面结构,以及结构怎么变成选择器
- `references/runtime.md`
  - 提交执行、查进度、取消任务、读逐条回执
- `references/humanization.md`
  - 等待区间、概率动作、节奏参数
- `scripts/lint_flow.py`
  - 静态校验器,交付闸门。抓的是"YAML 合法但引擎不认"的写法

## 连接入口

需要**宿主机 IP** 和**云机 ID** 两样,其余(包名、界面语言、界面结构)由 skill 自己上设备查。

设备驱动(抓界面结构、跑 shell、截图、点屏幕):

```text
http://{宿主机IP}:18182/android_api/v2/{云机ID}
```

flow 引擎(提交脚本、查进度、取消):

```text
http://{宿主机IP}:47218
```

这个驱动地址同时就是提交任务时 `devices[].baseUrl` 要填的值。

## 依赖

- `python3` + `PyYAML` —— 跑 `scripts/lint_flow.py`
- `curl`、`jq` —— 上设备抓界面结构

## 适用版本

对应 flow 引擎 **v2.0.3**。确认你的版本:

```bash
curl http://{宿主机IP}:47218/health
```

看返回里的 `version`。版本更低时,本文写的一部分行为(尤其数值字段里的 `${}`)可能还没有,
真机跑一条最小用例验证比猜快。
