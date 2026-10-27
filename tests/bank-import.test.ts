import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import {
  parseQuestionBank,
  bindSourcePdf,
  pageNumbers,
} from '../lib/bank-import';
import { commitBankImport, rollbackBankImport, getAsset } from '../lib/bank-db';
import {
  listQuestions,
  saveQuestion,
  replaceAllQuestions,
} from '../lib/local-db';
import { gradeAnswer, practiceOrder } from '../lib/question-engine';
import { diagnoseWeaknesses } from '../lib/learning-diagnosis';
import {
  createPortableBackup,
  readPortableBackup,
} from '../lib/portable-backup';
import { validateBackup } from '../lib/backup';

const row = (n: number, cells: Record<string, string>) =>
  `<row r="${n}">${Object.entries(cells)
    .map(
      ([key, value]) =>
        `<c r="${key}${n}" t="inlineStr"><is><t>${value}</t></is></c>`,
    )
    .join('')}</row>`;
function fixture() {
  const files = {
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="题库" r:id="s1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns:r="r"><sheetData>${row(1, { A: '板块', B: '题号', C: '材料编号', D: '材料（文字/表格）', E: '材料图', F: '问题', G: '选项A', H: '选项B', I: '选项C', J: '选项D', K: '答案（手写）', L: '手写批注', M: '页码' })}${row(2, { A: '套题训练1', B: '1', C: 'P1', D: '共同材料，数据为100、120。', F: '增长率？', G: '10%', H: '20%', I: '30%', J: '40%', K: 'B（蓝笔）', M: '第1页' })}${row(3, { A: '套题训练1', B: '2', C: 'P1', D: '同P1；本题选项为四个饼图，见图', F: '哪个图正确？', G: '图A', H: '图B', I: '图C', J: '图D', K: '未标注', L: '【待核】', M: '第2页' })}</sheetData><drawing r:id="drawing1"/></worksheet>`,
    'xl/worksheets/_rels/sheet1.xml.rels':
      '<Relationships><Relationship Id="drawing1" Target="../drawings/drawing1.xml"/></Relationships>',
    'xl/drawings/drawing1.xml':
      '<xdr:wsDr xmlns:xdr="xdr" xmlns:a="a" xmlns:r="r"><xdr:oneCellAnchor><xdr:from><xdr:row>1</xdr:row><xdr:col>4</xdr:col></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="i1"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:row>2</xdr:row><xdr:col>4</xdr:col></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="i2"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
    'xl/drawings/_rels/drawing1.xml.rels':
      '<Relationships><Relationship Id="i1" Target="../media/image1.png"/><Relationship Id="i2" Target="../media/image2.png"/><Relationship Id="external" Target="https://invalid.example" TargetMode="External"/></Relationships>',
    'xl/media/image1.png': 'material-image-bytes',
    'xl/media/image2.png': 'option-image-bytes',
  };
  return new File(
    [
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([key, value]) => [key, strToU8(value)]),
        ),
      ).buffer as ArrayBuffer,
    ],
    '资料分析题库.xlsx',
  );
}

describe('Excel 图片和资料题组导入', () => {
  it('解码Excel中的数字字符实体，并区分书页与PDF页码', async () => {
    const parts = unzipSync(new Uint8Array(await fixture().arrayBuffer()));
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml'])
        .replace('<t>问题</t>', '<t>&#38382;&#39064;</t>')
        .replace('共同材料', '&#x5171;&#x540c;材料'),
    );
    const draft = await parseQuestionBank(
      new File([zipSync(parts).buffer as ArrayBuffer], '实体编码.xlsx'),
    );
    expect(draft.questions[0].material?.text).toContain('共同材料');
    expect(pageNumbers('书P1（PDF P3）')).toEqual([1]);
    expect(pageNumbers('第14—15页')).toEqual([14, 15]);
  });
  it('从绘图关系读取图片，将本题图形选项与公共资料分开', async () => {
    const draft = await parseQuestionBank(fixture());
    const [a, b] = draft.questions;
    expect(draft.questions).toHaveLength(2);
    expect(draft.assets).toHaveLength(2);
    expect(a.material?.id).toBe(b.material?.id);
    expect(a.material?.imageAssets).toHaveLength(1);
    expect(b.material?.imageAssets).toEqual(a.material?.imageAssets);
    expect(b.questionImageAssets).toHaveLength(1);
    expect(b.questionImageAssets?.[0]).not.toBe(a.material?.imageAssets?.[0]);
    expect(a.correctAnswer).toBe('');
    expect(a.suggestedAnswer).toBe('B');
    expect(a.attempts).toEqual([]);
    expect(a.collection).toBe('bank');
    expect(b.reviewIssues?.length).toBeGreaterThan(0);
    expect(a.provenance?.pdfPages).toEqual([3]);
  });
  it('重复导入不覆盖已有修改，撤销保留已作答题', async () => {
    await replaceAllQuestions([]);
    const draft = await parseQuestionBank(fixture());
    const first = await commitBankImport(draft);
    expect(first.questionIds).toHaveLength(2);
    const changed = {
      ...draft.questions[0],
      stem: '用户修改',
      updatedAt: '2099-01-01T00:00:00Z',
    };
    await saveQuestion(changed);
    const again = await commitBankImport(await parseQuestionBank(fixture()));
    expect(again.skipped).toBe(2);
    expect((await listQuestions()).find((q) => q.id === changed.id)?.stem).toBe(
      '用户修改',
    );
    await rollbackBankImport(first.id);
    expect(await listQuestions()).toHaveLength(1);
    expect(await getAsset(draft.assets[0].id)).toBeTruthy();
  });
  it('完整备份可在另一设备恢复图片和原PDF，损坏的资产拒绝导入', async () => {
    const bound = await bindSourcePdf(
      await parseQuestionBank(fixture()),
      new File(['%PDF-test'], '原题.pdf', { type: 'application/pdf' }),
    );
    const blob = await createPortableBackup(bound.questions, bound.assets);
    const restored = await readPortableBackup({
      name: 'test.cuojian.zip',
      arrayBuffer: () => blob.arrayBuffer(),
    });
    expect(restored.assets).toHaveLength(3);
    expect(restored.questions[0].pdfSource?.pages).toEqual([3]);
    const bad = { ...bound, assets: bound.assets.slice(1) };
    await expect(
      createPortableBackup(bad.questions, bad.assets),
    ).rejects.toThrow('缺少');
  });
});

describe('作答形式、评分与学习证据', () => {
  it('同资料多题不能冒充多组独立练习证据', async () => {
    const base = (await parseQuestionBank(fixture())).questions[0];
    const now = new Date().toISOString();
    const group = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      id: `child-${i}`,
      correctAnswer: 'B',
      answerConfirmed: true,
      imageContainsHints: false,
      attempts: Array.from({ length: 3 }, (_, j) => ({
        id: `${i}-${j}`,
        answeredAt: now,
        answer: 'A',
        correct: false,
        graded: true,
        mode: 'practice' as const,
      })),
    }));
    expect(diagnoseWeaknesses(group)[0].evidenceLevel).toBe('待观察');
  });
  it('多选按集合比较，填空按文字比较，主观和未确认答案不判错', async () => {
    const q = (await parseQuestionBank(fixture())).questions[0];
    const confirmed = {
      ...q,
      correctAnswer: 'A,C',
      answerConfirmed: true,
      imageContainsHints: false,
      responseType: 'multiple' as const,
    };
    expect(gradeAnswer(confirmed, 'C,A')).toBe(true);
    expect(gradeAnswer(confirmed, 'A')).toBe(false);
    expect(
      gradeAnswer(
        { ...confirmed, responseType: 'blank', correctAnswer: '12.5' },
        ' 12.5 ',
      ),
    ).toBe(true);
    expect(
      gradeAnswer({ ...confirmed, responseType: 'subjective' }, 'A,C'),
    ).toBeUndefined();
    expect(
      gradeAnswer({ ...confirmed, answerConfirmed: false }, 'A'),
    ).toBeUndefined();
    expect(
      gradeAnswer({ ...confirmed, imageContainsHints: true }, 'B'),
    ).toBeUndefined();
  });
  it('确认答案但从未作答的题库不制造薄弱点，未判分记录不算错题证据', async () => {
    const q = {
      ...(await parseQuestionBank(fixture())).questions[0],
      correctAnswer: 'B',
      answerConfirmed: true,
    };
    expect(diagnoseWeaknesses([q])).toEqual([]);
    expect(
      diagnoseWeaknesses([
        {
          ...q,
          attempts: [
            {
              id: 'ungraded',
              answer: 'A',
              answeredAt: new Date().toISOString(),
              correct: false,
              graded: false,
              mode: 'practice',
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
  it('打乱题组时公共资料的小题保持相邻和内部顺序', async () => {
    const {
      questions: [a, b],
    } = await parseQuestionBank(fixture());
    const c = { ...a, id: 'independent', material: undefined };
    const ordered = practiceOrder([b, c, a], () => 0);
    expect(ordered.map((q) => q.id)).toEqual([c.id, a.id, b.id]);
    expect(validateBackup({ questions: ordered })).toHaveLength(3);
  });
});
