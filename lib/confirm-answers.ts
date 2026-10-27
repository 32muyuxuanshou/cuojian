import type { WrongQuestion } from './models';
import { DATA_CHANGED_EVENT, openDb } from './local-db';

export function canAdoptDocumentAnswer(q: WrongQuestion) {
  return (
    !q.deletedAt &&
    !q.inbox &&
    !q.correctAnswer &&
    q.answerSource === 'document' &&
    /^[A-Z]$/.test(q.suggestedAnswer || '') &&
    Object.hasOwn(q.options, q.suggestedAnswer || '') &&
    !q.contentNeedsReview &&
    !q.reviewIssues?.length
  );
}

// The user explicitly confirms a selected set; ambiguity and concurrent edits are skipped.
export async function confirmDocumentAnswers(expected: WrongQuestion[]) {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction('questions', 'readwrite');
    const store = tx.objectStore('questions');
    let count = 0;
    for (const old of expected) {
      const req = store.get(old.id);
      req.onsuccess = () => {
        const current = req.result as WrongQuestion | undefined;
        if (
          !current ||
          current.updatedAt !== old.updatedAt ||
          !canAdoptDocumentAnswer(current)
        )
          return;
        store.put({
          ...current,
          correctAnswer: current.suggestedAnswer,
          answerConfirmed: true,
          answerSource: 'user',
          analysisStale: !!current.analysis || !!current.conversation?.length,
          updatedAt: new Date().toISOString(),
        });
        count++;
      };
    }
    tx.oncomplete = () => {
      db.close();
      if (typeof window !== 'undefined')
        window.dispatchEvent(
          new CustomEvent(DATA_CHANGED_EVENT, { detail: { type: 'replace' } }),
        );
      resolve(count);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('批量确认未完成，数据已回滚。'));
    };
  });
}
