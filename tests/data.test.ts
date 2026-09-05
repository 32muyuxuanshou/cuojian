import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCapture,matchesDate } from '../lib/capture';
import { applySyncResults,listQuestions,saveQuestion,saveIfUnchanged,trashQuestions,replaceAllQuestions,restoreBeforeImport } from '../lib/local-db';
import { diagnoseWeaknesses } from '../lib/learning-diagnosis';
import { mergeBackup,validateBackup } from '../lib/backup';
import { validateOrganized,organizeOne } from '../lib/organize';
import { getHuasheng13Knowledge } from '../lib/huasheng13-knowledge';
import { requestDeepSeek } from '../lib/deepseek-client';
vi.mock('../lib/deepseek-client',()=>({requestDeepSeek:vi.fn()}));
const now='2026-09-05T10:00:00.000Z';
const q=()=>makeCapture('data:image/png;base64,test','test',now);
beforeEach(async()=>{await replaceAllQuestions([]);vi.clearAllMocks();});
describe('时间和旧版本兼容',()=>{
  it('收录日期不会随更新改变',()=>{const value={...q(),updatedAt:'2026-09-06T10:00:00Z'};expect(matchesDate(value,'today','','',new Date(now))).toBe(true);});
  it('旧题回退到createdAt',()=>{const value=q();delete value.capturedAt;expect(matchesDate(value,'today','','',new Date(now))).toBe(true);});
  it('自定义日期包含结束日，但不包含次日零点',()=>{const value=q();expect(matchesDate(value,'custom','2026-09-05','2026-09-05')).toBe(true);expect(matchesDate(value,'custom','2026-09-06','2026-09-07')).toBe(false);});
});
describe('本地数据安全',()=>{
  it('批量删除可以恢复，保留图片和时间',async()=>{await saveQuestion(q());await trashQuestions(['test']);expect(await listQuestions()).toHaveLength(0);expect(await listQuestions(true)).toHaveLength(1);await trashQuestions(['test'],true);expect((await listQuestions())[0].imageDataUrl).toBe(q().imageDataUrl);});
  it('同步期间的编辑不能被网络结果覆盖',async()=>{await saveQuestion(q());const before=await listQuestions(true);await saveQuestion({...q(),stem:'本地新编辑',updatedAt:'2026-09-06T10:00:00Z'});await applySyncResults(before,[{...q(),stem:'旧网络结果'}]);expect((await listQuestions())[0].stem).toBe('本地新编辑');});
  it('同步期间删除不复活',async()=>{await saveQuestion(q());const before=await listQuestions(true);await trashQuestions(['test']);await applySyncResults(before,[q()]);expect(await listQuestions()).toHaveLength(0);});
  it('未发生本地更改时采用远端',async()=>{await saveQuestion(q());const before=await listQuestions(true);await applySyncResults(before,[{...q(),stem:'远端修改'}]);expect((await listQuestions())[0].stem).toBe('远端修改');});
  it('过期AI结果不会覆盖新题或复活被删除题',async()=>{await saveQuestion(q());await trashQuestions(['test']);expect(await saveIfUnchanged({...q(),stem:'AI'},now)).toBe(false);});
  it('导入前快照可恢复',async()=>{await saveQuestion(q());await replaceAllQuestions([]);await restoreBeforeImport();expect(await listQuestions()).toHaveLength(1);});
});
describe('AI与统计边界',()=>{
  it('未知答案和示例不计入薄弱点',()=>{expect(diagnoseWeaknesses([q(),{...q(),isDemo:true,inbox:false,correctAnswer:'A'}])).toHaveLength(0);});
  it('同一道题多次做错不成为多题证据',()=>{const value={...q(),inbox:false,answerConfirmed:true,correctAnswer:'A',module:'判断推理',topic:'图形推理',attempts:Array.from({length:10},(_,i)=>({id:String(i),answeredAt:now,answer:'B',correct:false,mode:'practice' as const}))};expect(diagnoseWeaknesses([value])[0].evidenceLevel).toBe('待观察');});
  it('主观复习不混入客观正确率',()=>{const value={...q(),inbox:false,answerConfirmed:true,correctAnswer:'A',attempts:[{id:'1',answeredAt:now,answer:'未想起',correct:false,mode:'review' as const,selfRating:'unknown' as const}]};expect(diagnoseWeaknesses([value])[0].repeatAccuracy).toBeUndefined();});
  it('AI结果必须符合结构',()=>{expect(()=>validateOrganized({stem:'题干'})).toThrow();});
  it('包含真实版本文档检索来源',()=>{expect(getHuasheng13Knowledge('判断推理','图形推理')).toContain('references/panduan-');});
  it('未知答案不被AI自动确认',async()=>{await saveQuestion(q());vi.mocked(requestDeepSeek).mockResolvedValue({stem:'题目',options:{A:'甲'},module:'判断推理',topic:'图形推理',source:'',suggestedAnswer:'A',correctReasoning:'分析',pitfall:'注意',tags:[],issues:[]});await organizeOne(q(),{apiKey:'mock',model:'mock',thinkingMode:'disabled'});const result=(await listQuestions())[0];expect(result.correctAnswer).toBe('');expect(result.suggestedAnswer).toBe('A');expect(result.organizeState).toBe('review');expect(result.inbox).toBe(true);});
  it('AI失败逐题落盘可重试',async()=>{await saveQuestion(q());vi.mocked(requestDeepSeek).mockRejectedValue(new Error('模拟网络错误'));await organizeOne(q(),{apiKey:'mock',model:'mock',thinkingMode:'disabled'});expect((await listQuestions())[0].organizeState).toBe('error');});
});
describe('备份校验',()=>{
  it('拒绝损坏或重复数据',()=>{expect(()=>validateBackup({questions:[{id:'broken'}]})).toThrow();expect(()=>validateBackup({questions:[q(),q()]})).toThrow();});
  it('合并不删除已有题',()=>{expect(mergeBackup([q()],[{...q(),id:'another'}])).toHaveLength(2);});
});
