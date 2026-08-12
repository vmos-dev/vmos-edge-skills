# 执行语义与陷阱

用于设计或审核流程结构。只记录“YAML 合法但执行结果反直觉”的引擎事实。

**目录**：§1 静默失效 · §2 直接失败 · §3 失败、警告与跳过

## §1 静默失效

| 错误写法 | 正确写法 | 实际后果 |
|---|---|---|
| 将关键断言放进 `repeat` / `runFlow` / `branch` | 将关键断言放顶层，或块内置标志、块外复检 | 嵌套失败不冒泡，父流程继续并可能报成功 |
| `runFlow: flows/login.yaml` 或 `runFlow: { file: x.yaml }` | 内联 `commands` | 路径从未被读取，子流程空跑 |
| 用 `retry` 重试普通命令 | 用有界 `repeat`、成功时 `break`、顶层断言收口 | 普通命令失败被转成返回值，`retry` 捕获不到 |
| 未定义变量配 `optional: true` | 先定义变量 | 顶层 `${}` 求值失败绕过 `optional` 和异常处理器，直接终止任务 |
| 将 `optional` 与命令名写在同一层 | 将它缩进命令参数对象 | 一个命令项出现多个键时只读取第一个 |
| 一个条件同时写 `visible` 和 `notVisible` | 一个条件只写一个判断字段 | 条件按固定优先级取第一个，不执行 AND |
| `when: { platform: android }` | 删除未知条件或改用受支持字段 | 未知字段被丢弃；空条件恒为真 |
| 给 `inputText`、`pressKey`、`assertTrue` 等标量命令传对象 | 传裸字符串或数值 | 对象被转成 `"[object Object]"`；`assertTrue` 因非空而恒过 |
| 在子流程 `defineVariables` 中写 `${}` | 用 `evalScript` 计算 | 值不插值，并在块开始时提前执行 |
| `runFlow.env` | 使用外层变量或块内脚本赋值 | `env` 被丢弃，还会使该子流程失去顶部异常处理器 |
| 顶部写 `onFlowStart` / `onFlowComplete` | 将命令写入主流程首尾 | 顶部字段从不执行 |
| `traits: "long-clickable"` | 使用其他选择器 | 该 trait 永远匹配失败 |
| 不确认键盘状态就执行 `hideKeyboard` | 仅在键盘确定存在时执行 | 它等同返回键；键盘不在时会退出页面 |
| 依赖 `clearState` 保证清理成功 | 通过设备 shell 验证或在 App 内退出 | 它强制使用 root；无 root 时静默失败且命令仍报成功 |
| 给 `openLink` 配 `autoVerify` / `browser` | 只传链接 | 额外字段被丢弃 |
| 权限名写中文或省略全名 | 使用 `android.permission.*` 完整名称 | 只有 key 生效；value 不参与；默认 `all` 不是合法权限名 |
| `tapOn.waitUntilVisible` | 先断言或使用 `extendedWaitUntil` | 字段未接到执行层 |
| 用 `takeScreenshot` 留回执证据 | 通过设备截图接口保存 | 路径不生效，图片也不进入任务回执 |

## §2 直接失败

`optional: true` 只能降级运行期失败，不能兜住非法正则、坐标、键名、脚本或控制流。

| 错误写法 | 正确写法 | 原因 |
|---|---|---|
| `tapOn: "登录"` 想匹配“登录页面” | `tapOn: "登录.*"` | `text` 是全匹配正则，不是包含匹配 |
| `tapOn: "确定(2)"` | 转义为 `"确定\\(2\\)"` 或使用 `id` | 正则元字符可能导致非法或错误匹配 |
| `tapOn: "3 件商品, 很便宜"` | `tapOn: { text: "3 件商品, 很便宜" }` | 首字符为数字且包含逗号的字符串会被当作坐标 |
| `point: "120%, 50%"` | 百分比保持在 0–100 | 越界抛错，不会裁剪 |
| `pressKey: VolumeUp` | `pressKey: volume up` | 多词键名必须用空格 |
| `shell: "pm clear com.x"` | 系统命令走设备 shell 通道 | flow 中的 `shell` 是 `evalScript` 别名 |
| 在循环外写 `break` | 移入目标 `repeat.commands` | `break` 只能退出最近一层循环 |
| 给 `2fa.code` 传普通文本或 otpauth URL | 传 Base32 secret | 运行时拒绝无效 Base32，错误不会回显 secret |

## §3 失败、警告与跳过

顶层命令失败会停止流程；嵌套块内失败只停止该块，父流程继续。`repeat` 下一轮仍会运行。
`break` 不是失败：它成功结束最近一层 `repeat`，然后执行循环后的命令。

```yaml
- runFlow:
    commands:
      - evalScript: "ok = false"
      - assertVisible: "登录成功"
      - evalScript: "ok = true"
- assertTrue: "${ok}" # 顶层收口
```

| 状态 | 触发条件 | 结果 |
|---|---|---|
| 失败 | 命令运行失败且未被降级 | 终止当前块；位于顶层时终止流程 |
| 警告 | 支持 `optional` 的命令运行失败 | 记录警告并继续 |
| 跳过 | `when` 为假、循环首轮条件为假或 `branch` 无分支命中 | 不算失败 |

`optional` 不支持 `assertTrue`、`inputText`、`evalScript` / `shell`、`setClipboard`、`takeScreenshot`、
`pressKey`、`defineVariables`、`branch`、`break`，也无法附着在裸标量命令上。

`${}` 求值失败的位置决定结果：

| 位置 | 后果 |
|---|---|
| 顶层命令 | 绕过 `optional`、异常处理器和失败回调，直接终止任务；步骤列表可能没有失败标记 |
| 嵌套块 | 按普通失败记在外层块命令；外层块支持 `optional` 时可降级为警告 |

始终先定义变量。需要保留缺省值时使用顶层 `defineVariables`；需要计算时使用裸 JavaScript 的 `evalScript`。
