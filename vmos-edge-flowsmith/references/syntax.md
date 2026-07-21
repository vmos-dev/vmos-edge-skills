# VMOS Edge YAML Flow 语法参考

**查表用的,不是通读的。** 命令叫什么、有哪些字段、默认值多少、写成什么形态合法 —— 都在这里。

**目录**:§1 文件结构 · §2 命令索引 · §3 命令 shape · §4 选择器 · §5 条件 · §6 变量 · §7 默认值与限制

---

## §1 文件结构与顶部配置


```yaml
appId: com.example.app        # 必填(或用 url 顶替),缺了直接报 missing_app_target
name: 流程名                   # 可选,任务列表里显示
tags: [nurture, tiktok]       # 可选
env:                          # 可选,变量默认值
  MSG: "你好"
  MAX_NUM: 12                 # ★ 数字别加引号,加了就是字符串,算术会变成拼接
exceptionHandlers:            # 可选,见下
  - "允许"
---                           # ★ 必须有这条分隔线,少了直接报错
- launchApp
- tapOn: "登录"
```

上半段是配置、下半段是命令数组,**必须用 `---` 分开**,而且**整份文件只能有这一条**单独成行的 `---` ——
出现第二条会直接报 `Source contains multiple documents`。

| 配置字段 | 说明 |
|---|---|
| `appId` / `url` | 目标包名,二选一必填。命令里不写 `appId` 时都默认用它 |
| `name` / `tags` | 展示与归类 |
| `env` | 变量默认值,同时注入脚本环境 |
| `exceptionHandlers` | 弹窗自动处理器,见下 |
| `properties` / `onFlowStart` / `onFlowComplete` | **写了没用**,引擎不读 |

**参数化的正确姿势。** 会变的量(账号 / 文案 / 目标数 / 时长)一律设计成变量,`env:` 只写默认值,
真实值由调度端按设备注入。注入进来的值是**锁定的**:YAML 里的 `env:` 声明、`defineVariables`、
`runScript.env`、`httpRequest.outputVariable` 都覆盖不了它(唯一例外是 `evalScript` / `runScript`
**脚本体里的直接赋值** —— 别给锁定变量名赋值)。注入值**永远是字符串**,做算术先 `Number()`。

**exceptionHandlers**:每条命令执行前主动清弹窗、命令失败后再试一遍,同一条命令最多被救 5 次。

```yaml
exceptionHandlers:
  - "允许"                       # 字符串简写 = { text: "允许" }
  - text: "跳过"
    maxTriggerCount: 3           # 这个处理器整个流程累计最多触发 3 次,防死循环
  - id: "ad_close"
```

除 `maxTriggerCount` 外**其余字段全部当选择器**用(§4 的字段都行),动作固定是"点它",不可配。
适合**随时可能冒出来**的弹窗(权限、广告、评分引导);**流程里必现的**弹窗写进主干更可读。
代价:handler 越多,每条命令前的界面扫描开销越大。

---

## §2 命令索引


不在这张表里的名字一律解析报错。找到要用的命令,再去 §3 看 shape。

| 类 | 命令 | 一句话 |
|---|---|---|
| **点击** | `tapOn` / `longPressOn` / `doubleTapOn` | 点 / 长按 / 双击(选择器或坐标) |
| **滑动** | `swipe` | 方向滑、坐标滑、从元素滑 |
| | `scroll` | 垂直滚一次(无参) |
| | `scrollUntilVisible` | 滚到元素可见,可限定在容器内滚 |
| **输入** | `inputText` / `eraseText` | 输入文字 / 删字符 |
| | `inputRandomText` / `inputRandomNumber` / `inputRandomEmail` / `inputRandomPersonName` | 随机内容输入 |
| | `pressKey` | 按键(多词键名用空格分隔,不分大小写) |
| | `hideKeyboard`(别名 `hide keyboard`) / `back` | **两者都是按返回键**,`hideKeyboard` 只是不等界面稳定 |
| | `copyTextFrom` / `pasteText` / `setClipboard` | 读元素文字 / 重新输入 / 写虚拟剪贴板(**引擎内部的,不碰系统剪贴板**);写进去的值可以用 `${maestro.copiedText}` 读出来 |
| **断言等待** | `assertVisible` / `assertNotVisible` | 断言可见 / 不可见 |
| | `assertTrue` | 断言表达式(**只接受裸字符串**) |
| | `extendedWaitUntil` | 带自定义超时地等元素出现或消失 |
| | `waitForAnimationToEnd` / `sleep` | 等动画结束 / 延时 |
| **App** | `launchApp` / `stopApp` / `killApp` / `clearState` | 启动 / 停止 / 停止(`killApp` 与 `stopApp` **同一实现**) / 清数据 |
| | `openLink` / `setPermissions` | 打开链接 / 设权限 |
| **流程** | `repeat` | 循环(次数 / 时长 / 条件) |
| | `branch` | 多分支,取第一个命中的 |
| | `runFlow` | 内联子流程(**只能内联**) |
| | `retry` | 失败重试 —— **但它捕获不到普通命令失败,实际一次都不会重试** |
| **变量脚本** | `defineVariables` / `evalScript`(别名 `shell`) / `runScript` | 定义变量 / 跑表达式 / 跑脚本 |
| | `httpRequest` | 发请求、抽字段进变量 |
| **设备** | `setLocation` / `setAirplaneMode` / `takeScreenshot` | 定位 / 飞行模式 / 截图 |

**无参裸写形式**(直接 `- 命令名`)只有这些:`launchApp` `stopApp` `killApp` `clearState` `eraseText`
`inputRandomText` `inputRandomNumber` `inputRandomEmail` `inputRandomPersonName` `back` `hideKeyboard`
`hide keyboard` `pasteText` `scroll` `waitForAnimationToEnd`。其余必须带参数。

---

## §3 命令 shape


字段写全是为了让你看清有哪些旋钮,**不是每个都得填**。真正必填的只有"点谁"(选择器)和各命令自己的核心值。

### 点击类

```yaml
- tapOn: "登录"                    # 简写 = { text: "登录" }
- tapOn: "50%, 80%"               # 字符串含逗号且首字符是数字 → 当坐标
- tapOn:
    text: "登录"                   # 选择器字段全部可用,见 §4
    optional: true                # 找不到不失败只记警告,且查找超时 17s→7s
    waitToSettleTimeoutMs: 0      # 点完不等界面稳定(默认约 1500,上限 30000)
    repeat: 3                     # 连点 3 次
    delay: 200                    # 连点间隔 ms(默认 100)
    retryTapIfNoChange: true      # 界面没变化就再点一次(只补一次,不是一直重试)
    point: "50%, 25%"             # 有选择器时 = 元素内相对位置;没选择器时 = 屏幕坐标
    label: "点登录"                # 仅日志
- longPressOn: "文件"              # 字段同 tapOn,但 repeat / delay 对长按无效;长按时长固定 1000ms
- doubleTapOn: "图片"
```

坐标两种写法:`"540, 1200"` 绝对像素 / `"50%, 80%"` 百分比。**百分比必须在 0~100,越界抛错不是裁剪。**
跨设备一律用百分比。

### 滑动滚动

```yaml
- swipe: UP                                  # 简写,方向
- swipe:
    direction: UP                            # UP / DOWN / LEFT / RIGHT
    duration: [200, 500]                     # ★ 支持随机区间,默认 400
    waitToSettleTimeoutMs: 0
- swipe: { start: "50%, 80%", end: "50%, 20%", duration: 300 }   # 坐标滑
- swipe: { direction: LEFT, from: { text: "卡片" } }              # 从某元素中心滑
- scroll                                     # 垂直滚一次,无参
- scrollUntilVisible:
    element: { text: "关于本机" }              # ★ 必填,键名是 element 不是 selector
    direction: DOWN                          # 默认 DOWN
    timeout: "20000"
    speed: "40"                              # 0~100,默认 40
    visibilityPercentage: 100                # 露出多少算可见,默认 100
    centerElement: false                     # 尽量滚到居中
    waitToSettleTimeoutMs: 0                 # 每次滚完不等界面稳定 —— 刷不停的列表必加
    from: { id: "comment_list" }             # 手势限制在这个容器内滚
```

三种 swipe 模式(`start`+`end` / `direction`+`from` / 只有 `direction`)必须命中一种,否则解析报错。

⚠️ **方向式 swipe 的起止点是写死的**:`UP` 从屏幕正中滑到 10% 高、`DOWN` 从 20% 滑到 90%、
左右在 90%↔10% 之间。横坐标恒为 50% —— **每次滑动起点都是同一个像素**,既不够拟人,
也可能正好压在中央的危险元素上。要让轨迹有变化或避开某处,改用 `start` / `end` 百分比坐标并加随机。

`- scroll` 等价于 `swipe UP` + 400ms,**且关不掉 settle** —— 信息流里请用 `swipe` 显式写 `waitToSettleTimeoutMs: 0`。

### 输入按键

```yaml
- inputText: "${MSG}"          # 只接受标量
- eraseText                    # 默认删 50 字符,而且是【逐字符一次 HTTP 往返】—— 知道长度就显式给数
- eraseText: 200
- inputRandomText: { length: 16 }      # 不给 length 默认 8 位字母
- inputRandomNumber: { length: 6 }     # ★ 不给 length 时位数【不定】(1~6 位),要固定位数必须写
- inputRandomEmail                     # ★ 生成的是英文邮箱
- inputRandomPersonName                # ★ 生成的是英文姓名 —— 中文实名场景别用
- pressKey: home               # 键名不分大小写,但多词必须用空格:volume up / page down / dpad up / forward delete / numpad 0
# ★ 也接受数字 keycode,但会先查键名表:`pressKey: 3` 命中的是【数字键 3】而不是 HOME。
#   想按 HOME 就写 `home`;只有键名表里没有的键才适合用数字。
- back
- hideKeyboard
- copyTextFrom: { id: "code" } # 取元素文字存进虚拟剪贴板
- pasteText                    # 把虚拟剪贴板内容重新输入一遍
- setClipboard: "abc"
```

### 断言等待

```yaml
- assertVisible: "欢迎"                        # 默认等 17 秒
- assertNotVisible: "加载中"                    # 默认等 17 秒消失(不是 7 秒)
- assertTrue: "${counter > 0}"                # 只能裸字符串
- extendedWaitUntil:
    visible: { text: "就绪" }                  # 或 notVisible:
    timeout: "30000"
- waitForAnimationToEnd: { timeout: 5000 }    # 默认 15000
- sleep: 2000
- sleep: [3000, 8000]                         # ★ 随机区间,每次执行重新取
- sleep: { min: 3000, max: 8000 }             # min 和 max 要成对给
```

### App

```yaml
- launchApp                                    # 用配置里的 appId
- launchApp: com.example.app
- launchApp:
    appId: com.example.app
    clearState: true
    stopApp: true                              # 默认 true,先杀掉旧实例
    permissions: { "android.permission.CAMERA": allow }   # ★ 只有 key 起作用,value 写什么都是"授予";
                                          #   必须是完整权限名。不写这个字段时引擎跑的是 `pm grant 包名 all`,
                                          #   all 不是合法权限名 → 实际一个都没授
- stopApp / killApp / clearState                # 均支持裸写、`: 包名`、`{ appId }`
- openLink: "myapp://settings"
- openLink: "https://example.com"            # autoVerify / browser 写了没用,引擎只发一条 VIEW intent
- setPermissions: { "android.permission.CAMERA": allow }
```

### 流程控制

```yaml
- repeat:
    times: "20"                    # 上限 1000
    duration: "600000"             # ms;不写也有 30 分钟隐式上限。与 times 同时写 = 先到先停
    while: { visible: "还有下一条" } # 每轮重新求值,不成立就结束
    commands:
      - swipe: UP
      - sleep: [3000, 8000]

- branch:                          # 参数必须是数组
    - when: { visible: "从图片库选择" }
      commands: [ { tapOn: "从图片库选择" } ]
    - when: { true: "${mode === 'dm'}" }
      commands: [ ... ]
    - commands: [ { back: {} } ]   # 无 when = else 分支
    # branch 自己不支持 label / optional / 外层 when

- runFlow:                         # 只用内联 commands
    when: { visible: "登录" }
    commands:
      - tapOn: "登录"
- runFlow:
    chance: 0.1                    # 给一组动作挂概率的标准写法
    commands: [ ... ]
```

`repeat` 一轮都没跑(首次求值条件就不成立)或 `branch` 所有分支都不中 → 该命令记为跳过,**不算失败**。

### 变量脚本与请求

```yaml
- defineVariables:
    counter: 0
    comments: "['好看','不错','666']"
- evalScript: "${counter = counter + 1}"      # 外层 ${} 写不写都行,等价
- evalScript: "comments = ['a','b','c']"
- runScript:
    script: "result = a + b"                  # 脚本必须直接写在这里,file: 指向的文件不会被读取
    env: { a: 1, b: 2 }                       # 先注入再执行
- httpRequest:
    url: "https://api.example.com/sms?phone=${PHONE}"
    method: POST                              # 默认 GET
    headers: { Authorization: "Bearer ${TOKEN}" }
    body: { phone: "${PHONE}" }
    outputVariable: code                      # 结果存进 ${code}
    jsonPath: "data.code"                     # 点分路径;数组用 data.0.code,不支持 data[0] 方括号
    retry: { times: 10, interval: [3000, 5000] }
```

`httpRequest` 有几个反直觉行为,都会咬人:

- `retry.times` 是**总尝试次数**,不是额外重试次数(`times: 10` = 一共请求 10 次)。
- **只在 `jsonPath` 抽不到值时才重试**。没写 `jsonPath` 时 retry 完全不生效,第一次就返回。
- **任何响应状态码都不算失败**(4xx / 5xx 照样当成功往下走)。
- **但连不上或超时会让命令直接失败**,`retry` 一次都用不上 —— 它只兜"抽取为空",不兜网络错误。
- **重试用尽仍抽不到时,变量被静默写成空字符串**。所以取完必须自己断言收口。

### 设备

```yaml
- setLocation: { latitude: "37.7749", longitude: "-122.4194" }
# ★ 实际只发一条位置变更广播,不是设置模拟位置提供者 —— 标准 Android 上通常没有接收方,别依赖它
- setAirplaneMode: { enabled: true }
- takeScreenshot
```

---

## §4 元素选择器


所有找元素的命令通用。

```yaml
tapOn:
  text: "登录"              # 全匹配正则,见下
  id: "btn_login"           # 全匹配正则;完整资源 id 和去掉包前缀的都试
  index: "0"                # 第几个,按纵坐标再横坐标排序;支持负数(-1 = 最后一个);支持 ${}
  enabled: true             # 状态匹配,严格相等
  selected: false
  checked: true
  focused: false
  width: 200                # 尺寸匹配
  height: 100
  tolerance: 5              # 尺寸容差,默认 0
  below:   { text: "用户名" } # 空间关系:只比左上角坐标,再按中心距离由近到远
  above:   { text: "页脚" }
  leftOf:  { id: "icon" }
  rightOf: { id: "icon" }
  childOf: { id: "container" }        # 把搜索范围限定在这个父元素子树内,可嵌套
  containsChild: { text: "VIP" }      # 直接子节点里有匹配的
  containsDescendants: [ { text: "A" }, { id: "b" } ]   # 子树里都能找到
  traits: "clickable enabled"         # 空格分隔;支持 clickable/enabled/scrollable/focusable/checkable/selected/focused/checked
  optional: true            # 找不到只警告不失败,且超时 17s→7s(仅限找元素类命令;断言类始终 17s)
  label: "登录按钮"          # 仅日志
```

**`text` 和 `id` 是全匹配正则,这是最容易翻车的一点:**

| 想要的效果 | 写法 |
|---|---|
| 精确等于 "登录" | `text: "登录"` |
| 包含 "登录" | `text: ".*登录.*"` |
| 以 "关注" 开头,剥掉后面的计数 | `text: "关注.*"` |
| 几个词任选其一 | `text: "跳过\|Skip\|以后再说"` |

`text` 会依次比对元素的**文字、提示文字、无障碍描述**,所以描述里的内容也能拿来选。匹配**大小写不敏感**。

⚠️ **文案里的正则元字符会咬人。** `( ) [ ] . * + ? | \ ^ $` 在这里都是正则语法:

- **括号不配对 → 直接抛 `Invalid regular expression`**(不是找不到,是报错):`text: "购买(1"`。
- 配对但你想要字面量时:`text: "确定(2)"` **恰好**能匹配到文字完全等于 `确定(2)` 的元素(有"正则原文 == 元素文字"的兜底),
  但一旦加了通配(`"确定(2).*"`)兜底失效、匹配不到。**含元字符的文案一律转义**(`"确定\\(2\\)"`),或改用 `id`。

**没写 `index` 时,匹配到多个会优先选可点击的那个**,不一定是第一个。要精确定位第 N 个就显式写 `index`。

⚠️ **屏幕外的元素是"找不到",不是"找到但点不着"。** 引擎每次取界面都会剔掉**可见面积不足 10%**
且没有可见子节点的节点 —— 列表底部还没滚出来的项、被容器裁掉的项,选择器写得再准也匹配不到。
要点它,先 `scrollUntilVisible` 滚出来。

另外,父子都匹配时引擎只保留**最深**那个节点。所以 `width` / `height` 比的是最深那个文字节点的尺寸,
不是外层按钮容器;`index` 越界也不会退回第一个,而是直接算"找不到"。

**选择器稳定性排序**:唯一文字(正则剥掉可变部分)> 文字 + 空间关系 / `childOf` 收窄 >
`id`(混淆过的会随版本变)> 百分比坐标 > 绝对像素坐标(**不要用**)。

---

## §5 条件


条件对象**只认 4 个字段**:

```yaml
visible: { text: "加载中" }     # 或字符串简写 visible: "加载中"
notVisible: { text: "错误" }
true: "${counter < 10}"        # 表达式;假值为 空串 / "false" / "undefined" / "null" / 数值 0
label: "描述"                   # 仅日志
```

**求值是"首个命中即返回",不是 AND**,优先级 `true` > `visible` > `notVisible`。一个条件里写多个字段,
后面的**永远不会被检查**。要"A 可见且 B 不可见"就嵌两层 `runFlow`,或用 `true:` 写表达式。
**所有字段都不认识时(比如写了 `platform:`),条件恒为真。**

条件出现在四处:`repeat.while`、`branch` 每个分支的 `when`、`extendedWaitUntil`、**任意命令的 `when`**。

```yaml
- tapOn: { text: "下一步", when: { true: "${step > 2}" } }   # 任意命令都能挂 when
- tapOn: { id: "like", optional: true, chance: 0.4 }        # chance:0~1 概率执行
```

`chance` 是糖,等价于 `when: { true: "${Math.random() < 0.4}" }`。**两个都写时 `when` 生效、`chance` 被忽略。**

⚠️ **`visible` 和 `notVisible` 的耗时方向相反。** `visible` 命中就立刻返回、不命中才付满 7 秒;
`notVisible` 反过来 —— 目标**还在**时会一直轮询到 7 秒耗尽才判假。所以循环守卫优先写成
`while: { visible: "还有下一条" }`,少用 `notVisible`,否则每一轮白付 7 秒。

---

## §6 变量与 `${}`


- **哪些地方会替换 `${}`**:命令的**所有字符串字段**,每条命令执行前统一插值一次。
- **哪些地方不插值(故意的)**:`commands` 和 `branch` 的分支(子命令轮到自己执行时再插,否则 `${Math.random()}`
  会被冻死)、`condition`(否则 `${i < 10}` 冻成常量 → 死循环)、脚本体(那本来就是代码)。
- **`${}` 里就是表达式**:`${a + b}`、`${list[Math.floor(Math.random()*list.length)]}`、`${mode === 'dm'}`。
- **下列数值 / 布尔字段支持 `${}`**,解析期原样保留、运行时才转换 —— **清单以外的布尔字段不要写 `${}`**(见本节末尾):
  `sleep`(含 `[min,max]` 两端)、`swipe.duration` / `direction`、`repeat.times` / `duration`、
  `scrollUntilVisible.speed` / `visibilityPercentage` / `timeout`、`*.waitToSettleTimeoutMs`、
  `eraseText`、`inputRandom*.length`、`waitForAnimationToEnd.timeout`、
  `httpRequest.method` / `retry.times` / `retry.interval`、**`chance`**(运行时 clamp 到 0~1)、
  `pressKey`、`launchApp.clearState` / `stopApp`、`setAirplaneMode.enabled`。
  ```yaml
  - tapOn: { text: "点赞", optional: true, chance: "${LIKE_RATE}" }   # ✅ 概率可以由调度端注入
  - sleep: ["${lo}", "${hi}"]
  - repeat: { times: "${n}", commands: [...] }
  ```
  算出非数字时**静默回落**(多半是 0),要兜底自己写 `${Number(x) || 3000}`。
  上面清单里的布尔字段,假值只认 `false` / `0` / `no` / `off` / `null` / `undefined` / `nan`(不分大小写),
  **其余任何非空字符串都是真** —— `"否"` 是真。

- ⚠️ **清单以外的布尔字段不要写 `${}`,它们没有运行时转换,后果还不一样:**
  - 选择器的 `enabled` / `selected` / `checked` / `focused` 是**严格相等**比较,插值后是字符串 `"true"`,
    永远不等于布尔 `true` → **静默匹配不到任何元素**(最难查的一种)。
  - `centerElement` / `retryTapIfNoChange` / `waitUntilVisible` / `openLink.autoVerify` / `browser`
    则相反:任何非空字符串都是真,`"false"` 也是真。
  这些字段就直接写 `true` / `false` 字面量。

- **把屏幕上的文字读进变量,只有一条路**:`copyTextFrom` 把元素文字写进引擎的虚拟剪贴板,
  然后用 **`${maestro.copiedText}`** 读出来(`setClipboard` 写进去的同样可读)。
  取屏幕上的验证码、计数、昵称都靠它。
  ```yaml
  - copyTextFrom: { id: "code_text" }
  - evalScript: "code = maestro.copiedText"     # 存成普通变量,后面随便用
  - inputText: "${code}"
  ```
- **转义**:要输出字面量 `${x}` 就写 `\${x}`。
- **沙箱限制**:单次表达式 **200ms 超时**,禁用动态代码生成,拿不到任何系统级全局对象。
  `console.log` 能调用但**输出没有任何地方接收**,别指望用它调试。别在 `${}` 里写重活 ——
  超时会**终止整个任务**(顶层命令的 `${}` 求值不在保护区内)。
- **作用域**:**只有 `runFlow` 和 `retry` 开新作用域**,而且**回收只管一部分变量** ——
  被回收的是 `defineVariables` / `runScript.env` / `httpRequest.outputVariable` 定义的;
  **`evalScript` 里 `x = ...` 的直接赋值不受作用域管,永远留在外面**。
  所以要把子流程里算出的值带出来,**用 `evalScript` 赋值**(不需要外层占位);
  反过来用 `defineVariables` 一定带不出来 —— 出块时会被还原成外层的旧值。
  **`repeat` 和 `branch` 不开** —— 循环体里定义或修改的变量会留到下一轮和循环外。计数器就靠这个:

  ```yaml
  - defineVariables: { i: 0 }
  - repeat:
      while: { true: "${i < 5}" }
      commands:
        - evalScript: "i = i + 1"      # 改动对下一轮的 while 可见
  ```

- **子流程里的 `defineVariables` 有两个特殊行为**:值**不做 `${}` 插值**(原样存字面量),而且会被**提取到块首**
  优先执行。子流程里要基于变量算新值,用 `evalScript`。
- **变量保留 YAML 原始类型**:`defineVariables: { n: "5" }` 里的 `n` 是**字符串**,`${n + 1}` 得到 `"51"` 而不是 6。
  数字别加引号,或写 `${Number(n) + 1}`。

---

## §7 默认值与硬限制


| 项 | 值 |
|---|---|
| 元素查找超时 | 17,000 ms |
| `optional: true` 时查找超时 | 7,000 ms |
| 点击滑动后等界面稳定 | 最多 1,500 ms 等反应 **+ 2,000 ms 等稳定 ≈ 3.5 s**(`waitToSettleTimeoutMs` 给了则两阶段共用它,上限 30,000) |
| `assertNotVisible` 等消失 | 17,000 ms(与 `assertVisible` 同,加不加 `optional` 都一样) |
| **条件**里的元素查找(`when` / `repeat.while` / `branch.when`) | 7,000 ms **每次** |
| 表达式执行超时 | **200 ms** |
| `waitForAnimationToEnd` | 15,000 ms |
| `swipe.duration` 默认 | 400 ms |
| `scrollUntilVisible` 超时 / 速度 | 20,000 ms / 40 |
| `repeat.times` 上限 | **1,000 次**,超了静默截断 |
| `repeat` 不写 duration 时的隐式上限 | **30 分钟** |
| `retry.maxRetries` 上限 | **3** |
| 单条命令被异常处理器搭救 | 最多 5 次 |
| `eraseText` 默认 | 50 个字符 |
| 请求超时 / 默认重试间隔 | 30 s / 3,000 ms |
| 同时运行的任务上限 / 同一台设备同时任务数 | 10 / **1** |

⚠️ **元素查找超时会被"距上次交互的耗时"扣掉。**
**不算交互的完整清单**:`sleep`、**所有断言类**(`assertVisible` / `assertNotVisible` / `assertTrue` /
`extendedWaitUntil`)、`httpRequest`、`defineVariables`、`takeScreenshot`、`setAirplaneMode`。
所以**连续几条断言是共用一个越来越小的窗口**,不是各自 17 秒。
反过来 **`evalScript` / `runScript` 算交互** —— 断言前插一条 `- evalScript: "1"` 就能把窗口重置回满值。

举例:

```yaml
- sleep: 30000
- assertVisible: "首页"     # ← 17 秒窗口已被扣光,几乎是"查一次就判失败"
```

要留出确定的等待窗口,把等待挪到断言**之后**,或改用 `extendedWaitUntil` 显式给 timeout。

⚠️ **推算能跑多久。** `repeat.duration` 想跑 2 小时做不到 —— 1000 次迭代上限会先到。
单轮 6 秒 → 约 100 分钟封顶。要更久就拆成多个任务,或多层 `repeat` 嵌套。

---

