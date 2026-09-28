# 重工课表助手

针对重庆工程学院（njw.cqie.edu.cn）教务系统的油猴脚本 + PWA 离线查看器，实现课表秒开渲染与移动端离线查看。

## 功能特性

### 油猴脚本（curriculum.user.js）

- **自动登录接力**：识别 CAS/OAuth 统一认证页，自动填入账号密码，验证码只填不提交（人工识别后回车即可）
- **缓存优先渲染**：课表数据存 localStorage，打开页面秒渲染，无需等待接口
- **后台静默校验**：djb2 哈希比对当前周课表，有变化才全量重新抓取，无变化仅更新状态条
- **全学期抓取**：遍历周历所有周次，缓存整学期课表 `{weeks, weekHashes, maxPeriod, currentWeekNum, timestamp}`
- **速览面板**：左下角悬浮状态条 + 点击展开本周课表网格视图（含日期、节次时间、全天事件、考试/临时调课标识）
- **一键同步 PWA**：面板「⇪」按钮把缓存数据用 LZ-String 压缩进 URL hash，跳转到离线查看器
- **零依赖**：`@grant none`，不使用任何 `GM_*` API，所有存储走 localStorage

### 离线查看器（curriculum-pwa）

- 纯静态单页：`index.html` + `sw.js` + `icon.svg`，可部署到任意静态托管（GitHub Pages 等）
- 落地时把 URL hash 中的课表数据存入自身域名 localStorage
- Service Worker 缓存应用壳，实现完全离线访问
- 当前周按 `semesterStart` 实时推算，不依赖同步时的 `currentWeekNum`
- 支持添加到 iOS 主屏幕（standalone 模式）

## 目录结构

```
plugins/
├── curriculum.user.js      # 油猴脚本主文件
└── curriculum-pwa/         # 离线查看器（PWA）
    ├── index.html          # 查看器页面（含全部逻辑）
    ├── sw.js               # Service Worker（离线壳）
    ├── icon.svg            # 应用图标
    └── manifest.json       # （仅作记录，页面不得引用）
```

## 安装与使用

### 1. 安装油猴脚本

- **桌面端**：Chrome / Edge / Firefox 安装 Tampermonkey 扩展，新建脚本粘贴 `curriculum.user.js` 全文
- **iOS**：Userscripts / Stay / 夸克浏览器，同样导入脚本
- 脚本匹配 `https://*.cqie.edu.cn/*`，访问教务系统即自动运行

### 2. 配置账号（可选）

打开课表页 → 点击左下角状态条 → 设置面板填入账号密码。

也可以直接在脚本顶部 `HARDCODED` 常量里写死（优先级更高）：

```js
var HARDCODED = { username: '学号', password: '密码' };
```

### 3. 部署 PWA 查看器

把 `curriculum-pwa/` 目录部署到任意 HTTPS 静态托管（推荐 GitHub Pages），然后把部署后的地址填回脚本的 `CONFIG.viewerUrl`：

```js
viewerUrl: 'https://your-name.github.io/curriculum-pwa/'
```

### 4. 同步到主屏幕（iOS）

1. 在课表页点击面板「⇪」按钮 → 自动跳转到查看器并携带数据
2. 落地后点 Safari 分享按钮 → 「添加到主屏幕」
3. 主屏图标启动即进入 standalone 模式，含完整课表数据

> 注意：课表更新后需重新执行步骤 1–2 覆盖主屏数据。

## 工作原理

### 数据流

```
教务系统课表页
    ↓ (油猴脚本抓取 + 解析 Vue 实例)
localStorage 缓存 (cqie_cc_cache_v2)
    ↓ (点击「⇪」, LZ-String 压缩)
URL hash (#d=...) 跳转
    ↓
curriculum-pwa/index.html 落地
    ↓ (解压并写入)
查看器域名 localStorage + sw.js 离线缓存
    ↓
主屏幕 PWA 独立运行
```

### 缓存结构

```js
{
  weeks: { 1: [course...], 2: [...], ... },   // 按周次分组
  weekHashes: { 1: 'a1b2', ... },              // djb2 哈希用于快速比对
  maxPeriod: 12,                               // 最大节次
  periodTimes: ['08:30~09:15', ...],           // 节次作息表
  maxWeek: 20,                                 // 学期总周数
  currentWeekNum: 5,                           // 抓取时的当前周
  timestamp: 1727481600000                     // 抓取时间戳
}
```

### 兼容性

- 脚本必须使用 `@grant none`（iOS Userscripts / Stay / 夸克沙盒环境不支持 `GM_*` API）
- 所有数据存储必须通过 `store.get/set` 封装的 localStorage
- iOS 14.1 以下不支持 `inset` 和 flex `gap` 属性，样式已做兼容修正
- **关键坑**：iOS 16.4+ 若页面 `<link>` 引用 `manifest.json`，添加主屏的启动 URL 会被 manifest 的 `start_url` 劫持，URL hash 携带的数据丢失 → 查看器**不得引用 manifest**（`manifest.json` 仅作记录保留在目录中）
- iOS 主屏 PWA 与 Safari 的 localStorage **相互隔离**，必须保留落地页 hash（不可 `replaceState` 清掉），靠「添加到主屏幕时启动 URL 自带 `#d=数据」`把数据带进主屏容器

### LZ-String 拆半内联

- 脚本端仅内联 `compressToBase64` 实现
- 查看器仅内联 `decompressFromBase64` 实现
- 全学期数据约 73KB → 压缩后约 13KB URL，可安全传递

## 配置项（curriculum.user.js 顶部）

| 键 | 默认值 | 说明 |
|---|---|---|
| `debug` | `false` | 调试日志开关 |
| `semesterStart` | `'2026-09-07'` | 开学日期（周一），推算周次与表头日期 |
| `cacheKey` | `'cqie_cc_cache_v2'` | 课表缓存 localStorage 键 |
| `configKey` | `'cqie_cc_config_v1'` | 设置（账号密码）localStorage 键 |
| `vmWaitMs` | `25000` | 等待课表数据最长时间 |
| `formWaitMs` | `12000` | 等待登录表单最长时间 |
| `rowHeight` | `46` | 速览面板每小节高度（px） |
| `viewerUrl` | `https://joel-jiao.github.io/curriculum-pwa/` | 离线查看器地址 |

## License

仅供个人学习使用。
