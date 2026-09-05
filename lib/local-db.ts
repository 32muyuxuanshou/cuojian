import type { WrongQuestion } from './models';
import { rememberDeletion } from './github-sync';

const DB_NAME = 'cuojian-local';
const STORE = 'questions';
export const DATA_CHANGED_EVENT = 'cuojian-data-changed';

function notifyDataChanged(type: 'save' | 'delete' | 'replace', id?: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { type, id } }));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery');
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('nextReviewAt', 'nextReviewAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listQuestions(includeDeleted = false): Promise<WrongQuestion[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as WrongQuestion[]).filter(q => includeDeleted || !q.deletedAt).map(q => ({ ...q, capturedAt: q.capturedAt || q.createdAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveQuestion(question: WrongQuestion): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(question);
    tx.oncomplete = () => { db.close(); notifyDataChanged('save', question.id); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveIfUnchanged(question: WrongQuestion, expectedUpdatedAt: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let saved = false;
    const request = store.get(question.id);
    request.onsuccess = () => { if (request.result && !request.result.deletedAt && request.result.updatedAt === expectedUpdatedAt) { store.put(question); saved = true; } };
    tx.oncomplete = () => { db.close(); if (saved) notifyDataChanged('save', question.id); resolve(saved); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteQuestion(id: string): Promise<void> {
  return trashQuestions([id]);
}

export async function trashQuestions(ids: string[], restore = false): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, deletedAt: restore ? undefined : new Date().toISOString(), updatedAt: new Date().toISOString(), organizeState: request.result.organizeState === 'running' ? 'pending' : request.result.organizeState }); };
    }
    tx.oncomplete = () => { db.close(); notifyDataChanged('replace'); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

// Only apply remote results to records unchanged since the request began.
export async function applySyncResults(before: WrongQuestion[], incoming: WrongQuestion[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const baseline = new Map(before.map(q => [q.id, JSON.stringify(q)]));
    const remote = new Map(incoming.map(q => [q.id, q]));
    const request = store.getAll();
    request.onsuccess = () => {
      const current = new Map((request.result as WrongQuestion[]).map(q => [q.id, q]));
      for (const [id, old] of baseline) {
        const local = current.get(id);
        if (!local || JSON.stringify({ ...local, capturedAt: local.capturedAt || local.createdAt }) !== old) continue;
        if (remote.has(id)) store.put(remote.get(id)!); else store.delete(id);
      }
      for (const q of incoming) if (!baseline.has(q.id) && !current.has(q.id)) store.put(q);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function permanentlyDeleteQuestion(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); rememberDeletion(id); notifyDataChanged('delete', id); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function replaceAllQuestions(questions: WrongQuestion[], notify = true): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'recovery'], 'readwrite');
    const store = tx.objectStore(STORE);
    const old = store.getAll();
    old.onsuccess = () => {
      tx.objectStore('recovery').put(old.result, 'before-import');
      store.clear();
      questions.forEach((question) => store.put(question));
    };
    tx.oncomplete = () => { db.close(); if (notify) notifyDataChanged('replace'); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function restoreBeforeImport(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve,reject)=> {
    const tx=db.transaction([STORE,'recovery'],'readwrite');
    const get=tx.objectStore('recovery').get('before-import');
    get.onsuccess=()=>{if(!get.result){tx.abort();return;}const store=tx.objectStore(STORE);store.clear();for(const q of get.result)store.put(q);};
    tx.oncomplete=()=>{db.close();notifyDataChanged('replace');resolve();};
    tx.onabort=()=>reject(new Error('没有可恢复的导入快照'));
    tx.onerror=()=>reject(tx.error);
  });
}

export function seedQuestions(): WrongQuestion[] {
  const now = new Date();
  const due = new Date(now.getTime() - 60_000).toISOString();
  const created = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  return [
    {
      id: 'demo-ziliao', createdAt: created, updatedAt: created, source: '2025 国考 · 地市级', sourceVerified: true,
      stem: '2023年某地区规模以上工业增加值为76858亿元，同比下降2.3%。问2022年约为多少亿元？',
      options: { A: '78660', B: '75100', C: '80120', D: '73540' }, correctAnswer: 'A', answerSource: 'official',
      module: '资料分析', topic: '基期量计算', tags: ['基期量', '增长率', '截位直除'], status: 'learning', reviewLevel: 1, nextReviewAt: due,
      attempts: [{ id: 'a1', answeredAt: created, answer: 'B', correct: false, mode: 'initial', causeType: '方法不熟', personalCause: '看到下降时把分母写成了1+2.3%。' }], isDemo: true,
    },
    {
      id: 'demo-panduan', createdAt: created, updatedAt: created, source: '2024 浙江省考', sourceVerified: true,
      stem: '研究人员认为，增加城市绿地可以显著降低夏季地表温度。以下哪项如果为真，最能削弱上述结论？',
      options: { A: '绿地能够改善居民心情', B: '被调查城市同期更换了高反射率屋顶', C: '部分城市绿地面积较小', D: '居民支持建设公园' }, correctAnswer: 'B', answerSource: 'official',
      module: '判断推理', topic: '削弱论证', tags: ['因果关系', '另有他因'], status: 'learning', reviewLevel: 2, nextReviewAt: due,
      attempts: [{ id: 'a2', answeredAt: created, answer: 'C', correct: false, mode: 'initial', causeType: '选项纠结', personalCause: '没有比较削弱力度，只看到“面积较小”就选了。' }], isDemo: true,
    },
    {
      id: 'demo-yanyu', createdAt: created, updatedAt: created, source: '粉笔模考 · 第18季', sourceVerified: true,
      stem: '传统文化的传承不能只是简单复制，而应在时代语境中不断____，从而获得新的生命力。',
      options: { A: '固化', B: '嬗变', C: '消解', D: '搁置' }, correctAnswer: 'B', answerSource: 'official',
      module: '言语理解', topic: '逻辑填空', tags: ['语境对应', '词义辨析'], status: 'learning', reviewLevel: 0, nextReviewAt: due,
      attempts: [{ id: 'a3', answeredAt: created, answer: 'A', correct: false, mode: 'initial', causeType: '审题失误', personalCause: '忽略了“新的生命力”对应变化和发展。' }], isDemo: true,
    },
  ];
}
