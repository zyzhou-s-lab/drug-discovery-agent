# 前端 QC 方案（每次改动后执行）

> 成品检验（Quality **Control**）：前端每次改动 → 上线 → 用 agent-browser（CDP）
> 检查真实运行的 UI。冒烟 + 定向回归 + **控制台零错误**三关；改到组件时额外做
> 「测自己 → 测别人不受影响 → 截图内联发给用户」闭环。
>
> 自动化入口：skill `/qc-frontend`。本文件是其权威依据（skill 内容与此保持一致）。

## 0. 固定环境常量（写死，别每次猜）

| 项 | 值 | 备注 |
|---|---|---|
| 前端 URL | `http://100.123.160.102:5173/` | **用 tailscale IP**，绕过 vite host 校验；DNS 名会 403 |
| GPU ssh | `ssh gpu-zhouy1`（User zhouy1） | 走 tailnet |
| GPU 仓库 | `~/Projects/drug-discovery-agent` | web = vite HMR，engine = systemd |
| 引擎 API（GPU 内） | `localhost:8099` | intake/config 等可直测 |
| 公网入口 | `http://104.249.172.61:8088/`（akko，`tailscale ssh root@akko`） | 独立 nginx `nginx -c /etc/nginx/dda-standalone.conf` |
| 截图工作目录 | 先 `cd /tmp/dda-qa` | agent-browser 存到 daemon cwd，不 cd 会落 `$HOME` |

## 1. 部署改动（增量 bundle；scp 会卡就用 ssh 管道）

```bash
cd /tmp/dda-web
git add <明确路径>          # 铁律：绝不 git add -A（scratch clone 会误删文件）
git commit -m "..." && git push origin master
GPUHEAD=$(ssh gpu-zhouy1 'cd ~/Projects/drug-discovery-agent && git rev-parse --short HEAD')
git bundle create /tmp/d.bundle $GPUHEAD..master
ssh gpu-zhouy1 'cat > /tmp/d.bundle' < /tmp/d.bundle          # 管道，不用 scp
ssh gpu-zhouy1 'cd ~/Projects/drug-discovery-agent && git fetch /tmp/d.bundle master:refs/remotes/bundle/master && git reset --hard bundle/master'
# web 改动 → vite 自动 HMR，无需重启
# engine 改动 → 必须 systemctl --user restart dda-engine-ts.service
```

## 2. 构建门（上线前，本地）

```bash
cd /tmp/dda-web/web && bunx tsc --noEmit    # ← 真正的门，必须过
bunx vite build                              # 只是打包，不做类型检查，别拿它当验证
```

> 教训：`vite build` 绿 ≠ 代码对（它跳过 tsc）。删 import 时 vite 绿但 tsc 抓出未定义引用。

## 3. 冒烟（每次改动都做）

```bash
cd /tmp/dda-qa
agent-browser open "http://100.123.160.102:5173/"
agent-browser wait --text "steatohepatitis"   # 等 API 返回，别截空列表
agent-browser snapshot -i -c                   # 交互元素树：侧栏/campaign 都在？
agent-browser console | grep -iE "error|cannot|undefined|failed"   # ← JS 运行时零错误
```

判定：页面出、campaign 列表出、控制台无**新**报错。

## 4. 定向回归（按改动面走一遍相关 tab，逐个截图）

```bash
agent-browser find text "mash-rerun-wf4" click   # 进一个有数据的 run
agent-browser find text "研究报告" click; agent-browser screenshot 报告.png   # DeepReportView
agent-browser find text "深度研究" click; agent-browser screenshot 深研.png   # DeepResearchPage
# 报告在内层容器滚动，不是 window：
agent-browser eval "document.querySelector('main').scrollBy(0,700)"; agent-browser screenshot ...
```

## 5. 组件改动专项（改了任一组件 → 必走 A→B→C）

**A. 测被改组件本身**

```bash
# 定位组件容器（逐层下钻）
agent-browser eval "Array.from(document.querySelectorAll('#dd-main > *')).map((e,i)=>i+': '+e.className.slice(0,30)).join('\n')"
SEL="#dd-main > div:nth-child(N)"
agent-browser snapshot -s "$SEL" -i           # 该组件交互树：该有的元素都在？
agent-browser click @eX ; agent-browser snapshot -s "$SEL" -i   # 点后状态对？
agent-browser fill @eY "测试输入" ; agent-browser get value @eY # 输入框能打字？
```

**B. 交叉回归 —— 其他组件的点击/输入没被连累（核心）**

> 改一个组件常因共享 state / 布局 / 全局 CSS 波及别人，所以改完必须把页面上**其他**可交互组件也过一遍。

```bash
agent-browser snapshot -i -c                   # 列全页所有交互 ref
# 对“不属于被改组件”的每一类交互点，逐个验证仍然可用：
#   - 侧栏 campaign 按钮：点 → 详情切换正常
#   - StageRail 其他 tab：点 → 视图切换、ref 不失效
#   - 对话输入框：fill 一段字 → get value 能拿到 → 不报错
#   - 设置齿轮 / 新建项目 / 文件：各点开一次 → 弹窗出、能关
agent-browser console | grep -iE "error|cannot|undefined|failed"   # 每轮点完都查：无新错
```

判定 B 通过 = 其他组件**点得动、输得进、切得了、控制台无新错**，ref 不失效。

**C. 把改完的组件截图内联发给用户（强制）**

```bash
agent-browser screenshot "$SEL" comp-changed.png      # 只裁被改组件
```

→ 然后**必须**调用 `mcp__hapi__display_image` 把 `comp-changed.png` 内联展示给用户
（不是只存盘、不是只描述）。每次组件改动收尾都要有这一步。

## 6. 判定标准（全绿才算过）

- [ ] `tsc --noEmit` rc=0
- [ ] 控制台无**新增** error（白名单见已知基线）
- [ ] **A** 被改组件：渲染对、自身点击/输入功能正常
- [ ] **B** 其他组件：点击/输入/切换全部不受影响、ref 不失效
- [ ] **C** 被改组件截图已 `display_image` 内联发给用户
- [ ] 改动涉及的视图肉眼无破版

## 已知基线（**不算 bug**，别误报）

- 控制台 2 条 `Missing Description / aria-describedby` —— Radix Dialog 老警告，组件化前就有。
- 数据库卡片同一 MONDO 记录重复多条 —— 数据层（OT 多本体各列一遍），非渲染 bug。
- 全是「已停止」的 run 看不到 LiteratureCard/CandidateCard —— 无数据，非 bug。

## 常见坑（踩过的）

1. 截图全是方块 → headless Chrome 缺中文字体，`sudo pacman -S noto-fonts-cjk` 后**重启 agent-browser session**。
2. 截图找不到 → 落在 daemon cwd（`$HOME`），先 cd 或事后 mv。
3. 滚动截图全一样 → 报告在 `main` 内层滚，用 `eval scrollBy`，别用 page scroll。
4. 列表 0 运行 → 截早了，先 `wait --text`。
5. `--full-page` 不是合法 flag，用 `--full`。
6. `find role button --name` 匹配不到图标按钮（无可读名）→ 改用 `snapshot -i` 取 ref 再 `click @eN`。
