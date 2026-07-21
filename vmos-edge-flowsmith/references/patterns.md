# 常用结构

抄来改,别从零发明。每个结构都已经把失败语义和拟人化底线考虑进去了 ——
**你要改的是选择器和数值,不是结构。**

**目录**:1 骨架 · 2 启动与锚点 · 3 轮询重试 · 4 有界批量 · 5 无限流浏览 · 6 弹窗 ·
7 多态页面 · 8 取验证码 · 9 翻列表 · 10 计数与收口

## §1 一份脚本的骨架

```yaml
appId: com.example.app
name: 干什么的
env:                          # 会变的量全在这儿,调度端用 API env 覆盖(API 值锁定,YAML 改不动)
  MSG: "默认文案"
  MAX_NUM: 10                 # 数字别加引号,否则算术会变成字符串拼接
  RUN_MINUTES: 20
exceptionHandlers:            # 随时可能冒出来的弹窗放这里(必现的写进主干)
  - text: "允许"
    maxTriggerCount: 3
---
# ── 初始化 ──
- launchApp
- sleep: [3000, 5000]
- assertVisible: "首页锚点"     # 顶层断言:没进对页面就该停

# ── 主流程 ──
# ...

# ── 收口 ──
- assertTrue: "${done === true}"
```

## §2 启动与锚点

```yaml
- pressKey: home
- sleep: [1500, 3000]
- launchApp: { appId: "${PKG}", stopApp: true }
- sleep: [3500, 6000]           # 冷启动慢,给够
- assertVisible: "推荐"          # ★ 锚点:确认真进到了目标页,没进就停,别往下瞎点
```

⚠️ 上面这样写其实是有代价的:`sleep` **不算交互**,它耗掉的 3.5~6 秒会从断言的 17 秒查找窗口里扣掉,
只剩下 11 秒左右。冷启动慢的 App 要留足窗口,就别用 `sleep` + `assertVisible`,直接用 `extendedWaitUntil`
显式给 timeout:

```yaml
- launchApp: { appId: "${PKG}", stopApp: true }
- extendedWaitUntil: { visible: "推荐", timeout: "20000" }   # 窗口确定,不被扣
```

## §3 轮询重试(替代不生效的 `retry`)

```yaml
- repeat:
    times: "5"
    while: { notVisible: "提交成功" }      # 成功了就自然停
    commands:
      - tapOn: { text: "提交", optional: true }
      - sleep: [1500, 3000]
- assertVisible: "提交成功"                 # ★ 顶层收口,真失败在这里暴露
```

这里的 `notVisible` 每轮要轮询满 7 秒才判假 —— **在这个场景里那 7 秒本来就是在等结果出现,不算亏**。
但同样的写法用在"还有没有下一条"这类守卫上就是纯亏,那种场合改用 `visible`(见 `syntax.md` §5)。
```yaml
```

## §4 有界批量动作(私信 / 关注 / 删除)

```yaml
- repeat:
    times: "${MAX_NUM}"                    # 上限可配,别烧死
    while: { visible: "新会话" }            # 没得可做就自动收敛,等效跳出
    commands:
      - tapOn: { text: "新会话", optional: true }
      - sleep: [2000, 3200]
      - tapOn: { text: "发消息", optional: true }
      - inputText: "${MSG}"
      - sleep: [900, 1600]
      - tapOn: "发送"                       # ← 危险动作:确认过用户要它才写
      - sleep: [1600, 2600]
      - back
      - sleep: [1600, 2600]
```

**批量循环里别塞断言** —— 失败不冒泡,写了也保护不了。要统计成败就在循环里累加计数,循环外断言(见 §10)。

## §5 无限流浏览

```yaml
- repeat:
    duration: "${RUN_MINUTES * 60 * 1000}"
    commands:
      - swipe:
          direction: UP
          duration: [200, 500]
          waitToSettleTimeoutMs: 0          # ★ 信息流永远不"稳定",别白等
      - sleep: [3000, 8000]                 # 看这条内容 —— 节奏的主要来源
      - runFlow:                            # 概率深度停留
          chance: 0.25
          commands: [ { sleep: [6000, 15000] } ]
      - tapOn: { text: "点赞视频。.*", optional: true, chance: 0.4 }
```

无限流通常没有"到底"标志,靠时长收敛即可。**注意迭代次数硬上限会先于时长到**(`syntax.md` §7)。

## §6 弹窗:偶发的自动拦,必现的写主干

```yaml
# 偶发 → 顶部 exceptionHandlers,给 maxTriggerCount 防死循环

# 必现但不一定出现 → 主干里显式判断,可读性好得多
- runFlow:
    when: { visible: "跳过|稍后|Skip" }     # ★ 一个条件只写一个字段
    commands:
      - tapOn: "跳过|稍后|Skip"
      - sleep: [1500, 2500]
```

## §7 一个入口可能是几种页面

```yaml
- defineVariables: { onUnknownPage: false }      # ★ 必须占位:else 没走到时它就是未定义,
                                                 #   顶层 ${未定义} 会直接终止整个任务
- branch:
    - when: { visible: "从图片库中选择" }
      commands: [ { tapOn: "从图片库中选择" } ]
    - when: { visible: "更换照片" }
      commands:
        - tapOn: "更换照片"
        - tapOn: "从图片库中选择"
    - commands:                              # ★ 留 else,否则全不中时整条被静默跳过
        - evalScript: "onUnknownPage = true"
- assertTrue: "${!onUnknownPage}"             # 顶层收口
```

## §8 从接口取验证码

```yaml
- defineVariables: { code: "" }               # ★ 先占位:引用未定义变量会终止整个任务
- httpRequest:
    url: "https://api.example.com/sms?phone=${PHONE}"
    outputVariable: code
    jsonPath: "data.code"                     # 没有 jsonPath 时 retry 完全不生效
    retry: { times: 10, interval: [3000, 5000] }   # times 是总次数;这是 httpRequest 自己的 retry,
                                                   # 和那个不生效的 retry 命令毫无关系,它是真会重试的
- assertTrue: "${code !== ''}"                # ★ 抽取失败会静默写空串,必须自己收口
- tapOn: { id: "code_input" }
- inputText: "${code}"
```

请求不算"交互",所以它后面若要断言等待,用 `extendedWaitUntil` 显式给 timeout。

## §9 翻列表找目标

```yaml
- scrollUntilVisible:
    element: { text: "关于本机" }
    direction: DOWN
    timeout: "20000"
    from: { id: "settings_list" }             # 可选:手势限制在这个容器内
- tapOn: "关于本机"
```

`from` 在"页面有多个可滚区域"时很有用,比如左右分栏、内嵌列表。

## §10 计数与顶层收口

循环和分支不开新作用域(规则见 `syntax.md` §6),所以计数器能跨轮累加:

```yaml
- defineVariables: { sent: 0 }
- repeat:
    times: "${MAX_NUM}"
    while: { visible: "新会话" }
    commands:
      - tapOn: "发送"
      - evalScript: "sent = sent + 1"
- assertTrue: "${sent > 0}"                   # 一条都没发出去 = 失败
```

`runFlow` 和 `retry` 确实会开新作用域,但**回收只管 `defineVariables` 那类赋值** ——
`evalScript` 里的 `x = ...` 不受作用域管、永远留在外面。所以要把子流程里的结果带出来,
**就用 `evalScript` 赋值**;用 `defineVariables` 反而带不出来(出块会被还原成外层旧值),
在外层加占位也救不回来。

**每个脚本都该有收口。** 嵌套块里的失败不冒泡,任务成败必须在顶层显式判定:

```yaml
- evalScript: "loggedIn = true"      # 流程中间置标志
- assertTrue: "${loggedIn === true}" # 结尾统一收口
- assertVisible: "个人主页"
```

没有收口的脚本,出了错也报"成功",排障时只能一条条翻步骤状态。
