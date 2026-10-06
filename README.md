# 错见：本地错题复盘簿

面向公考错题记录、复刷和薄弱点诊断的个人应用。Android 包名固定为 `com.xiaoyang.cuojian`。

## 核心功能

- 录入题干、图片、选项、答案与解析、来源、模块、考点、标签、错因、正确思路和避坑提醒。
- 错题库按来源、模块、考点、错因和标签实时生成多选筛选项，支持全选当前结果组题。
- 写题模式随机打乱题目；复习模式先显示无提示白题，主动查看后才展示答案与解析。
- 错题可编辑、删除，每道题有独立的连续会话。可切换 DeepSeek 或 OpenAI 兼容中转服务。
- 内置花生十三方法库适配层，只检索当前题相关知识；当前 AI 服务负责按需归类、讲解、薄弱点建议与今日“小羊”寄语。
- PDF智能导入：原生文件通读建立题号/卷尾答案索引，再分批提取题目、作答、笔记、分类和原图；共享资料与多个小题关联保存。支持暂停、恢复进度、去重和证据型复盘。
- 本地证据算法计算薄弱点，AI 只解释证据和提出训练建议，不改写薄弱分。
- JSON 手动备份；可选 GitHub 私有仓库端到端加密双向同步。
- 从公开源码仓库的 GitHub Releases 检查更新，Android 端下载后交由系统确认安装。

## 本地数据与密钥

错题、图片、作答轨迹和会话保存在浏览器/应用的 IndexedDB。PDF原文件、导入进度和本次报告另存本机 IndexedDB，目前不包含在错题JSON备份或GitHub同步中；已保存的题目、裁图、笔记则包含。GitHub 同步启用后，逐题使用 AES-GCM 加密再上传到私有仓库；同步口令不会上传。设置页的 API Key、GitHub Token 和同步口令保存在当前设备，不包含在 JSON 备份中。

调用 AI 时，当前任务所需的题目文字、图片或PDF会发送到设置的API服务（中转服务亦可接触这些内容和密钥）。今日寄语只发送本轮成绩摘要，不发送题干。

## PDF与接口设置

设置页选择“GPT · OpenAI兼容中转”，填写API地址、密钥、模型；默认接口为 Responses，支持原生PDF文件与整页图片结合识别，也可选择 Chat Completions。PDF限制为40MB、120页，按2/4/6页分批并重叠一页。跨试卷重复题号使用sectionKey区分；缺答案、标记含义不明、答案冲突或定位失败均保留疑点，不强行判对错。纯错题集报告只分析错误分布，不推算整体正确率。

个人本机构建可用被Git忽略的 `.env.local` 设置 `VITE_RELAY_API_KEY`、`VITE_RELAY_BASE_URL`、`VITE_RELAY_MODEL`，首次启动预配置接口。**VITE密钥会嵌入构建产物，可被提取，因此此类网页/APK仅供本人使用，不得发布到公开GitHub Releases。** 公共CI没有这些环境变量，必须由用户在设置页输入自己的密钥。

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
