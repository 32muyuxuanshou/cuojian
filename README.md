# 错见：本地错题复盘簿

面向公考错题记录、复刷和薄弱点诊断的个人应用。Android 包名固定为 `com.xiaoyang.cuojian`。

## 核心功能

- 录入题干、图片、选项、答案与解析、来源、模块、考点、标签、错因、正确思路和避坑提醒。
- 错题库按来源、模块、考点、错因和标签实时生成多选筛选项，支持全选当前结果组题。
- 写题模式随机打乱题目；复习模式先显示无提示白题，主动查看后才展示答案与解析。
- 错题可编辑、删除，每道题有独立的 DeepSeek 连续会话。
- 内置花生十三方法库适配层，只检索当前题相关知识；DeepSeek 负责按需归类、讲解、薄弱点建议与今日“小羊”寄语。
- 本地证据算法计算薄弱点，AI 只解释证据和提出训练建议，不改写薄弱分。
- JSON 手动备份；可选 GitHub 私有仓库端到端加密双向同步。
- 从公开源码仓库的 GitHub Releases 检查更新，Android 端下载后交由系统确认安装。

## 本地数据与密钥

错题、图片、作答轨迹和会话保存在浏览器/应用的 IndexedDB。GitHub 同步启用后，逐题使用 AES-GCM 加密再上传到私有仓库；同步口令不会上传。API Key、GitHub Token 和同步口令仅保存在当前设备，不写入源码，也不包含在 JSON 备份中。

调用 DeepSeek 时，当前任务所需的题目文字或图片仍会发送到 DeepSeek。今日寄语只发送本轮成绩摘要，不发送题干。

## 自动同步规则

- 启动、回到前台、恢复联网时检查同步。
- 保存、编辑、删除、作答或导入后延迟 8 秒合并同步。
- 同一题的作答轨迹和会话按 ID 追加合并；并发编辑题目正文时保留本地冲突记录，不静默覆盖。
- 当前实现的“后台”指应用打开期间的静默同步。若要在 Android 应用完全关闭后定时同步，需要把 IndexedDB 迁移到原生数据库并接入 WorkManager。

## 开发与构建

需要 Node.js 22.13+、JDK 21 和 Android SDK。

```powershell
npm install
npm run dev
npm run build:mobile
npm run android:sync
```

打 `v*` 标签会触发 GitHub Actions 构建签名 APK 并上传到 Releases。为保证升级安装，必须永久复用同一份签名密钥，并配置仓库 Secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

签名文件和所有密钥均被 `.gitignore` 排除，禁止提交到仓库。

## 花生十三知识适配

`lib/huasheng13-knowledge.ts` 源自 `huasheng13-skill` 的 `master@6a43d776741f69a231eb2d75f9d5d59efe870659`。首版保留单题复盘相关公式、识别步骤和易错点，排除了时效性材料、答案分布和蒙题概率等不适合作为可靠规则的内容。
