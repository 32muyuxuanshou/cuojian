'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowLeft, BookOpenCheck, CalendarDays, Check, ChevronRight, CirclePlus,
  Clock3, Cloud, Download, FileImage, Filter, Flame, ImagePlus, Loader2, PencilLine, RefreshCw, RotateCcw,
  Search, Send, Settings2, Sparkles, Target, Trash2, Upload, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { DATA_CHANGED_EVENT, deleteQuestion, listQuestions, replaceAllQuestions, saveQuestion, seedQuestions } from '@/lib/local-db';
import { DEEPSEEK_MODEL } from '@/lib/deepseek-client-config';
import { requestDeepSeek } from '@/lib/deepseek-client';
import { diagnoseWeaknesses } from '@/lib/learning-diagnosis';
import { causeTypes, modules, type AiAnalysis, type AiSettings, type AiStudyDiagnosis, type GithubSyncSettings, type QuestionMessage, type ReviewCelebrationInput, type SyncStatus, type WrongQuestion } from '@/lib/models';
import { topicTaxonomy } from '@/lib/gongkao-skill';
import { APP_VERSION, checkForUpdate, installUpdate, type AvailableUpdate } from '@/lib/app-update';
import { listSyncConflicts, resolveSyncConflict, syncWithGithub } from '@/lib/github-sync';

type View = 'dashboard' | 'library' | 'add' | 'edit' | 'stats' | 'settings' | 'detail' | 'practice' | 'review';
type ClassificationResult = {
  stem?: string;
  detectedSource?: string;
  module?: string;
  topic?: string;
  tags?: string[];
  options?: Partial<Record<'A' | 'B' | 'C' | 'D', string>>;
  uncertainties?: string[];
};

const selectClass = 'h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20';
const defaultGithubSync: GithubSyncSettings = { owner: '32muyuxuanshou', dataRepo: 'cuojian-data', branch: 'main', token: '', passphrase: '', autoSync: true };

export function CuojianApp() {
  const [questions, setQuestions] = useState<WrongQuestion[]>([]);
  const [view, setView] = useState<View>('dashboard');
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<AiSettings>({ apiKey: '', model: DEEPSEEK_MODEL, thinkingMode: 'high' });
  const [githubSync, setGithubSync] = useState<GithubSyncSettings>(defaultGithubSync);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'disabled', message: '尚未配置 GitHub 同步。' });
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate>();
  const [updateMessage, setUpdateMessage] = useState('');
  const syncBusy = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sessionQuestions, setSessionQuestions] = useState<WrongQuestion[]>([]);
  const [sessionIsToday, setSessionIsToday] = useState(false);

  async function refresh() {
    const stored = await listQuestions();
    if (!stored.length && localStorage.getItem('cuojian_initialized') !== 'true') {
      const seeded = seedQuestions();
      await Promise.all(seeded.map(saveQuestion));
      localStorage.setItem('cuojian_initialized', 'true');
      setQuestions(seeded);
    } else setQuestions(stored);
    setLoading(false);
  }

  function syncReady(value: GithubSyncSettings) {
    return Boolean(value.owner && value.dataRepo && value.branch && value.token && value.passphrase.length >= 8);
  }

  async function performSync(value = githubSync, manual = false) {
    if (!syncReady(value)) {
      if (manual) setSyncStatus({ state: 'disabled', message: '请先完整填写仓库、令牌和至少 8 位的加密口令。' });
      return;
    }
    if (syncBusy.current) return;
    syncBusy.current = true;
    setSyncStatus({ state: 'syncing', message: manual ? '正在手动同步…' : '正在后台同步…' });
    try {
      const result = await syncWithGithub(await listQuestions(), value);
      await replaceAllQuestions(result.questions, false);
      await refresh();
      setSyncStatus({
        state: result.conflicts ? 'conflict' : 'success',
        message: result.conflicts
          ? `已合并可安全合并的记录，另有 ${result.conflicts} 道题需要确认冲突。`
          : `同步完成：上传 ${result.uploaded} 道，下载 ${result.downloaded} 道。`,
        lastSyncedAt: result.syncedAt,
        conflicts: result.conflicts,
      });
    } catch (error) {
      setSyncStatus({ state: 'error', message: error instanceof Error ? error.message : 'GitHub 同步失败。' });
    } finally {
      syncBusy.current = false;
    }
  }

  async function runUpdateCheck(manual = false) {
    if (manual) setUpdateMessage('正在检查更新…');
    try {
      const update = await checkForUpdate();
      setAvailableUpdate(update);
      setUpdateMessage(update ? `发现新版本 ${update.version}` : `当前已是最新版（${APP_VERSION}）`);
      localStorage.setItem('cuojian_last_update_check', new Date().toISOString());
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : '检查更新失败。');
    }
  }

  async function resolveAllConflicts(choice: 'local' | 'cloud') {
    const current = new Map((await listQuestions()).map((question) => [question.id, question]));
    for (const conflict of listSyncConflicts()) {
      const resolved = resolveSyncConflict(conflict.id, choice);
      if (resolved) current.set(conflict.id, resolved);
    }
    await replaceAllQuestions([...current.values()]);
    await refresh();
    setSyncStatus({ state: 'idle', message: choice === 'local' ? '已选择保留本机正文，正在等待同步。' : '已选择采用云端正文，正在等待同步。' });
  }

  useEffect(() => {
    const savedSettings = localStorage.getItem('cuojian_deepseek');
    if (savedSettings) {
      try { const parsed = JSON.parse(savedSettings) as Partial<AiSettings>; queueMicrotask(() => setSettings({ apiKey: parsed.apiKey || '', model: DEEPSEEK_MODEL, thinkingMode: parsed.thinkingMode || 'high' })); } catch { /* ignore broken local setting */ }
    }
    let nextSync = defaultGithubSync;
    const savedSync = localStorage.getItem('cuojian_github_sync');
    if (savedSync) {
      try { nextSync = { ...defaultGithubSync, ...JSON.parse(savedSync) as Partial<GithubSyncSettings> }; setGithubSync(nextSync); } catch { /* ignore broken local setting */ }
    }
    setTimeout(async () => {
      await refresh();
      if (nextSync.autoSync && syncReady(nextSync)) void performSync(nextSync);
      const autoUpdate = localStorage.getItem('cuojian_auto_update') !== 'false';
      const lastCheck = Date.parse(localStorage.getItem('cuojian_last_update_check') || '');
      if (autoUpdate && (!Number.isFinite(lastCheck) || Date.now() - lastCheck > 86_400_000)) void runUpdateCheck();
    }, 0);
  }, []);

  useEffect(() => {
    function scheduleSync() {
      if (!githubSync.autoSync || !syncReady(githubSync) || syncBusy.current) return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void performSync(githubSync), 8_000);
    }
    function onVisible() { if (document.visibilityState === 'visible') scheduleSync(); }
    window.addEventListener(DATA_CHANGED_EVENT, scheduleSync);
    window.addEventListener('online', scheduleSync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, scheduleSync);
      window.removeEventListener('online', scheduleSync);
      document.removeEventListener('visibilitychange', onVisible);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [githubSync]);

  const due = useMemo(() => questions.filter((q) => q.status !== 'mastered' && new Date(q.nextReviewAt) <= new Date()), [questions]);
  const selected = questions.find((q) => q.id === selectedId);
  const attempts = questions.flatMap((q) => q.attempts);
  const correctAttempts = attempts.filter((a) => a.correct).length;
  const mastery = questions.length ? Math.round((questions.filter((q) => q.status === 'mastered').length / questions.length) * 100) : 0;

  function navigate(next: View) { setView(next); if (next !== 'detail' && next !== 'edit') setSelectedId(undefined); }
  function openQuestion(id: string) { setSelectedId(id); setView('detail'); }
  function startSession(mode: 'practice' | 'review', selectedQuestions: WrongQuestion[], isToday = false) { setSessionQuestions(selectedQuestions); setSessionIsToday(isToday); setView(mode); setSelectedId(undefined); }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-[1680px] grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)]">
        <Sidebar view={view} counts={{ due: due.length, all: questions.length }} navigate={navigate} />
        <section className="min-w-0 px-5 pb-28 pt-5 sm:px-8 lg:px-10 lg:pb-10 lg:pt-8 xl:px-14">
          {loading ? <LoadingState /> : view === 'dashboard' ? (
            <Dashboard questions={questions} due={due} correctAttempts={correctAttempts} mastery={mastery} onAdd={() => navigate('add')} onSearch={() => navigate('library')} onOpen={openQuestion} onStartPractice={() => startSession('practice', due, true)} onStartReview={() => startSession('review', due, true)} />
          ) : view === 'library' ? (
            <Library questions={questions} search={search} setSearch={setSearch} onOpen={openQuestion} onStart={startSession} />
          ) : view === 'add' || (view === 'edit' && selected) ? (
            <AddQuestion settings={settings} initialQuestion={view === 'edit' ? selected : undefined} onCancel={() => navigate(view === 'edit' ? 'detail' : 'dashboard')} onSaved={async () => { await refresh(); navigate(view === 'edit' ? 'detail' : 'library'); }} />
          ) : view === 'stats' ? (
            <Stats questions={questions} settings={settings} onOpen={openQuestion} onStart={startSession} />
          ) : view === 'settings' ? (
            <Settings settings={settings} setSettings={setSettings} githubSync={githubSync} setGithubSync={setGithubSync} syncStatus={syncStatus} onSync={(value) => performSync(value, true)} onResolveConflicts={resolveAllConflicts} questions={questions} onImported={refresh} availableUpdate={availableUpdate} updateMessage={updateMessage} onCheckUpdate={() => runUpdateCheck(true)} onInstallUpdate={(update) => installUpdate(update)} />
          ) : view === 'practice' || view === 'review' ? (
            <ReviewSession mode={view} questions={sessionQuestions} settings={settings} mastery={mastery} isTodaySession={sessionIsToday} onBack={() => navigate('dashboard')} onChanged={refresh} />
          ) : selected ? (
            <QuestionDetail question={selected} questions={questions} settings={settings} onBack={() => navigate('library')} onEdit={() => navigate('edit')} onChanged={refresh} />
          ) : <Empty title="没有找到这道题" action="返回错题库" onAction={() => navigate('library')} />}
        </section>
        <MobileNav view={view} navigate={navigate} />
      </div>
    </main>
  );
}

function Sidebar({ view, counts, navigate }: { view: View; counts: { due: number; all: number }; navigate: (view: View) => void }) {
  return <aside className="hidden border-r border-border/80 bg-sidebar px-5 py-7 lg:flex lg:flex-col">
    <button className="flex items-center gap-3 px-2 text-left" onClick={() => navigate('dashboard')}>
      <div className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(29,45,52,.16)]"><BookOpenCheck className="size-5" /></div>
      <div><div className="font-heading text-lg font-semibold tracking-tight">错见</div><div className="text-[11px] tracking-[.18em] text-muted-foreground">错题复盘簿</div></div>
    </button>
    <nav className="mt-10 space-y-1.5" aria-label="主要导航">
      <NavItem icon={CalendarDays} label="今日复习" active={view === 'dashboard' || view === 'review' || view === 'practice'} count={`${counts.due}`} onClick={() => navigate('dashboard')} />
      <NavItem icon={Archive} label="错题库" active={view === 'library' || view === 'detail' || view === 'edit'} count={`${counts.all}`} onClick={() => navigate('library')} />
      <NavItem icon={CirclePlus} label="录入错题" active={view === 'add'} onClick={() => navigate('add')} />
      <NavItem icon={Target} label="学习统计" active={view === 'stats'} onClick={() => navigate('stats')} />
    </nav>
    <div className="mt-auto space-y-2">
      <div className="rounded-2xl border border-[#dfd5c5] bg-[#fbf3e6] p-4 text-[#654b2d]"><div className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-3.5" /> DeepSeek 只在需要时出现</div><p className="mt-2 text-xs leading-5 text-[#84694b]">自动整理标签，讲解由你主动发起。</p></div>
      <Button variant="ghost" className={`h-10 w-full justify-start gap-3 px-3 ${view === 'settings' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`} onClick={() => navigate('settings')}><Settings2 /> 设置与备份</Button>
    </div>
  </aside>;
}

function Dashboard({ questions, due, correctAttempts, mastery, onAdd, onSearch, onOpen, onStartPractice, onStartReview }: { questions: WrongQuestion[]; due: WrongQuestion[]; correctAttempts: number; mastery: number; onAdd: () => void; onSearch: () => void; onOpen: (id: string) => void; onStartPractice: () => void; onStartReview: () => void }) {
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const repeated = findTopTopic(questions);
  return <>
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-muted-foreground">{today}</p><h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">今天，把错误变成得分。</h1></div><div className="flex w-full items-center gap-2 sm:w-auto"><Button variant="outline" size="lg" className="h-11 flex-1 rounded-xl bg-card px-4 sm:flex-none" onClick={onSearch}><Search /> 搜索错题</Button><Button size="lg" className="h-11 flex-1 rounded-xl px-4 shadow-sm sm:flex-none" onClick={onAdd}><CirclePlus /> 录入错题</Button></div></header>
    <div className="mt-8 grid gap-4 md:grid-cols-3"><Metric label="今日待复习" value={`${due.length}`} note={due.length ? `预计 ${due.length * 4} 分钟` : '已经清空'} icon={Clock3} tone="warm" /><Metric label="累计复刷" value={`${correctAttempts}`} note="答对记录" icon={Flame} tone="blue" /><Metric label="当前掌握率" value={`${mastery}%`} note={`${questions.filter((q) => q.status === 'mastered').length} / ${questions.length} 道`} icon={Target} tone="green" /></div>
    <div className="mt-9 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]"><section><div className="flex items-end justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="font-heading text-xl font-semibold">今日复习</h2><Badge className="bg-[#f1e6d6] text-[#7a5835]">{due.length} 道</Badge></div><p className="mt-1 text-sm text-muted-foreground">选择一种模式，两种模式互不混用。</p></div></div>
      {due.length ? <><div className="mt-4 grid gap-4 sm:grid-cols-2"><button onClick={onStartPractice} className="group rounded-[22px] border bg-card p-5 text-left shadow-[0_12px_40px_rgba(28,42,47,.05)] transition hover:-translate-y-0.5 hover:border-primary/40"><span className="grid size-10 place-items-center rounded-xl bg-[#e9f1f4] text-[#315a74]"><Check className="size-5" /></span><strong className="mt-4 block font-heading text-lg">写题模式</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">题目随机打乱，只显示题目和选项；完成后进入下一题。</span><span className="mt-5 flex items-center text-sm font-semibold text-primary">开始写题 <ChevronRight className="ml-auto size-4 transition group-hover:translate-x-1" /></span></button><button onClick={onStartReview} className="group rounded-[22px] border bg-card p-5 text-left shadow-[0_12px_40px_rgba(28,42,47,.05)] transition hover:-translate-y-0.5 hover:border-primary/40"><span className="grid size-10 place-items-center rounded-xl bg-[#fff0e9] text-[#b34f35]"><BookOpenCheck className="size-5" /></span><strong className="mt-4 block font-heading text-lg">复习模式</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">先看白题主动回忆，点击查看后才出现类型、答案和解析。</span><span className="mt-5 flex items-center text-sm font-semibold text-primary">开始复习 <ChevronRight className="ml-auto size-4 transition group-hover:translate-x-1" /></span></button></div><div className="mt-5 overflow-hidden rounded-[22px] border bg-card">{due.slice(0, 3).map((q, index) => <QuestionRow key={q.id} question={q} border={index !== Math.min(due.length, 3) - 1} onClick={() => onOpen(q.id)} />)}</div></> : <Empty title="今天没有待复习的题" body="可以去错题库查看已录入内容，或者录入一道新错题。" action="录入错题" onAction={onAdd} />}</section>
      <aside className="space-y-4"><div className="rounded-[22px] border bg-card p-5 shadow-[0_12px_40px_rgba(28,42,47,.05)]"><div className="flex items-center justify-between"><h2 className="font-heading text-base font-semibold">本地档案</h2><span className="text-sm font-semibold text-primary">{questions.length} 道</span></div><Progress value={mastery} className="mt-4 h-2 bg-[#e8e4dc] [&>div]:bg-[#d65c3a]" /><p className="mt-3 text-xs leading-5 text-muted-foreground">本机是主数据源；可在设置中启用 GitHub 加密同步，并保留独立备份。</p></div>
      {repeated && <button className="w-full rounded-[22px] bg-[#263b43] p-5 text-left text-white shadow-[0_16px_42px_rgba(27,47,55,.18)]" onClick={onSearch}><div className="flex items-center gap-2 text-sm font-semibold text-[#f2c590]"><Target className="size-4" /> 当前高频考点</div><div className="mt-4 font-heading text-lg font-medium">{repeated.label}</div><p className="mt-2 text-sm leading-6 text-white/70">共 {repeated.count} 道相关错题，建议集中复刷并比较错因。</p><span className="mt-5 flex items-center text-sm font-medium">查看这一类错题 <ChevronRight className="ml-auto size-4" /></span></button>}</aside></div>
  </>;
}

type FilterGroup = 'sources' | 'modules' | 'topics' | 'causes' | 'tags';

function Library({ questions, search, setSearch, onOpen, onStart }: { questions: WrongQuestion[]; search: string; setSearch: (v: string) => void; onOpen: (id: string) => void; onStart: (mode: 'practice' | 'review', questions: WrongQuestion[]) => void }) {
  const [filters, setFilters] = useState<Record<FilterGroup, string[]>>({ sources: [], modules: [], topics: [], causes: [], tags: [] });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const facets = {
    sources: unique(questions.map((q) => q.source)),
    modules: modules.slice(1).filter((value) => questions.some((q) => q.module === value)),
    topics: unique(questions.map((q) => q.topic)),
    causes: unique(questions.flatMap((q) => q.attempts.map((a) => a.causeType).filter(Boolean) as string[])),
    tags: unique(questions.flatMap((q) => q.tags)),
  };
  const activeFilters: Record<FilterGroup, string[]> = {
    sources: filters.sources.filter((value) => facets.sources.includes(value)),
    modules: filters.modules.filter((value) => facets.modules.includes(value)),
    topics: filters.topics.filter((value) => facets.topics.includes(value)),
    causes: filters.causes.filter((value) => facets.causes.includes(value)),
    tags: filters.tags.filter((value) => facets.tags.includes(value)),
  };
  const toggle = (group: FilterGroup, value: string) => setFilters((previous) => ({ ...previous, [group]: previous[group].includes(value) ? previous[group].filter((item) => item !== value) : [...previous[group], value] }));
  const selectedCount = Object.values(activeFilters).flat().length;
  const toggleQuestion = (id: string) => setSelectedIds((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  const filtered = questions.filter((q) => {
    const haystack = [q.stem, q.source, q.module, q.topic, ...q.tags, ...q.attempts.map((a) => `${a.causeType} ${a.personalCause}`)].join(' ').toLowerCase();
    const causes = q.attempts.map((a) => a.causeType).filter(Boolean) as string[];
    return haystack.includes(search.trim().toLowerCase())
      && (!activeFilters.sources.length || activeFilters.sources.includes(q.source))
      && (!activeFilters.modules.length || activeFilters.modules.includes(q.module))
      && (!activeFilters.topics.length || activeFilters.topics.includes(q.topic))
      && (!activeFilters.causes.length || activeFilters.causes.some((value) => causes.includes(value)))
      && (!activeFilters.tags.length || activeFilters.tags.some((value) => q.tags.includes(value)));
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((q) => selectedIds.includes(q.id));
  const allQuestionsSelected = questions.length > 0 && questions.every((q) => selectedIds.includes(q.id));
  const toggleFilteredSelection = () => setSelectedIds((previous) => allFilteredSelected ? previous.filter((id) => !filtered.some((q) => q.id === id)) : unique([...previous, ...filtered.map((q) => q.id)]));
  const toggleAllSelection = () => setSelectedIds(allQuestionsSelected ? [] : questions.map((q) => q.id));
  return <><PageHeader eyebrow="本地资料库" title="错题库" description="同组标签可多选，不同分组会组合筛选。" />
    <div className="mt-7 flex flex-col gap-3"><div className="relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-12 rounded-xl bg-card pl-10" placeholder="搜索题干、标签、来源或个人错因" />{search && <button aria-label="清空搜索" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setSearch('')}><X className="size-4" /></button>}</div>
      <div className="space-y-3 rounded-[18px] border bg-card p-4">{([['sources', '来源'], ['modules', '模块'], ['topics', '考点'], ['causes', '错因'], ['tags', '标签']] as const).map(([group, label]) => facets[group].length > 0 && <div key={group} className="grid gap-2 sm:grid-cols-[52px_minmax(0,1fr)]"><span className="pt-1.5 text-xs font-semibold text-[#a85b3d]">{label}</span><div className="flex flex-wrap gap-2">{facets[group].map((value) => <button key={value} onClick={() => toggle(group, value)} aria-pressed={filters[group].includes(value)} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${filters[group].includes(value) ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground'}`}>{value}</button>)}</div></div>)}{selectedCount > 0 && <button className="text-xs text-muted-foreground underline underline-offset-4" onClick={() => setFilters({ sources: [], modules: [], topics: [], causes: [], tags: [] })}>清除全部 {selectedCount} 个筛选</button>}</div></div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">找到 {filtered.length} 道 · 已选 {selectedIds.length} 道</span><div className="flex flex-wrap items-center gap-3"><button disabled={!filtered.length} aria-pressed={allFilteredSelected} className="flex items-center gap-1.5 text-xs font-medium text-primary disabled:opacity-40" onClick={toggleFilteredSelection}><span className={`grid size-4 place-items-center rounded border ${allFilteredSelected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'}`}>{allFilteredSelected && <Check className="size-3" />}</span>{allFilteredSelected ? '取消当前全选' : '全选当前结果'}</button><button aria-pressed={allQuestionsSelected} className="text-xs font-medium text-primary" onClick={toggleAllSelection}>{allQuestionsSelected ? '取消全部' : `全选全部 ${questions.length} 道`}</button><span className="flex items-center gap-1 text-xs text-muted-foreground"><Filter className="size-3.5" /> 最近更新优先</span></div></div>
    {selectedIds.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[18px] border border-primary/20 bg-[#eef2f0] p-3"><span className="mr-auto text-sm font-medium">用已选的 {selectedIds.length} 道题创建练习</span><Button variant="outline" size="sm" onClick={() => onStart('review', questions.filter((q) => selectedIds.includes(q.id)))}><BookOpenCheck /> 复习模式</Button><Button size="sm" onClick={() => onStart('practice', questions.filter((q) => selectedIds.includes(q.id)))}><Check /> 写题模式</Button><button aria-label="清空选题" className="p-1 text-muted-foreground" onClick={() => setSelectedIds([])}><X className="size-4" /></button></div>}
    {filtered.length ? <div className="mt-3 overflow-hidden rounded-[22px] border bg-card">{filtered.map((q, index) => <QuestionRow key={q.id} question={q} border={index !== filtered.length - 1} onClick={() => onOpen(q.id)} selected={selectedIds.includes(q.id)} onSelect={() => toggleQuestion(q.id)} />)}</div> : <Empty title="没有匹配的错题" body="换一个关键词或模块试试。" />}</>;
}

function AddQuestion({ settings, initialQuestion, onCancel, onSaved }: { settings: AiSettings; initialQuestion?: WrongQuestion; onCancel: () => void; onSaved: () => void }) {
  const firstAttempt = initialQuestion?.attempts[0];
  const [form, setForm] = useState(() => ({ source: initialQuestion?.source || '', sourceVerified: initialQuestion?.sourceVerified || false, stem: initialQuestion?.stem || '', A: initialQuestion?.options.A || '', B: initialQuestion?.options.B || '', C: initialQuestion?.options.C || '', D: initialQuestion?.options.D || '', myAnswer: firstAttempt?.answer || '', correctAnswer: initialQuestion?.correctAnswer || '', module: initialQuestion?.module || '判断推理', topic: initialQuestion?.topic || '定义判断', tags: initialQuestion?.tags.join('、') || '', causeType: firstAttempt?.causeType || '知识盲区', personalCause: firstAttempt?.personalCause || '', correctReasoning: initialQuestion?.correctReasoning || '', pitfall: initialQuestion?.pitfall || '' }));
  const [image, setImage] = useState<string | undefined>(initialQuestion?.imageDataUrl);
  const [answerAnalysisImage, setAnswerAnalysisImage] = useState<string | undefined>(initialQuestion?.answerAnalysisImageDataUrl);
  const [analysisDraft, setAnalysisDraft] = useState<AiAnalysis | undefined>(initialQuestion?.analysis);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const analysisFileRef = useRef<HTMLInputElement>(null);
  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const topics = topicTaxonomy[form.module] || [];

  async function pickImage(file?: File) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return setMessage('图片不能超过 12 MB。请先裁剪题目区域。');
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setImage(reader.result); };
    reader.readAsDataURL(file);
  }
  async function pickAnswerAnalysisImage(file?: File) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return setMessage('解析图片不能超过 12 MB。请先裁剪。');
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setAnswerAnalysisImage(reader.result); };
    reader.readAsDataURL(file);
  }
  async function classify() {
    if (!settings.apiKey) { setMessage('请先在“设置与备份”中填写 DeepSeek API Key。'); return; }
    if (!image) { setMessage('请先选择题目图片。'); return; }
    setBusy(true); setMessage('');
    try {
      const data = await requestDeepSeek<ClassificationResult>({ ...settings, action: 'classify', imageDataUrl: image });
      setForm((prev) => ({ ...prev, stem: data.stem || prev.stem, source: data.detectedSource || prev.source, sourceVerified: false, module: data.module || prev.module, topic: data.topic || prev.topic, tags: Array.isArray(data.tags) ? data.tags.join('、') : prev.tags, A: data.options?.A || prev.A, B: data.options?.B || prev.B, C: data.options?.C || prev.C, D: data.options?.D || prev.D }));
      setMessage(data.uncertainties?.length ? `DeepSeek 有 ${data.uncertainties.length} 处不确定，请重点核对。` : '已完成识别和归类，请核对后保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '归类失败'); }
    finally { setBusy(false); }
  }
  async function generateAnswerAnalysis() {
    if (!settings.apiKey) { setMessage('请先在“设置与备份”中填写 DeepSeek API Key。'); return; }
    if (!form.correctAnswer) { setMessage('请先由你确认正确答案，AI只生成解析。'); return; }
    if (!form.stem.trim() && !image) { setMessage('请先填写题干或上传题目图片。'); return; }
    setBusy(true); setMessage('');
    try {
      const options = Object.fromEntries((['A', 'B', 'C', 'D'] as const).filter((key) => form[key]).map((key) => [key, form[key]]));
      const result = await requestDeepSeek<AiAnalysis>({ ...settings, action: 'analyze', imageDataUrls: [image, answerAnalysisImage], question: { stem: form.stem, options, correctAnswer: form.correctAnswer, myAnswer: form.myAnswer, personalCause: form.personalCause, module: form.module, topic: form.topic, imageOrder: answerAnalysisImage ? '第一张是题目原图，第二张是用户提供的官方解析参考；核对参考但不要盲从。' : '图片为题目原图。' }, history: [] });
      setAnalysisDraft(result);
      setForm((previous) => ({ ...previous, correctReasoning: result.correctReasoning || previous.correctReasoning, pitfall: result.pitfall || previous.pitfall }));
      setMessage('AI解析草稿已填入，请核对和修改后再保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '生成解析失败'); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!form.stem.trim() || !form.correctAnswer || !form.myAnswer) { setMessage('请至少填写题干、我的选项和正确答案。'); return; }
    const now = new Date().toISOString();
    const attempts = initialQuestion?.attempts.length
      ? initialQuestion.attempts.map((attempt, index) => {
          const answer = index === 0 ? form.myAnswer : attempt.answer;
          return { ...attempt, answer, correct: answer === form.correctAnswer, ...(index === 0 ? { causeType: form.causeType, personalCause: form.personalCause.trim() } : {}) };
        })
      : [{ id: crypto.randomUUID(), answeredAt: now, answer: form.myAnswer, correct: form.myAnswer === form.correctAnswer, mode: 'initial' as const, causeType: form.causeType, personalCause: form.personalCause.trim() }];
    const answerKeyChanged = Boolean(initialQuestion && initialQuestion.correctAnswer !== form.correctAnswer);
    const coreContentChanged = Boolean(initialQuestion && (initialQuestion.stem !== form.stem.trim() || initialQuestion.correctAnswer !== form.correctAnswer || ['A', 'B', 'C', 'D'].some((key) => (initialQuestion.options[key] || '') !== form[key as 'A' | 'B' | 'C' | 'D'])));
    const question: WrongQuestion = {
      ...initialQuestion,
      id: initialQuestion?.id || crypto.randomUUID(), createdAt: initialQuestion?.createdAt || now, updatedAt: now, source: form.source.trim() || '未填写来源', sourceVerified: form.sourceVerified, stem: form.stem.trim(),
      options: Object.fromEntries((['A', 'B', 'C', 'D'] as const).filter((key) => form[key]).map((key) => [key, form[key]])),
      correctAnswer: form.correctAnswer, answerSource: 'user', module: form.module, topic: form.topic, tags: form.tags.split(/[、,，]/).map((t) => t.trim()).filter(Boolean), imageDataUrl: image,
      status: answerKeyChanged ? 'learning' : initialQuestion?.status || 'learning', reviewLevel: answerKeyChanged ? 0 : initialQuestion?.reviewLevel || 0, nextReviewAt: answerKeyChanged ? now : initialQuestion?.nextReviewAt || now,
      correctReasoning: form.correctReasoning.trim() || undefined, answerAnalysisImageDataUrl: answerAnalysisImage, pitfall: form.pitfall.trim() || undefined, analysis: coreContentChanged && analysisDraft === initialQuestion?.analysis ? undefined : analysisDraft,
      attempts,
    };
    await saveQuestion(question); onSaved();
  }
  return <><button onClick={onCancel} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> 返回</button><PageHeader eyebrow={initialQuestion ? '修正档案' : '快速收录'} title={initialQuestion ? '编辑这道错题' : '录入一道错题'} description={initialQuestion ? '修改录入错误；原有复刷历史会保留。' : '先保存事实，详细讲解可以稍后再生成。'} compact />
    <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(320px,.85fr)_minmax(0,1.15fr)]"><section className="rounded-[22px] border bg-card p-5"><h2 className="font-heading text-lg font-semibold">题目图片</h2><p className="mt-1 text-xs text-muted-foreground">图形、表格题请保留原图，建议先裁剪无关区域。</p><input aria-label="选择题目图片" ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => void pickImage(e.target.files?.[0])} />
      {image ? <div className="relative mt-4 overflow-hidden rounded-2xl border bg-muted">{/* oxlint-disable-next-line next/no-img-element -- 本地 data URL 不适合图片优化器 */}<img src={image} alt="待录入题目" className="max-h-[520px] w-full object-contain" /><button type="button" className="absolute right-3 top-3 rounded-full bg-black/65 p-2 text-white" onClick={() => setImage(undefined)} aria-label="移除图片"><X className="size-4" /></button></div> : <button type="button" aria-label="选择题目截图或照片" onClick={() => fileRef.current?.click()} className="mt-4 grid min-h-64 w-full place-items-center rounded-2xl border border-dashed bg-muted/35 text-muted-foreground transition-colors hover:bg-muted"><span className="flex flex-col items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-card shadow-sm"><ImagePlus /></span><span className="text-sm font-medium text-foreground">选择题目截图或照片</span><span className="text-xs">PNG、JPG，最大 12 MB</span></span></button>}
      <div className="mt-4 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => fileRef.current?.click()}><FileImage /> {image ? '更换图片' : '选择图片'}</Button><Button className="flex-1" disabled={!image || busy} onClick={classify}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} DeepSeek 识别归类</Button></div><p className="mt-3 text-[11px] leading-5 text-muted-foreground">点击识别后，这张图片会发送给 DeepSeek；不点击则始终只保存在本机。</p>{message && <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">{message}</p>}</section>
      <section className="space-y-5 rounded-[22px] border bg-card p-5 sm:p-6"><Field label="来源" hint="DeepSeek 只能提供候选"><Input value={form.source} onChange={(e) => { update('source', e.target.value); setForm((prev) => ({ ...prev, sourceVerified: false })); }} placeholder="例如：2025 国考 · 地市级" className="h-10" /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sourceVerified} onChange={(e) => setForm((prev) => ({ ...prev, sourceVerified: e.target.checked }))} className="size-4 accent-primary" /><span>我已核对来源</span></label><Field label="题干"><Textarea value={form.stem} onChange={(e) => update('stem', e.target.value)} placeholder="粘贴题干，或使用 DeepSeek 从图片中识别" className="min-h-28" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">{(['A', 'B', 'C', 'D'] as const).map((key) => <Field key={key} label={`选项 ${key}`}><Input value={form[key]} onChange={(e) => update(key, e.target.value)} /></Field>)}</div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="我的选项"><select className={selectClass} value={form.myAnswer} onChange={(e) => update('myAnswer', e.target.value)}><option value="">请选择</option>{['A', 'B', 'C', 'D'].map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="正确答案" hint="由官方答案或你本人确认"><select className={selectClass} value={form.correctAnswer} onChange={(e) => update('correctAnswer', e.target.value)}><option value="">请选择</option>{['A', 'B', 'C', 'D'].map((v) => <option key={v}>{v}</option>)}</select></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="大模块"><select className={selectClass} value={form.module} onChange={(e) => { update('module', e.target.value); update('topic', topicTaxonomy[e.target.value]?.[0] || ''); }}>{modules.slice(1).map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="细分考点"><select className={selectClass} value={form.topic} onChange={(e) => update('topic', e.target.value)}>{topics.map((v) => <option key={v}>{v}</option>)}</select></Field></div>
      <Field label="标签" hint="用逗号或顿号分隔"><Input value={form.tags} onChange={(e) => update('tags', e.target.value)} placeholder="例如：基期量、增长率、截位直除" /></Field><Field label="错因类型"><select className={selectClass} value={form.causeType} onChange={(e) => update('causeType', e.target.value)}>{causeTypes.map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="具体个人错因" hint="这是你的判断，AI不会替你填写"><Textarea value={form.personalCause} onChange={(e) => update('personalCause', e.target.value)} placeholder="我当时为什么会选错？" className="min-h-20" /></Field>
      <div className="rounded-[18px] border border-[#e2d8ca] bg-[#fffaf4] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-heading font-semibold">正确答案解析 <span className="font-sans text-xs font-normal text-muted-foreground">可选</span></h3><p className="mt-1 text-xs leading-5 text-muted-foreground">可以留空、手写、上传官方解析图片，或让 DeepSeek 根据题目和选项生成草稿。</p></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={generateAnswerAnalysis}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} AI分析选项</Button></div><div className="mt-4"><Textarea value={form.correctReasoning} onChange={(e) => update('correctReasoning', e.target.value)} placeholder="输入官方解析或你认可的正确思路，也可以留空" className="min-h-28 bg-card" /></div><input aria-label="选择正确答案解析图片" ref={analysisFileRef} hidden type="file" accept="image/*" onChange={(e) => void pickAnswerAnalysisImage(e.target.files?.[0])} />{answerAnalysisImage ? <div className="relative mt-3 overflow-hidden rounded-xl border bg-card">{/* oxlint-disable-next-line next/no-img-element -- 本地 data URL 不适合图片优化器 */}<img src={answerAnalysisImage} alt="正确答案解析" className="max-h-[360px] w-full object-contain" /><button type="button" aria-label="移除解析图片" onClick={() => setAnswerAnalysisImage(undefined)} className="absolute right-2 top-2 rounded-full bg-black/65 p-2 text-white"><X className="size-4" /></button></div> : null}<Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => analysisFileRef.current?.click()}><ImagePlus /> {answerAnalysisImage ? '更换解析图片' : '上传解析图片'}</Button>{analysisDraft && <p className="mt-2 text-xs text-[#8a5a35]">已生成 AI 草稿，保存前仍可修改。AI没有更改你确认的正确答案。</p>}</div>
      <Field label="避坑提醒"><Textarea value={form.pitfall} onChange={(e) => update('pitfall', e.target.value)} placeholder="下次看到什么信号，要避免什么错误？" className="min-h-20" /></Field>{message && <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">{message}</p>}
      <div className="flex justify-end gap-2 border-t pt-5"><Button variant="outline" onClick={onCancel}>取消</Button><Button onClick={submit}><Check /> {initialQuestion ? '保存修改' : '保存到错题库'}</Button></div></section></div></>;
}

function ReviewSession({ mode, questions, settings, mastery, isTodaySession, onBack, onChanged }: { mode: 'practice' | 'review'; questions: WrongQuestion[]; settings: AiSettings; mastery: number; isTodaySession: boolean; onBack: () => void; onChanged: () => Promise<void> }) {
  const [queue] = useState(() => mode === 'practice' ? shuffle(questions) : [...questions]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [submitted, setSubmitted] = useState<boolean>();
  const [results, setResults] = useState<Array<{ correct: boolean }>>([]);
  const [celebration, setCelebration] = useState('');
  const [celebrationError, setCelebrationError] = useState('');
  const [celebrationBusy, setCelebrationBusy] = useState(false);
  const celebrationStarted = useRef(false);
  const questionStartedAt = useRef(Date.now());
  const question = queue[index];
  const finished = queue.length > 0 && index >= queue.length && results.length === queue.length;

  useEffect(() => {
    if (!finished || !isTodaySession || celebrationStarted.current) return;
    celebrationStarted.current = true;
    const day = new Intl.DateTimeFormat('en-CA').format(new Date());
    const cacheKey = `cuojian_lamb_celebration_${day}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { queueMicrotask(() => setCelebration(cached)); return; }
    if (!settings.apiKey) { queueMicrotask(() => setCelebrationError('请先在前端配置文件中填写 DeepSeek API Key，才能生成今天的小羊寄语。')); return; }
    const correct = results.filter((result) => result.correct).length;
    const reviewResult: ReviewCelebrationInput = {
      mode,
      total: queue.length,
      correct: mode === 'practice' ? correct : 0,
      incorrect: mode === 'practice' ? queue.length - correct : 0,
      remembered: mode === 'review' ? correct : 0,
      fuzzy: mode === 'review' ? queue.length - correct : 0,
      mastery,
    };
    queueMicrotask(() => setCelebrationBusy(true));
    void requestDeepSeek<{ message?: string }>({ ...settings, action: 'celebrate', reviewResult, thinkingMode: 'disabled' }).then((result) => {
      if (!result.message) throw new Error('没有生成寄语');
      localStorage.setItem(cacheKey, result.message);
      setCelebration(result.message);
    }).catch((error) => setCelebrationError(error instanceof Error ? error.message : '寄语生成失败')).finally(() => setCelebrationBusy(false));
  }, [finished, isTodaySession, mastery, mode, queue.length, results, settings]);

  async function record(correct: boolean, recordedAnswer: string) {
    if (!question) return;
    const level = correct ? Math.min(question.reviewLevel + 1, 5) : 0;
    const intervals = [1, 3, 7, 14, 30, 60];
    const now = new Date().toISOString();
    await saveQuestion({ ...question, updatedAt: now, reviewLevel: level, nextReviewAt: new Date(Date.now() + intervals[level] * 86_400_000).toISOString(), status: level >= 5 ? 'mastered' : 'learning', attempts: [...question.attempts, { id: crypto.randomUUID(), answeredAt: now, answer: recordedAnswer, correct, mode, selfRating: mode === 'review' ? (correct ? 'mastered' : recordedAnswer === '未想起' ? 'unknown' : 'fuzzy') : undefined, durationMs: Math.max(1_000, Date.now() - questionStartedAt.current), revealedAnswer: mode === 'review' }] });
    setResults((previous) => [...previous, { correct }]);
    await onChanged();
  }
  async function submitPractice() {
    if (!answer || !question) return;
    const correct = answer === question.correctAnswer;
    await record(correct, answer);
    setSubmitted(correct);
  }
  async function gradeReview(rating: 'mastered' | 'fuzzy' | 'unknown') {
    if (!question) return;
    await record(rating === 'mastered', rating === 'mastered' ? question.correctAnswer : rating === 'fuzzy' ? '有点模糊' : '未想起');
    next();
  }
  function next() { setIndex((value) => value + 1); setAnswer(''); setRevealed(false); setSubmitted(undefined); questionStartedAt.current = Date.now(); }

  if (!queue.length) return <><button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> 返回今日复习</button><Empty title="没有可复习的错题" body="录入错题后再来练习。" /></>;
  if (!question) {
    const correct = results.filter((result) => result.correct).length;
    return <><button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> 返回今日复习</button><div className="mx-auto mt-10 max-w-2xl rounded-[28px] border bg-card p-7 text-center shadow-[0_18px_60px_rgba(28,42,47,.08)] sm:p-10"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#fff0e9] text-[#c7684b]"><Sparkles className="size-6" /></span><h1 className="mt-5 font-heading text-2xl font-semibold">本轮完成</h1><p className="mt-2 text-sm text-muted-foreground">已完成 {queue.length} 道题，{mode === 'practice' ? `答对 ${correct} 道` : `想起 ${correct} 道`}。</p>{isTodaySession && <div className="mt-7 rounded-[20px] bg-[#fff8ef] px-5 py-6 text-left"><p className="text-xs font-semibold tracking-wide text-[#b16b39]">今日的小羊寄语</p>{celebrationBusy ? <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> DeepSeek 正在轻轻写一句话……</p> : celebration ? <p className="mt-3 font-heading text-lg leading-8 text-[#654b2d]">{celebration}</p> : <p className="mt-3 text-sm leading-6 text-muted-foreground">{celebrationError || '正在准备今天的寄语……'}</p>}</div>}<Button className="mt-7" onClick={onBack}>返回今日复习</Button></div></>;
  }

  return <><div className="flex items-center justify-between"><button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> 退出{mode === 'practice' ? '写题' : '复习'}</button><span className="text-xs text-muted-foreground">{index + 1} / {queue.length}</span></div><Progress value={(index + 1) / queue.length * 100} className="mt-4 h-1.5" />
    <section className="mx-auto mt-6 max-w-4xl rounded-[22px] border bg-card p-5 shadow-[0_12px_40px_rgba(28,42,47,.05)] sm:p-8">
      {question.imageDataUrl && <>{/* oxlint-disable-next-line next/no-img-element -- 本地 data URL 不适合图片优化器 */}<img src={question.imageDataUrl} alt="题目原图" className="mb-6 max-h-[480px] w-full rounded-xl border bg-white object-contain" /></>}
      <p className="whitespace-pre-wrap text-[16px] font-medium leading-8 sm:text-lg">{question.stem}</p>
      <div className="mt-6 grid gap-3">{Object.entries(question.options).map(([key, value]) => <button key={key} disabled={mode === 'review' || submitted !== undefined} onClick={() => setAnswer(key)} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${answer === key ? 'border-primary bg-[#eef2f0]' : 'bg-card hover:bg-muted/50'}`}><span className="grid size-7 shrink-0 place-items-center rounded-full border text-sm font-semibold">{key}</span><span className="pt-0.5 text-sm leading-6">{value}</span></button>)}</div>
      {mode === 'practice' && submitted === undefined && <Button className="mt-6 h-11 w-full" disabled={!answer} onClick={submitPractice}>提交答案</Button>}
      {mode === 'practice' && submitted !== undefined && <div className={`mt-6 rounded-xl p-4 text-sm ${submitted ? 'bg-[#edf6ef] text-[#315f42]' : 'bg-[#fff0e9] text-[#9a452f]'}`}><div className="flex items-center justify-between"><strong>{submitted ? '回答正确' : '回答错误'}</strong><Button size="sm" onClick={next}>{index + 1 === queue.length ? '完成' : '下一题'} <ChevronRight /></Button></div></div>}
      {mode === 'review' && !revealed && <Button className="mt-6 h-11 w-full" onClick={() => setRevealed(true)}>查看答案</Button>}
    </section>
    {mode === 'review' && revealed && <section className="mx-auto mt-5 max-w-4xl space-y-5"><div className="rounded-[22px] border bg-card p-5 sm:p-7"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{question.module}</Badge><Badge variant="outline">{question.topic}</Badge>{question.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Info label="正确答案" value={question.correctAnswer} /><Info label="首次错因" value={question.attempts[0]?.personalCause || question.attempts[0]?.causeType || '未填写'} /></div>{question.correctReasoning && <AnalysisItem title="正确答案解析" body={question.correctReasoning} />}{question.answerAnalysisImageDataUrl && <AnswerAnalysisImage src={question.answerAnalysisImageDataUrl} />}{question.pitfall && <AnalysisItem title="避坑提醒" body={question.pitfall} />}{question.analysis && <div className="mt-5"><AnalysisBlock analysis={question.analysis} /></div>}</div><div className="grid gap-3 sm:grid-cols-3"><Button variant="outline" className="h-12" onClick={() => void gradeReview('unknown')}>仍然不会</Button><Button variant="outline" className="h-12" onClick={() => void gradeReview('fuzzy')}>有点模糊</Button><Button className="h-12" onClick={() => void gradeReview('mastered')}>已经掌握</Button></div></section>}
  </>;
}

function QuestionDetail({ question, questions, settings, onBack, onEdit, onChanged }: { question: WrongQuestion; questions: WrongQuestion[]; settings: AiSettings; onBack: () => void; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const latestCause = question.attempts[question.attempts.length - 1];
  async function analyze() {
    if (!settings.apiKey) return setMessage('请先在设置中填写 DeepSeek API Key。');
    setBusy(true); setMessage('');
    const history = questions.filter((q) => q.id !== question.id && (q.topic === question.topic || q.module === question.module)).slice(0, 5).map((q) => ({ id: q.id, topic: q.topic, cause: q.attempts.at(-1)?.personalCause, results: q.attempts.map((a) => a.correct) }));
    try {
      const analysis = await requestDeepSeek<AiAnalysis>({ ...settings, action: 'analyze', imageDataUrl: question.imageDataUrl, question: { stem: question.stem, options: question.options, correctAnswer: question.correctAnswer, myAnswer: latestCause?.answer, personalCause: latestCause?.personalCause, module: question.module, topic: question.topic }, history });
      const now = new Date().toISOString();
      const analysisMessage: QuestionMessage = { id: crypto.randomUUID(), role: 'assistant', content: `${analysis.summary}\n\n正确思路：${analysis.correctReasoning}\n\n避坑提醒：${analysis.pitfall}`, createdAt: now };
      await saveQuestion({ ...question, analysis, conversation: [...(question.conversation || []), analysisMessage], conversationSummary: analysis.summary, updatedAt: now }); setMessage('分析已保存到本地，也已加入本题会话。'); onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : '分析失败'); } finally { setBusy(false); }
  }
  async function sendChat() {
    const prompt = chatInput.trim();
    if (!prompt || chatBusy) return;
    if (!settings.apiKey) return setMessage('请先在前端配置文件中填写 DeepSeek API Key。');
    const now = new Date().toISOString();
    const userMessage: QuestionMessage = { id: crypto.randomUUID(), role: 'user', content: prompt, createdAt: now };
    const conversation = [...(question.conversation || []), userMessage];
    const history = questions.filter((item) => item.id !== question.id && (item.topic === question.topic || item.tags.some((tag) => question.tags.includes(tag)))).slice(0, 5).map((item) => ({ id: item.id, source: item.source, topic: item.topic, cause: item.attempts.at(-1)?.personalCause, results: item.attempts.map((attempt) => attempt.correct) }));
    setChatInput(''); setChatBusy(true); setMessage('');
    try {
      const shouldSendImage = Boolean(question.imageDataUrl && (!(question.conversation?.length) || /图|图片|图形|选项|细节/.test(prompt)));
      const result = await requestDeepSeek<{ reply?: string; summary?: string }>({ ...settings, action: 'chat', imageDataUrl: shouldSendImage ? question.imageDataUrl : undefined, question: { stem: question.stem, options: question.options, correctAnswer: question.correctAnswer, answerSource: question.answerSource, module: question.module, topic: question.topic, tags: question.tags, personalCause: latestCause?.personalCause, conversationSummary: question.conversationSummary }, history, messages: conversation.slice(-10).map(({ role, content }) => ({ role, content })) });
      if (!result.reply) throw new Error('DeepSeek 没有返回有效回答');
      const assistantMessage: QuestionMessage = { id: crypto.randomUUID(), role: 'assistant', content: result.reply, createdAt: new Date().toISOString() };
      await saveQuestion({ ...question, conversation: [...conversation, assistantMessage], conversationSummary: result.summary || question.conversationSummary, updatedAt: assistantMessage.createdAt });
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : '追问失败'); setChatInput(prompt); } finally { setChatBusy(false); }
  }
  async function resetConversation() {
    if (!confirm('确定清空这道题的会话吗？题目和作答记录会保留。')) return;
    await saveQuestion({ ...question, conversation: [], conversationSummary: undefined, updatedAt: new Date().toISOString() });
    onChanged();
  }
  async function toggleMastered() { await saveQuestion({ ...question, status: question.status === 'mastered' ? 'learning' : 'mastered', updatedAt: new Date().toISOString() }); onChanged(); }
  async function remove() { if (!confirm('确定删除这道错题吗？此操作无法撤销。')) return; await deleteQuestion(question.id); onChanged(); onBack(); }
  return <><button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> 返回</button><div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge variant="secondary">{question.module}</Badge><Badge variant="outline">{question.topic}</Badge>{question.isDemo && <Badge variant="outline">示例数据</Badge>}</div><h1 className="mt-3 max-w-4xl font-heading text-2xl font-semibold">错题详情</h1></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onEdit}><PencilLine /> 编辑</Button><Button variant="outline" onClick={toggleMastered}>{question.status === 'mastered' ? <RotateCcw /> : <Check />}{question.status === 'mastered' ? '恢复复习' : '标为掌握'}</Button><Button variant="destructive" onClick={remove}><Trash2 /> 删除</Button></div></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]"><section className="space-y-5"><div className="rounded-[22px] border bg-card p-5 sm:p-7"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{question.source}{!question.sourceVerified ? ' · 来源待核对' : ''}</span><span>已复刷 {Math.max(0, question.attempts.length - 1)} 次</span></div>{question.imageDataUrl && <>{/* oxlint-disable-next-line next/no-img-element -- 本地 data URL 不适合图片优化器 */}<img src={question.imageDataUrl} alt="题目原图" className="mt-5 max-h-[460px] w-full rounded-xl border bg-white object-contain" /></>}<p className="mt-5 whitespace-pre-wrap text-[16px] leading-8">{question.stem}</p><div className="mt-5 grid gap-3">{Object.entries(question.options).map(([key, value]) => <div key={key} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${key === question.correctAnswer ? 'border-[#77a084] bg-[#edf6ef]' : 'bg-card'}`}><span className="grid size-7 shrink-0 place-items-center rounded-full border text-sm font-semibold">{key}</span><span className="pt-0.5 text-sm leading-6">{value}</span></div>)}</div>{message && <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{message}</p>}</div>
      <div className="rounded-[22px] border bg-card p-5 sm:p-7"><div className="grid gap-4 sm:grid-cols-2"><Info label="正确答案" value={question.correctAnswer} /><Info label="答案依据" value={question.answerSource === 'official' ? '官方答案' : question.answerSource === 'user' ? '用户确认' : 'AI推测，待确认'} /><Info label="首次错误" value={question.attempts[0]?.answer || '未记录'} /><Info label="个人错因" value={latestCause?.personalCause || latestCause?.causeType || '未填写'} /></div>{question.correctReasoning && <AnalysisItem title="正确答案解析" body={question.correctReasoning} />}{question.answerAnalysisImageDataUrl && <AnswerAnalysisImage src={question.answerAnalysisImageDataUrl} />}{question.pitfall && <AnalysisItem title="我记录的避坑提醒" body={question.pitfall} />}</div>
      {question.analysis && <AnalysisBlock analysis={question.analysis} />}
      <div className="rounded-[22px] border bg-card p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-lg font-semibold">继续问这道题</h2><p className="mt-1 text-xs text-muted-foreground">会话只保存在本题档案中；回答会结合相关 Skill 和有证据的同类错题。</p></div>{Boolean(question.conversation?.length) && <Button variant="ghost" size="sm" onClick={() => void resetConversation()}>重置会话</Button>}</div>{question.conversation?.length ? <div className="mt-5 space-y-3">{question.conversation.map((item) => <div key={item.id} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-7 ${item.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}><p className="whitespace-pre-wrap">{item.content}</p><p className={`mt-1 text-[10px] ${item.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{formatDate(item.createdAt)}</p></div>)}</div> : <p className="mt-5 rounded-2xl bg-muted px-4 py-4 text-sm text-muted-foreground">分析后继续追问，或者直接问“为什么不能选 B？”“我以前错过类似题吗？”</p>}<div className="mt-5 flex items-end gap-2"><Textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="继续追问这道题……" className="min-h-20 resize-none" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} /><Button aria-label="发送追问" className="h-11 w-11 shrink-0 p-0" disabled={!chatInput.trim() || chatBusy} onClick={() => void sendChat()}>{chatBusy ? <Loader2 className="animate-spin" /> : <Send />}</Button></div></div></section>
      <aside className="space-y-4"><div className="rounded-[22px] border bg-card p-5"><h2 className="font-heading font-semibold">标签</h2><div className="mt-3 flex flex-wrap gap-2">{question.tags.length ? question.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>) : <span className="text-sm text-muted-foreground">暂无标签</span>}</div></div><div className="rounded-[22px] border bg-card p-5"><h2 className="font-heading font-semibold">复习轨迹</h2><div className="mt-4 space-y-4">{question.attempts.map((attempt, i) => <div key={attempt.id} className="flex gap-3"><span className={`mt-1 size-2.5 rounded-full ${attempt.correct ? 'bg-[#4f8562]' : 'bg-[#d65c3a]'}`} /><div><p className="text-sm font-medium">{i === 0 ? '首次作答' : `第 ${i} 次复刷`} · {attempt.answer || '未记录'} · {attempt.correct ? '正确' : '错误'}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(attempt.answeredAt)}{attempt.causeType ? ` · ${attempt.causeType}` : ''}</p></div></div>)}</div></div>
      <div className="rounded-[22px] bg-[#263b43] p-5 text-white"><div className="flex items-center gap-2 text-sm font-semibold text-[#f2c590]"><Sparkles className="size-4" /> 按需讲解</div><p className="mt-3 text-sm leading-6 text-white/70">点击后会把本题、原图和最多 5 道同类历史摘要发送给 DeepSeek；它不会修改正确答案。</p><Button className="mt-4 w-full bg-white text-[#263b43] hover:bg-white/90" disabled={busy} onClick={analyze}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{question.analysis ? '重新分析' : '分析这道题'}</Button></div></aside></div></>;
}

function AnalysisBlock({ analysis }: { analysis: AiAnalysis }) { return <div className="rounded-[22px] border border-[#e2d2bd] bg-[#fffaf1] p-5 sm:p-7"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Sparkles className="size-5 text-[#b16b39]" /> DeepSeek 分析</h2><Badge variant="outline">可信度 {analysis.confidence}</Badge></div><p className="mt-4 text-sm leading-7">{analysis.summary}</p><AnalysisItem title="正确思路" body={analysis.correctReasoning} /><AnalysisItem title="我的错误" body={analysis.myErrorDiagnosis} />{analysis.optionAnalysis && <AnalysisItem title="选项比较" body={analysis.optionAnalysis} />}<AnalysisItem title="避坑提醒" body={analysis.pitfall} />{analysis.historyInsight && <AnalysisItem title="历史对照" body={analysis.historyInsight} />}</div>; }

function Stats({ questions, settings, onOpen, onStart }: { questions: WrongQuestion[]; settings: AiSettings; onOpen: (id: string) => void; onStart: (mode: 'practice' | 'review', questions: WrongQuestion[]) => void }) {
  const [days, setDays] = useState<7 | 30 | 90 | 'all'>(30);
  const [source, setSource] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const [aiReport, setAiReport] = useState<AiStudyDiagnosis>();
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnosisNow] = useState(() => Date.now());
  const sources = unique(questions.map((question) => question.source));
  const periodStart = days === 'all' ? 0 : diagnosisNow - days * 86_400_000;
  const scopedQuestions = questions.filter((question) => (!source || question.source === source) && (!periodStart || question.attempts.some((attempt) => new Date(attempt.answeredAt).getTime() >= periodStart)));
  const diagnoses = useMemo(() => diagnoseWeaknesses(questions, { days, source: source || undefined }), [days, questions, source]);
  const attempts = scopedQuestions.flatMap((question) => question.attempts.filter((attempt) => !periodStart || new Date(attempt.answeredAt).getTime() >= periodStart));
  const reliableCount = diagnoses.filter((item) => item.evidenceLevel !== '待观察').length;

  async function generateAiReport() {
    if (!settings.apiKey) return setMessage('DeepSeek API 尚未配置。');
    if (!diagnoses.length) return setMessage('还没有足够的错题记录可以分析。');
    setAiBusy(true); setMessage('');
    const top = diagnoses.slice(0, 3);
    try {
      const result = await requestDeepSeek<AiStudyDiagnosis>({
        ...settings,
        action: 'diagnose',
        question: { module: top[0]?.module, topic: top[0]?.topic },
        diagnosis: {
          range: days === 'all' ? '全部时间' : `最近${days}天`,
          coverage: { questions: scopedQuestions.length, attempts: attempts.length, reliableWeaknesses: reliableCount },
          weaknesses: top.map((item) => ({
            scope: item.key, localScore: item.score, evidenceLevel: item.evidenceLevel, status: item.status,
            repeatAccuracy: item.repeatAccuracy, fuzzyRate: item.fuzzyRate, overdueCount: item.overdueCount,
            topCause: item.topCause, evidence: item.evidence,
          })),
        },
      });
      if (!result.summary || !Array.isArray(result.priorities)) throw new Error('DeepSeek 没有返回完整诊断');
      setAiReport(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : '诊断生成失败'); }
    finally { setAiBusy(false); }
  }

  return <>
    <PageHeader eyebrow="学习反馈" title="学习诊断" description="本地程序计算证据和薄弱分；DeepSeek 只在你点击时解释并制定计划。" />
    <div className="mt-6 flex flex-wrap gap-3 rounded-[18px] border bg-card p-4">
      <div className="flex flex-wrap gap-2">{([7, 30, 90, 'all'] as const).map((value) => <button key={value} onClick={() => setDays(value)} className={`rounded-full border px-3 py-1.5 text-xs ${days === value ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}>{value === 'all' ? '全部时间' : `近 ${value} 天`}</button>)}</div>
      <select aria-label="按来源筛选诊断" className={`${selectClass} ml-auto w-auto min-w-40`} value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option>{sources.map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-3">
      <Metric label="诊断覆盖" value={`${scopedQuestions.length}`} note="道错题" icon={Archive} tone="blue" />
      <Metric label="作答证据" value={`${attempts.length}`} note="次记录" icon={BookOpenCheck} tone="warm" />
      <Metric label="可判断薄弱点" value={`${reliableCount}`} note="个考点" icon={Target} tone="green" />
    </div>
    <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-4">
        <div><h2 className="font-heading text-xl font-semibold">优先处理</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">排序优先考虑证据等级，再考虑复刷、回忆和到期情况。首次录错本身不会直接判定为薄弱。</p></div>
        {diagnoses.length ? diagnoses.map((item) => {
          const itemQuestions = questions.filter((question) => item.questionIds.includes(question.id));
          const tone = item.status === '优先加强' ? 'border-[#efc9ba] bg-[#fff8f4]' : item.status === '正在改善' || item.status === '趋于掌握' ? 'border-[#cfe1d5] bg-[#f5faf6]' : 'bg-card';
          return <article key={item.key} className={`overflow-hidden rounded-[22px] border ${tone}`}>
            <div className="p-5 sm:p-6"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{item.module}</Badge><Badge variant="outline">{item.topic}</Badge><Badge variant="outline">证据 {item.evidenceLevel}</Badge></div><h3 className="mt-3 font-heading text-lg font-semibold">{item.status}</h3></div><div className="text-right"><strong className="font-heading text-3xl">{item.score}</strong><p className="text-[10px] text-muted-foreground">薄弱分 / 100</p></div></div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><DiagnosisMetric label="独立错题" value={`${item.questionCount} 道`} /><DiagnosisMetric label="复刷表现" value={item.repeatAccuracy === undefined ? '暂无' : `${item.repeatAccuracy}%`} /><DiagnosisMetric label="模糊/不会" value={item.fuzzyRate === undefined ? '暂无' : `${item.fuzzyRate}%`} /><DiagnosisMetric label="主要错因" value={item.topCause || '待补充'} /></div>
              <div className="mt-5 rounded-xl bg-background/75 px-4 py-3 text-sm leading-6"><strong>本地建议：</strong>{item.localAdvice[0]}</div>
              <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => onStart('review', itemQuestions)}><BookOpenCheck /> 白题复习</Button><Button size="sm" variant="outline" onClick={() => onStart('practice', itemQuestions)}><Check /> 写题加强</Button><Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === item.key ? undefined : item.key)}>{expanded === item.key ? '收起证据' : '查看证据'} <ChevronRight className={`transition-transform ${expanded === item.key ? 'rotate-90' : ''}`} /></Button></div>
            </div>
            {expanded === item.key && <div className="border-t bg-card px-5 py-4 sm:px-6"><p className="text-xs font-semibold text-muted-foreground">系统据此判断</p><div className="mt-3 space-y-2">{item.evidence.map((evidence) => <button key={evidence.id} onClick={() => onOpen(evidence.id)} className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm hover:bg-muted/50"><span className={`size-2 shrink-0 rounded-full ${evidence.results.at(-1) ? 'bg-[#4f8562]' : 'bg-[#d65c3a]'}`} /><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{evidence.source} · {evidence.results.map((value) => value ? '对' : '错').join(' → ')}</span><span className="mt-1 block truncate">{evidence.stem}</span></span><ChevronRight className="size-4 text-muted-foreground" /></button>)}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">{item.localAdvice[1]}</p></div>}
          </article>;
        }) : <Empty title="还没有可诊断的数据" body="录入并复刷错题后，这里会出现有证据的薄弱点。" />}
      </section>
      <aside className="space-y-4">
        <div className="rounded-[22px] bg-[#263b43] p-5 text-white"><div className="flex items-center gap-2 text-sm font-semibold text-[#f2c590]"><Sparkles className="size-4" /> DeepSeek + 花生十三</div><p className="mt-3 text-sm leading-6 text-white/70">AI只能解释上面的本地统计，并将证据转成可执行训练；不会修改薄弱分。</p><Button className="mt-4 w-full bg-white text-[#263b43] hover:bg-white/90" disabled={aiBusy || !diagnoses.length} onClick={() => void generateAiReport()}>{aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />} {aiReport ? '重新生成加强建议' : '分析我的薄弱点'}</Button></div>
        {message && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{message}</p>}
        {aiReport && <div className="rounded-[22px] border border-[#e2d2bd] bg-[#fffaf1] p-5"><h2 className="font-heading text-lg font-semibold">加强建议</h2><p className="mt-3 text-sm leading-7">{aiReport.summary}</p><div className="mt-5 space-y-5">{aiReport.priorities.map((priority, index) => <section key={`${priority.scope}-${index}`} className="border-t border-[#e8dccb] pt-4"><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-[#263b43] text-xs text-white">{index + 1}</span><h3 className="font-semibold">{priority.scope}</h3></div><p className="mt-2 text-sm leading-6 text-[#5e5145]">{priority.reason}</p>{priority.evidence?.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-foreground">证据：{priority.evidence.join('；')}</p>}<div className="mt-3 space-y-2">{priority.actions?.map((action, actionIndex) => <div key={`${action.title}-${actionIndex}`} className="rounded-xl bg-card p-3 text-sm"><strong>{action.title}</strong><p className="mt-1 leading-6 text-muted-foreground">{action.detail}</p><p className="mt-1 text-xs text-[#7a5835]">达标：{action.successCriteria}</p></div>)}</div></section>)}</div>{aiReport.caution && <p className="mt-4 rounded-xl bg-card px-3 py-2 text-xs leading-5 text-muted-foreground">{aiReport.caution}</p>}</div>}
      </aside>
    </div>
  </>;
}

function DiagnosisMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-background/70 p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 truncate font-medium">{value}</p></div>; }

function Settings({ settings, setSettings, githubSync, setGithubSync, syncStatus, onSync, onResolveConflicts, questions, onImported, availableUpdate, updateMessage, onCheckUpdate, onInstallUpdate }: {
  settings: AiSettings;
  setSettings: (settings: AiSettings) => void;
  githubSync: GithubSyncSettings;
  setGithubSync: (settings: GithubSyncSettings) => void;
  syncStatus: SyncStatus;
  onSync: (settings: GithubSyncSettings) => Promise<void>;
  onResolveConflicts: (choice: 'local' | 'cloud') => Promise<void>;
  questions: WrongQuestion[];
  onImported: () => void;
  availableUpdate?: AvailableUpdate;
  updateMessage: string;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: (update: AvailableUpdate) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [syncDraft, setSyncDraft] = useState(githubSync);
  const [message, setMessage] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(() => typeof window === 'undefined' || localStorage.getItem('cuojian_auto_update') !== 'false');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setSyncDraft(githubSync), [githubSync]);

  function saveAi() {
    const next = { apiKey: draft.apiKey.trim(), model: DEEPSEEK_MODEL, thinkingMode: draft.thinkingMode };
    localStorage.setItem('cuojian_deepseek', JSON.stringify(next));
    setSettings(next);
    setDraft(next);
    setMessage('DeepSeek 设置已保存在当前设备。');
  }
  function saveSync() {
    const next = { ...syncDraft, owner: syncDraft.owner.trim(), dataRepo: syncDraft.dataRepo.trim(), branch: syncDraft.branch.trim() || 'main', token: syncDraft.token.trim() };
    localStorage.setItem('cuojian_github_sync', JSON.stringify(next));
    setGithubSync(next);
    setSyncDraft(next);
    setMessage(next.autoSync ? 'GitHub 同步设置已保存，之后的修改会延迟 8 秒静默同步。' : 'GitHub 同步设置已保存。');
  }
  async function syncNow() {
    saveSync();
    await onSync({ ...syncDraft, token: syncDraft.token.trim(), branch: syncDraft.branch.trim() || 'main' });
  }
  function toggleAutoUpdate(value: boolean) {
    setAutoUpdate(value);
    localStorage.setItem('cuojian_auto_update', String(value));
  }
  function exportData() { const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), questions }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `错见备份-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); }
  async function importData(file?: File) { if (!file) return; try { const parsed = JSON.parse(await file.text()); if (!Array.isArray(parsed.questions)) throw new Error(); await replaceAllQuestions(parsed.questions); localStorage.setItem('cuojian_initialized', 'true'); setMessage(`已导入 ${parsed.questions.length} 道错题。`); onImported(); } catch { setMessage('备份文件格式不正确。'); } }

  return <>
    <PageHeader eyebrow="本机设置" title="DeepSeek、同步与更新" description="错题仍以本机为主；GitHub 只保存加密副本，软件更新不会覆盖学习数据。" />
    <div className="mt-7 grid gap-6 xl:grid-cols-2">
      <section className="space-y-5 rounded-[22px] border bg-card p-6">
        <div><h2 className="font-heading text-lg font-semibold">DeepSeek API</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">识别、分析、错题会话和今日小羊寄语才会调用。Key 不再写入公开源码。</p></div>
        <Field label="API Key" hint="仅保存在当前设备"><Input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="输入 DeepSeek API Key" /></Field>
        <Field label="固定模型"><Input value={DEEPSEEK_MODEL} readOnly className="h-10 bg-muted" /></Field>
        <Field label="思考模式" hint="小羊寄语固定使用快速模式"><select className={selectClass} value={draft.thinkingMode} onChange={(event) => setDraft({ ...draft, thinkingMode: event.target.value as AiSettings['thinkingMode'] })}><option value="disabled">关闭 · 快速整理</option><option value="low">低 · 简单识别</option><option value="high">高 · 日常分析</option><option value="max">最大 · 难题复盘</option></select></Field>
        <div className="flex items-start gap-3 rounded-xl border border-[#cfe1d5] bg-[#edf6ef] px-3 py-3 text-xs leading-5 text-[#315f42]"><Check className="mt-0.5 size-4 shrink-0" /><span><strong className="block">花生13单题方法库已接入</strong>分析和连续追问会按模块、考点检索，来源版本 6a43d77。</span></div>
        <Button onClick={saveAi}><Check /> 保存 DeepSeek 设置</Button>
      </section>

      <section className="space-y-5 rounded-[22px] border bg-card p-6">
        <div><h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Cloud className="size-5" /> GitHub 加密同步</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">本地与私有仓库双向合并。题目正文、图片和会话均先用 AES-GCM 加密，再上传。</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="GitHub 用户"><Input value={syncDraft.owner} onChange={(event) => setSyncDraft({ ...syncDraft, owner: event.target.value })} /></Field><Field label="私有数据仓库"><Input value={syncDraft.dataRepo} onChange={(event) => setSyncDraft({ ...syncDraft, dataRepo: event.target.value })} /></Field></div>
        <Field label="分支"><Input value={syncDraft.branch} onChange={(event) => setSyncDraft({ ...syncDraft, branch: event.target.value })} /></Field>
        <Field label="Fine-grained Token" hint="仅授予数据仓库 Contents 读写"><Input type="password" autoComplete="off" value={syncDraft.token} onChange={(event) => setSyncDraft({ ...syncDraft, token: event.target.value })} placeholder="github_pat_…" /></Field>
        <Field label="同步加密口令" hint="至少 8 位，忘记后云端数据无法解密"><Input type="password" autoComplete="new-password" value={syncDraft.passphrase} onChange={(event) => setSyncDraft({ ...syncDraft, passphrase: event.target.value })} placeholder="只保存在你的设备" /></Field>
        <label className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3 text-sm"><input className="mt-1" type="checkbox" checked={syncDraft.autoSync} onChange={(event) => setSyncDraft({ ...syncDraft, autoSync: event.target.checked })} /><span><strong className="block">应用内自动静默同步</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">启动、回到前台、联网恢复，以及每次保存后延迟 8 秒触发。</span></span></label>
        <div className={`rounded-xl border px-4 py-3 text-xs leading-5 ${syncStatus.state === 'error' || syncStatus.state === 'conflict' ? 'border-[#efd4c9] bg-[#fff4ef] text-[#984b35]' : 'border-[#d8e3df] bg-[#f3f7f5] text-[#315f42]'}`}><strong className="block">{syncStatus.state === 'syncing' ? '正在同步' : syncStatus.state === 'success' ? '已同步' : syncStatus.state === 'conflict' ? '发现冲突' : syncStatus.state === 'error' ? '同步失败' : '同步状态'}</strong><span>{syncStatus.message}</span>{syncStatus.lastSyncedAt && <span className="mt-1 block opacity-75">上次完成：{new Date(syncStatus.lastSyncedAt).toLocaleString('zh-CN')}</span>}</div>
        {syncStatus.state === 'conflict' && <div className="rounded-xl border border-[#efd4c9] bg-[#fffaf8] p-4 text-xs leading-5 text-[#744536]"><strong>只需决定题目正文采用哪一份</strong><p className="mt-1">作答轨迹和题内会话会始终合并保留，不会因选择正文版本而丢失。</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void onResolveConflicts('local')}>全部保留本机正文</Button><Button size="sm" variant="outline" onClick={() => void onResolveConflicts('cloud')}>全部采用云端正文</Button></div></div>}
        <div className="flex flex-wrap gap-2"><Button onClick={saveSync}><Check /> 保存同步设置</Button><Button variant="outline" disabled={syncStatus.state === 'syncing'} onClick={() => void syncNow()}>{syncStatus.state === 'syncing' ? <Loader2 className="animate-spin" /> : <RefreshCw />} 立即同步</Button></div>
      </section>

      <section className="rounded-[22px] border bg-card p-6">
        <h2 className="font-heading text-lg font-semibold">应用更新</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">当前版本 {APP_VERSION}。启动时每天最多检查一次；发现新版本后由你确认下载安装。</p>
        <label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={autoUpdate} onChange={(event) => toggleAutoUpdate(event.target.checked)} /> 自动检查更新</label>
        {updateMessage && <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">{updateMessage}</p>}
        {availableUpdate && <div className="mt-4 rounded-xl border border-[#e2d2bd] bg-[#fffaf1] p-4 text-sm"><strong>版本 {availableUpdate.version}</strong><p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{availableUpdate.notes}</p><p className="mt-2 text-xs text-muted-foreground">安装包约 {(availableUpdate.size / 1024 / 1024).toFixed(1)} MB</p></div>}
        <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" onClick={() => void onCheckUpdate()}><RefreshCw /> 检查更新</Button>{availableUpdate && <Button onClick={() => void onInstallUpdate(availableUpdate)}><Download /> 下载并安装</Button>}</div>
      </section>

      <section className="rounded-[22px] border bg-card p-6"><h2 className="font-heading text-lg font-semibold">本地备份</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">GitHub 同步不能代替独立备份。导出文件不包含 API Key、Token 和同步口令。</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><Button variant="outline" className="h-20 flex-col" onClick={exportData}><Download /> 导出 {questions.length} 道错题</Button><Button variant="outline" className="h-20 flex-col" onClick={() => importRef.current?.click()}><Upload /> 导入备份</Button></div><input aria-label="导入错题备份" ref={importRef} hidden type="file" accept="application/json" onChange={(event) => void importData(event.target.files?.[0])} /></section>
    </div>
    {message && <p className="mt-5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{message}</p>}
  </>;
}

function QuestionRow({ question, border, onClick, selected, onSelect }: { question: WrongQuestion; border: boolean; onClick: () => void; selected?: boolean; onSelect?: () => void }) { const last = question.attempts.at(-1); return <div className="relative flex"><span className={`w-2 shrink-0 ${question.module === '资料分析' ? 'bg-[#dc5f3d]' : question.module === '判断推理' ? 'bg-[#315a74]' : 'bg-[#a27b36]'}`} />{onSelect && <button aria-label={selected ? '取消选择这道题' : '选择这道题'} aria-pressed={selected} onClick={onSelect} className={`ml-4 mt-5 grid size-6 shrink-0 place-items-center rounded-md border transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-transparent hover:border-primary/50'}`}><Check className="size-4" /></button>}<button className="group grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-stretch text-left transition-colors hover:bg-muted/45" onClick={onClick}><span className={`min-w-0 px-5 py-5 sm:px-6 ${border ? 'border-b' : ''}`}><span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{question.source}</span><span>·</span><span>{question.status === 'mastered' ? '已掌握' : `复习等级 ${question.reviewLevel}`}</span></span><span className="mt-2 block line-clamp-2 text-[15px] font-medium sm:text-base">{question.stem}</span><span className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary">{question.module}</Badge><Badge variant="outline">{question.topic}</Badge>{last?.causeType && <Badge variant="outline" className="border-[#ebd3cc] bg-[#fff7f4] text-[#a64e37]">{last.causeType}</Badge>}</span></span><span className={`grid place-items-center px-4 text-muted-foreground ${border ? 'border-b' : ''}`}><ChevronRight className="size-5 transition-transform group-hover:translate-x-1" /></span></button></div>; }

function PageHeader({ eyebrow, title, description, compact = false }: { eyebrow: string; title: string; description: string; compact?: boolean }) { return <header className={compact ? 'mt-5' : ''}><p className="text-xs font-semibold tracking-[.16em] text-[#a85b3d]">{eyebrow}</p><h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></header>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 flex items-center justify-between text-sm font-medium"><span>{label}</span>{hint && <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted/55 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium leading-6">{value}</p></div>; }
function AnalysisItem({ title, body }: { title: string; body: string }) { return <div className="mt-5 border-t border-[#e8dccb] pt-4"><h3 className="text-sm font-semibold text-[#765334]">{title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#443b32]">{body}</p></div>; }
function AnswerAnalysisImage({ src }: { src: string }) { return <div className="mt-5 border-t border-[#e8dccb] pt-4"><h3 className="text-sm font-semibold text-[#765334]">解析图片</h3>{/* oxlint-disable-next-line next/no-img-element -- 本地 data URL 不适合图片优化器 */}<img src={src} alt="用户保存的正确答案解析" className="mt-3 max-h-[520px] w-full rounded-xl border bg-white object-contain" /></div>; }
function NavItem({ icon: Icon, label, count, active, onClick }: { icon: typeof Archive; label: string; count?: string; active?: boolean; onClick: () => void }) { return <button onClick={onClick} className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${active ? 'bg-[#e8eeeb] font-semibold text-primary' : 'text-muted-foreground hover:bg-muted'}`}><Icon className="size-[18px]" /><span>{label}</span>{count && <span className="ml-auto text-xs">{count}</span>}</button>; }
function MobileNav({ view, navigate }: { view: View; navigate: (view: View) => void }) { const items: Array<[View, typeof Archive, string]> = [['dashboard', CalendarDays, '复习'], ['library', Archive, '错题'], ['add', CirclePlus, '录入'], ['stats', Target, '诊断'], ['settings', Settings2, '设置']]; return <nav className="fixed inset-x-3 bottom-3 z-20 grid grid-cols-5 rounded-2xl border bg-card/95 p-2 shadow-xl backdrop-blur lg:hidden" aria-label="移动端导航">{items.map(([target, Icon, label]) => <button key={target} onClick={() => navigate(target)} className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] ${view === target ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}><Icon className="size-[18px]" />{label}</button>)}</nav>; }
function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Target; tone: 'warm' | 'blue' | 'green' }) { const tones = { warm: 'bg-[#fff0e9] text-[#b34f35]', blue: 'bg-[#e9f1f4] text-[#315a74]', green: 'bg-[#e8f0eb] text-[#3f6a51]' }; return <div className="flex items-center gap-4 rounded-[20px] border bg-card p-4 shadow-[0_8px_28px_rgba(28,42,47,.04)] sm:p-5"><div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tones[tone]}`}><Icon className="size-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><div className="mt-0.5 flex items-baseline gap-2"><strong className="font-heading text-2xl">{value}</strong><span className="text-xs text-muted-foreground">{note}</span></div></div></div>; }
function Empty({ title, body, action, onAction }: { title: string; body?: string; action?: string; onAction?: () => void }) { return <div className="mt-5 grid min-h-64 place-items-center rounded-[22px] border border-dashed bg-card/50 p-8 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted"><Archive className="size-5 text-muted-foreground" /></div><h3 className="mt-4 font-heading text-lg font-semibold">{title}</h3>{body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}{action && <Button className="mt-4" onClick={onAction}>{action}</Button>}</div></div>; }
function LoadingState() { return <div className="grid min-h-[70vh] place-items-center"><div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> 正在打开本地错题库</div></div>; }
function countBy(values: string[]) { const map = new Map<string, number>(); values.forEach((v) => map.set(v, (map.get(v) || 0) + 1)); return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count); }
function unique(values: string[]) { return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'zh-CN')); }
function shuffle<T>(values: T[]) { const result = [...values]; for (let i = result.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
function findTopTopic(questions: WrongQuestion[]) { return countBy(questions.filter((q) => q.status !== 'mastered').map((q) => `${q.module} · ${q.topic}`))[0]; }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value)); }
