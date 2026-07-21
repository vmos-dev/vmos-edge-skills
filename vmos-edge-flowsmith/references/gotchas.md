# VMOS Edge YAML Flow:坑与排错

**通读一遍再动手,十分钟的事。** 这份只回答一个问题:**为什么它没按我想的跑?**

这套语法的坑不是零散的,它们有共同成因,理解了就能自己推断没列进来的情况。

**目录**:§1 静默失效 · §2 当场报错 · §3 失败语义 · §4 排障表

---

## §1 静默失效 —— 引擎不会告诉你


这些坑有一个共同成因:**你的写法被接受了,却没有被执行**。中间那一层认得这个字段、放它过关,
要么**没接线**(存下来但从不读取),要么**静默降级**(多余的键丢掉、对象转成字符串),
要么**语义不是你以为的**(条件短路、嵌套失败不上报)。

理解了这条,这两张表就不是要背的清单,而是同一个成因的实例。**拿不准时问自己:
我写的这个东西,执行层真的会读它吗?**

**能通过解析,任务甚至报成功,真机上却什么都没做或做错了。** 这类最危险,因为没有任何信号。

| ❌ 容易这么写 | ✅ 正确 | 后果 |
|---|---|---|
| 关键断言放进 `repeat` / `runFlow` / `branch` 里,指望它失败时拦住流程 | 关键断言放**顶层**;或块里置标志位、块外 `assertTrue` 复检 | **嵌套块里的失败不冒泡**:只终止本块剩余命令,外面继续、任务报成功。`repeat` 还会接着跑下一轮(§3) |
| `- runFlow: flows/login.yaml`<br>`- runFlow: { file: x.yaml }` | 把子流程**内联**进 `commands:` | 路径只被存下、**从来没有被读取执行**,子流程空跑,任务照样成功 |
| `- retry: { maxRetries: 3, commands: [...] }` 用来重试点击 | `repeat` + `while` 轮询,顶层断言收口(见 `patterns.md` §3) | `retry` 只捕获**抛出的异常**,而命令失败被转成返回值 → **一次都不会重试** |
| `- tapOn: "${maybeUndefined}"` 靠 `optional: true` 兜底 | 先 `defineVariables` 给默认值 | **顶层**命令的 `${}` 求值在保护区之外:引用未定义变量**直接终止整个任务**,步骤里连失败标记都没有(嵌套块里的按普通失败处理,见 §3) |
| `- tapOn: "登录"`<br>`  optional: true`(与命令名同级) | `- tapOn:`<br>`    text: "登录"`<br>`    optional: true` | 一个 `- ` 项里出现多个键时**只取第一个**,其余静默丢弃 |
| `when: { visible: A, notVisible: B }` | 一个条件只写**一个**字段 | 条件**首个命中即返回**,不是 AND:`visible` 存在就只判它 |
| `when: { platform: android }` | 没有这个条件,删掉 | 字段不被识别 → 条件对象变空 → **恒为真**,分支永远走进来 |
| `- inputText: { text: "你好" }`<br>`- pressKey: { key: home }` | `- inputText: "你好"`<br>`- pressKey: home` | 这几个命令只接受标量,对象会被转成 **`"[object Object]"` 并真的用上**。同类:`assertTrue` `setClipboard` `takeScreenshot` `evalScript` |
| `- assertTrue: { condition: "${x>0}" }` | `- assertTrue: "${x > 0}"` | 同上,转成非空字符串 → **断言永远通过** |
| 子流程里 `defineVariables: { auth: "Bearer ${token}" }` | 子流程里改用 `evalScript: "auth = 'Bearer ' + token"` | `runFlow` / `retry` 内的 `defineVariables` **不做 `${}` 插值**,而且会被提到块首先执行 |
| `runFlow: { env: {...}, commands: [...] }` | 用外层变量,或块里 `evalScript` 赋值 | env 内容**被丢弃**;更糟的是它会顶掉整份配置 → **该子流程内的 `exceptionHandlers` 全部失效** |
| `onFlowStart:` / `onFlowComplete:` 写在顶部配置 | 把这些命令直接写进主流程首尾 | 顶部配置的这两个键**从不被读取** |
| `traits: "long-clickable"` | 换用别的条件 | 这一个特征名匹配期永远为 false |
| 输入完顺手写 `- hideKeyboard` | 确认键盘真的还在时才写,不确定就别写 | 它**就是按返回键**(和 `back` 同一个实现)。键盘没弹出时,这一下**直接退出当前页面**,后面全错位 |
| 靠 `- clearState` 保证干净环境 | 自己用驱动的 shell 通道验证清没清,或改用 App 内退出登录 | 它执行 `pm clear` 且强制走 **root**;设备没 root 时**静默失败**(引擎从不检查 shell 退出码),命令照样报成功 |
| `- openLink: { link: x, autoVerify: true, browser: false }` | `- openLink: "x"` | 后两个字段被解析后直接丢弃,引擎只发一条 VIEW intent |
| `permissions: { 相机: allow }` 指望按需授权 | 写完整权限名 `android.permission.CAMERA`;value 写什么都一样 | **只有 key 起作用**(执行 `pm grant 包名 <key>`),value 完全不参与。不写 permissions 时引擎执行的是 `pm grant 包名 all` —— `all` 不是合法权限名,**一个权限都没授** |
| `tapOn: { waitUntilVisible: true }` 指望它等元素 | 用 `extendedWaitUntil` 或先 `assertVisible` | 该字段一路传到底层却**从没被读取**,纯空操作 |
| `- takeScreenshot` 想留证据 | 排障用驱动的截图接口自己拉 | 路径不生效,而且截好的图**引擎直接丢弃**,回执里也拿不到 —— 这条命令只剩一次无意义往返 |


---

## §2 会当场报错 —— 但错因反直觉
**这类不会静默,任务会失败**,只是报错信息看不出真正原因,容易在错误的方向上排查半天。
注意:**`optional: true` 兜不住这一类**(它只兜运行期找不到元素/断言不过,见 §3)。

| ❌ 容易这么写 | ✅ 正确 | 报什么错 / 为什么 |
|---|---|---|
| `- tapOn: "登录"` 想匹配"登录页面" | `- tapOn: "登录.*"` | 找不到元素。`text` 是**全匹配正则**不是包含,差一个字就不中 |
| `- tapOn: "确定(2)"` | `- tapOn: "确定\\(2\\)"` 或改用 `id` | `Invalid regular expression`。文字当正则编译,括号 / 中括号不配对直接炸 |
| `- tapOn: "3 件商品, 很便宜"` | `- tapOn: { text: "3 件商品, 很便宜" }` | `Invalid point`。字符串**首字符是数字且含逗号**会被当坐标解析 |
| `point: "120%, 50%"` | 百分比保持 0~100 | 抛错,**不是裁剪到边界** |
| `- pressKey: VolumeUp` / `PageDown` | `- pressKey: volume up` / `page down` | `Unknown key`。多词键名**必须用空格分隔**(大小写无所谓,`Volume Up` 也行) |
| `- shell: "pm clear com.x"` | 用 `runScript` 写脚本;系统命令走别的通道 | 语法错。`shell` **不执行系统命令**,它是 `evalScript` 的别名,内容被当脚本跑 |



---

## §3 失败语义


**设计流程结构前必读。顶层命令失败 = 停止整个流程;嵌套块里的命令失败 = 只停这个块,外面继续、任务照样报成功。**
`repeat` / `runFlow` / `branch` 都是这样,`repeat` 还会接着跑下一轮。

```yaml
- runFlow:
    commands:
      - assertVisible: "必须出现的元素"   # ← 失败了
      - inputText: "不该执行的内容"        # ← 确实被跳过了
- inputText: "父流程继续执行"              # ← ★ 照跑,任务最终报成功
```

所以**别指望用嵌套块里的断言保护整条流程**。要么关键断言放顶层,要么块里置标志位、出来后复检:

```yaml
- runFlow:
    commands:
      - evalScript: "ok = false"
      - assertVisible: "登录成功"
      - evalScript: "ok = true"
- assertTrue: "${ok}"        # 顶层收口,这里失败才真的停
```

**`retry` 基本是摆设**:它只捕获"抛出来的异常",而普通命令失败在内层被转成了返回值,永远走不到它的捕获分支。
要重试,用 `repeat` + `while` 轮询,写法见 `patterns.md` §3。

**三条通道的区别:**

| 通道 | 触发 | 结果 |
|---|---|---|
| 失败 | 命令执行期出错、且没有 `optional` | 终止本块;顶层则终止流程 |
| 警告 | `optional: true` 的命令失败 | 记一条警告,继续 |
| 跳过 | `when` 为假 / `repeat` 首轮条件不成立 / `branch` 无分支命中 | 静默跳过,**不算失败** |

⚠️ **`optional: true` 有两层限制,别以为加了它就能随便写。**

1. **一批命令根本不支持它**:`assertTrue` `inputText` `evalScript`(及别名 `shell`)`setClipboard`
   `takeScreenshot` `pressKey` `defineVariables` `branch`。另外**所有简写标量形态**(`- eraseText: 200`、
   `- launchApp: com.x`、`- sleep: 3000`)也带不了 `optional`,要它就写成对象形态。
2. **它只兜"运行期找不到 / 断言不过 / 应用起不来"这类失败。写法本身非法抛的是另一种错,它兜不住** ——
   正则非法(`text: "购买(1"`)、坐标非法(`"120%, 50%"`)、键名非法(`pressKey: VolumeUp`)
   一律照样终止流程,加不加 `optional` 都一样。

⚠️ **`${}` 求值失败的位置决定后果,这点务必分清:**

| 出错位置 | 后果 |
|---|---|
| **顶层命令**的 `${}` | **绕过全部保护,直接终止整个任务** —— `optional`、异常处理器、失败回调统统不介入,步骤列表里连失败标记都没有 |
| **嵌套块内**的 `${}` | 按普通失败处理,记在**外层那条块命令**头上;外层块若有 `optional: true`,还会被降级成警告 |

不管哪种,治法都一样:**引用任何变量前先确保它被定义过** —— 顶层 `defineVariables` 占位,
或写 `${typeof v !== 'undefined' ? v : '默认值'}`。

---


---

## §4 排障表


开头那张表管"写法 → 后果";这张表管"症状 → 根因"。

| 症状 | 根因 | 怎么办 |
|---|---|---|
| 某条命令失败,说找不到元素 | 全匹配正则差一个字就不中;或界面语言不同 | 重抓界面结构核实文字,用 `.*` 剥掉可变部分 |
| 大片跳过 | 条件没成立,或 `${}` 里变量名拼错求值成空 | 检查条件字段和变量名;`branch` 记得留 else |
| 点到了旁边的元素 | 匹配到多个,默认优先可点击的那个 | 显式 `index`,或用 `childOf` / 空间关系收窄 |
| 循环停不下来,转满 1000 次 | 条件恒真(写了不认识的字段;或条件里的变量没更新) | 条件只写一个合法字段;计数器在循环体里自增 |
| 循环一轮都没跑 | 首次求值条件就不成立 | 这是预期行为;要"至少跑一次"把首轮动作提到循环外 |
| 刷视频很慢,每滑一下卡一下 | 每次滑动后默认等界面稳定,而信息流永远不稳定 | 滑动加 `waitToSettleTimeoutMs: 0` |
| 换台设备就点偏 | 用了绝对像素坐标 | 改百分比,或改用文字选择器 |
| 子流程像没执行,任务却成功 | 用了引用文件的写法 | 改成内联 `commands:` |
| 中间步骤失败了,任务却报成功 | 失败发生在嵌套块**里面**,不冒泡(§3) | 关键断言放顶层收口 |
| `retry` 包了却从没重试过 | 它捕获不到普通命令失败 | 改用 `repeat` + `while` |
| 断言恒过,从没拦住问题 | `assertTrue` 写成了对象形态 | 改裸字符串 |
| 任务整个中断,步骤里却没有失败标记 | `${}` 求值炸了(未定义变量 / 语法错 / 超时) | 先 `defineVariables` 占位;复杂计算拆成 `evalScript` |
| 命令报 `Invalid regular expression` | 文案里有没转义的括号 | 转义,或改用 `id` |
| 输入框里真的出现 `[object Object]` | 给只接受标量的命令写了对象形态 | 改成标量 |
| 断言刚等待完就失败 | 查找超时被"距上次交互耗时"扣光 | 等待挪到断言后,或用 `extendedWaitUntil` |
| `${n + 1}` 得到 `"51"` 而不是 6 | 变量是字符串(加了引号,或来自 API) | 数字别加引号,或 `${Number(n) + 1}` |
| 请求拿到空字符串 | 重试用尽仍抽不到 `jsonPath`,静默写空串 | 取完加断言收口 |
| 弹窗偶尔漏处理 | 只在主干判断了一次,但弹窗时机不固定 | 放进 `exceptionHandlers` 并给 `maxTriggerCount` |
