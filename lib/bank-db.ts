import { openDb, DATA_CHANGED_EVENT } from './local-db';
import type { WrongQuestion } from './models';

export interface BankAsset {
  id: string;
  blob: Blob;
  name: string;
  kind: 'image' | 'pdf';
}
export interface BankImportRecord {
  id: string;
  name: string;
  importedAt: string;
  questionIds: string[];
  skipped: number;
  issues: string[];
  rolledBackAt?: string;
}
export interface BankDraft {
  id: string;
  name: string;
  questions: WrongQuestion[];
  assets: BankAsset[];
  issues: string[];
}

function notify() {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent(DATA_CHANGED_EVENT, { detail: { type: 'replace' } }),
    );
}

export async function getAsset(id: string): Promise<BankAsset | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readonly');
    const req = tx.objectStore('assets').get(id);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listBankImports(): Promise<BankImportRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bankImports', 'readonly');
    const req = tx.objectStore('bankImports').getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as BankImportRecord[]).sort((a, b) =>
          b.importedAt.localeCompare(a.importedAt),
        ),
      );
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => db.close();
  });
}

export async function commitBankImport(
  draft: BankDraft,
): Promise<BankImportRecord> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ['questions', 'assets', 'bankImports'],
      'readwrite',
    );
    const store = tx.objectStore('questions');
    let previous: BankImportRecord | undefined;
    const marker = tx.objectStore('bankImports').get(draft.id);
    marker.onsuccess = () => {
      previous = marker.result as BankImportRecord | undefined;
    };
    const req = store.getAll();
    let record: BankImportRecord;
    req.onsuccess = () => {
      if (previous) {
        record = previous;
        return;
      }
      const current = req.result as WrongQuestion[];
      const ids = new Set(current.map((q) => q.id));
      const fingerprints = new Set(
        current.map((q) => q.provenance?.fingerprint).filter(Boolean),
      );
      const added: string[] = [];
      let skipped = 0;
      for (const q of draft.questions) {
        if (
          ids.has(q.id) ||
          (q.provenance?.fingerprint &&
            fingerprints.has(q.provenance.fingerprint))
        ) {
          skipped++;
          continue;
        }
        store.add(q);
        ids.add(q.id);
        if (q.provenance) fingerprints.add(q.provenance.fingerprint);
        added.push(q.id);
      }
      // Exact content hashes make repeated imports idempotent without replacing existing assets or history.
      for (const asset of draft.assets) tx.objectStore('assets').put(asset);
      record = {
        id: draft.id,
        name: draft.name,
        importedAt: new Date().toISOString(),
        questionIds: added,
        skipped,
        issues: draft.issues,
      };
      tx.objectStore('bankImports').put(record);
    };
    tx.oncomplete = () => {
      db.close();
      notify();
      resolve(record);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('导入未完成，整批数据已回滚。请检查存储空间后重试。'));
    };
  });
}

export async function rollbackBankImport(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['questions', 'bankImports'], 'readwrite');
    const req = tx.objectStore('bankImports').get(id);
    req.onsuccess = () => {
      const record = req.result as BankImportRecord | undefined;
      if (!record || record.rolledBackAt) {
        tx.abort();
        return;
      }
      for (const questionId of record.questionIds) {
        const get = tx.objectStore('questions').get(questionId);
        get.onsuccess = () => {
          const q = get.result as WrongQuestion | undefined;
          // Do not destroy work completed since import. Keep edited/answered questions.
          if (
            q &&
            !q.attempts.length &&
            !q.conversation?.length &&
            q.updatedAt <= record.importedAt
          )
            tx.objectStore('questions').delete(questionId);
        };
      }
      tx.objectStore('bankImports').put({
        ...record,
        rolledBackAt: new Date().toISOString(),
      });
    };
    tx.oncomplete = () => {
      db.close();
      notify();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('无法撤销这次导入。'));
    };
  });
}

export function assetIds(q: WrongQuestion) {
  return [
    ...new Set([
      ...(q.questionImageAssets || []),
      ...(q.originalImageAssets || []),
      ...(q.material?.imageAssets || []),
      ...Object.values(q.optionImageAssets || {}).flat(),
      ...(q.provenance?.sourcePdfId ? [q.provenance.sourcePdfId] : []),
    ]),
  ];
}

export async function listAssets(): Promise<BankAsset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readonly');
    const req = tx.objectStore('assets').getAll();
    req.onsuccess = () => resolve(req.result);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function storeAssets(assets: BankAsset[]) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    for (const asset of assets) tx.objectStore('assets').put(asset);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
