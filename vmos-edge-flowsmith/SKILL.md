---
name: vmos-edge-flowsmith
description: >-
  为 VMOS Edge 创建、修改、审核、校验和排障 YAML flow 自动化脚本。覆盖 appId 配置、命令数组、选择器、
  变量、repeat/while/break 循环控制、2FA/TOTP、长跑浏览、养号、私信、注册和真机执行。用户提到
  VMOS Edge flow、脚本、自动化或养号，提供 appId + --- + commands YAML，或反馈流程报成功却没动作、
  找不到元素、跳过分支、变量异常、循环不停止时使用。仅适用于 VMOS Edge YAML flow，不处理其他自动化
  格式或单纯设备管理。
---

# VMOS Edge YAML Flow

产出可校验、可真机验证、可跨设备维护的 VMOS Edge flow。当前语义基线为引擎 v2.0.5；使用新增语法前通过
`GET /health` 核对版本，版本不符时先报告兼容性风险。

## 工作流

1. **界定任务。**
   - 新建或修改：确认目标和动作序列；需要检查或真机运行时再获取主机 IP 与云机 ID。
   - 排障：获取 YAML、任务回执、预期与实际现象。
   - 不询问可从设备查到的包名、界面语言、当前页面或控件结构。
2. **只加载需要的资料。** 按下表读取，不通读整个目录。
3. **形成执行规格。** 列出动作顺序、循环停止策略、可配置变量、页面锚点和危险动作。真机执行危险动作前取得明确授权。
4. **逐屏取证。** 有设备地址时按 [device.md](references/device.md) 获取结构和截图；每导航一屏重新检查。
   无设备时使用占位选择器并标记 `# TODO: 待真机界面结构替换`。
5. **编写 flow。** 从 [patterns.md](references/patterns.md) 选择最接近的结构，只到
   [syntax.md](references/syntax.md) 查询实际使用的命令和字段。
6. **验证闭环。** 运行静态校验；获准后以最小批量真机执行，读取逐条状态，修正后重复验证。

## 始终遵守的引擎约束

- 严格按 [syntax.md](references/syntax.md) 的命令 shape 编写；不要凭相似工具经验猜字段。
- 将关键成败断言放在顶层。断言必须证明业务结果；不要用循环自身已保证的边界或恒真表达式消除 lint 警告。
  `repeat`、`runFlow`、`branch` 内的失败不会保护父流程。没有可观察终态时保留并解释 `NO_TOP_ASSERT`。
- 在引用 `${name}` 前定义变量。调度端 `env` 注入值按设备生效；密钥只注入，不写入 YAML。
- 优先使用目标界面的稳定文字或结构关系；剥离动态计数。仅在没有稳定选择器时退到百分比坐标，禁用绝对像素。
- 把 `times`、`duration`、`while` 视为独立可选停止条件；同时传入时任一先满足即停止。三者都不传会无限运行。
- 用 `while: true` 表达有意的无限循环，并提供可达 `break` 或明确取消方案。`break` 只退出最近一层 `repeat`。
- 用 `2fa.outputVariable: otp` 生成变量，后续以 `${otp}` 引用；`2fa.code` 只接收注入的 Base32 TOTP secret。
- 任何操作 UI 的 `repeat` 都要在本轮加入随机 `sleep`，避免无间隔重复；连续点击、输入或换页之间也要留随机间隔。
  只在浏览、养号等场景加载深度拟人化策略。批量发送、关注、删除、发布必须可配置、可中止。

## 静态校验

执行脚本，不要读取后手工复刻规则：

```bash
python3 <skill目录>/scripts/lint_flow.py flow.yaml
```

依赖 Python 3 与 PyYAML。任何 `ERROR` 都必须修复；逐条审阅 `WARN`。修改后重复运行，直到零 `ERROR`。

真机验证前将批量上限降到最小值。使用 [runtime.md](references/runtime.md) 提交、核对 `taskId`、查看逐条状态并在失控时取消。
真机验证不能由静态校验替代。

## 交付内容

- 完整 YAML；
- 静态校验结果；
- 已真机验证和未验证的步骤；
- 占位选择器、版本边界与已知限制；
- 危险动作及其授权状态。

## 按需资料

| 当前任务 | 读取 |
|---|---|
| 查询命令、字段、选择器、条件、变量或默认值 | [syntax.md](references/syntax.md) 的对应章节 |
| 选择可复用流程结构 | [patterns.md](references/patterns.md) 的对应模式 |
| 理解静默失效、作用域、失败和跳过 | [semantics.md](references/semantics.md) |
| 按现象定位已有脚本 | [troubleshooting.md](references/troubleshooting.md)，再按结果读取语义或语法章节 |
| 获取包名、语言、界面结构和截图 | [device.md](references/device.md) |
| 设计随机等待、概率互动和长跑节奏 | [humanization.md](references/humanization.md) |
| 提交、查询、取消或解释任务回执 | [runtime.md](references/runtime.md) |

所有参考文件都由本文件直接链接。不要通过一个参考文件继续追另一层资料。
