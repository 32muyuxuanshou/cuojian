import {expect,it} from 'vitest';
import {buildUpstreamRequest,parseUpstreamResult} from '../lib/deepseek-client';
import {mergePdfIndexes,parsePdfIndex,pdfStatistics,validatePdfReport} from '../lib/pdf-ai';
import {mergeExtractedQuestions,validatePdfExtract} from '../lib/pdf-import';
import {pdfDraftSaved,pdfQuestionId,restorePdfJob,type PdfImportJob} from '../lib/pdf-import-db';
import {loadAiSettings} from '../lib/ai-settings';
import {questionContext} from '../lib/materials';
import type {WrongQuestion} from '../lib/models';

const settings={provider:'openai' as const,baseUrl:'https://example.com/v1/',apiKey:'private-test-key',model:'gpt-5.5',thinkingMode:'disabled' as const};
const q=(overrides:Record<string,unknown>={})=>validatePdfExtract({questions:[{originalNumber:'1',sectionKey:'section-p1',stem:'题目',options:{A:'甲',B:'乙'},pageNumbers:[1],detectedMyAnswer:'A',detectedCorrectAnswer:'B',answerEvidence:'答案栏B',confidence:'high',...overrides}]}).questions[0];

it('routes native PDF with strict schema to Responses without upstream storage',()=>{
 const request=buildUpstreamRequest({...settings,action:'pdfExtract',file:{name:'test.pdf',dataUrl:'data:application/pdf;base64,x'}});
 expect(request.url).toBe('https://example.com/v1/responses');
 const payload=request.body as {store:boolean;reasoning:{effort:string};text:{format:{type:string;strict:boolean}};input:Array<{content:Array<Record<string,unknown>>}>};
 expect(payload.store).toBe(false);expect(payload.reasoning).toEqual({effort:'none'});
 expect(payload.text.format.type).toBe('json_schema');expect(payload.text.format.strict).toBe(true);
 expect(payload.input[1].content[0]).toMatchObject({type:'input_file',filename:'test.pdf',detail:'high'});
 expect(JSON.stringify(payload)).not.toContain(settings.apiKey);
});
it('keeps legacy DeepSeek chat requests and supports explicit chat relay mode',()=>{
 const legacy=buildUpstreamRequest({...settings,provider:'deepseek',baseUrl:'https://api.deepseek.com',action:'test'});
 expect(legacy.url).toBe('https://api.deepseek.com/v1/chat/completions');expect((legacy.body as {thinking:{type:string}}).thinking.type).toBe('disabled');
 const chat=buildUpstreamRequest({...settings,transport:'chat',action:'test'});
 expect(chat.url).toBe('https://example.com/v1/chat/completions');expect('thinking' in chat.body).toBe(false);
});
it('rejects truncation and refusal, parses both wire protocols',()=>{
 expect(()=>parseUpstreamResult({status:'incomplete',output_text:'{"questions":[]}'})).toThrow('截断');
 expect(()=>parseUpstreamResult({choices:[{finish_reason:'length',message:{content:'{}'}}]})).toThrow('截断');
 expect(()=>parseUpstreamResult({output:[{content:[{type:'refusal',refusal:'no'}]}]})).toThrow('未完成');
 expect(parseUpstreamResult({output:[{content:[{type:'output_text',text:'{"connected":true}'}]}]})).toEqual({connected:true});
 expect(parseUpstreamResult({choices:[{message:{content:'```json\n{"connected":true}\n```'}}]})).toEqual({connected:true});
});
it('does not derive overall accuracy from a wrong-question collection or unknown answers',()=>{
 expect(pdfStatistics([q()], 'mistakes').accuracy).toBeNull();
 const stats=pdfStatistics([q(),q({originalNumber:'2',detectedMyAnswer:'B'}),q({originalNumber:'3',confidence:'low'})],'paper');
 expect(stats).toMatchObject({total:3,assessable:2,correct:1,incorrect:1,accuracy:null});
 expect(pdfStatistics([q(),q({detectedMyAnswer:'B'})],'paper').accuracy).toBe(50);
});
it('discards report claims with invented question evidence',()=>{
 const report=validatePdfReport({summary:'复盘',priorities:[{topic:'增长率',observation:'错基期',evidence:['PDF-1'],advice:'重算',successCriteria:'写出分母'},{topic:'捏造',observation:'',evidence:['PDF-999'],advice:'',successCriteria:''}]},['PDF-1']);
 expect(report.priorities).toHaveLength(1);
});
it('preserves IDs when overlap merges and an earlier question is inserted',()=>{
 const first=mergeExtractedQuestions([], [q({originalNumber:'2',pageNumbers:[2]})]);const id=first[0].draftId;
 const next=mergeExtractedQuestions(first,[q({originalNumber:'1',pageNumbers:[1]}),q({originalNumber:'2',pageNumbers:[2],stem:'更完整的题目'})]);
 expect(next[1].draftId).toBe(id);expect(next[0].draftId).not.toBe(id);
 const job=restorePdfJob({id:'job',drafts:first,savedIndexes:[],savedDraftIds:[id!]} as unknown as PdfImportJob);
 const resumed={...job,drafts:next};expect(pdfDraftSaved(resumed,1)).toBe(true);expect(pdfQuestionId(resumed,1)).toBe(pdfQuestionId(job,0));
});
it('does not silently pick one of conflicting answers',()=>{
 const merged=mergeExtractedQuestions([q()],[q({detectedCorrectAnswer:'C'})]);
 expect(merged[0].detectedCorrectAnswer).toBe('');expect(merged[0].confidence).toBe('low');
 const index=mergePdfIndexes([{questions:[],answers:[{originalNumber:'1',sectionKey:'section-p1',correctAnswer:'B',myAnswer:'A',pageNumber:3,evidence:'表B'}],issues:[]},{questions:[],answers:[{originalNumber:'1',sectionKey:'section-p1',correctAnswer:'C',myAnswer:'A',pageNumber:4,evidence:'表C'}],issues:[]}]);
 expect(index.answers[0].correctAnswer).toBe('');
});
it('migrates previous import IDs and keeps an explicitly saved provider',()=>{
 const job=restorePdfJob({id:'old',drafts:[q()],savedIndexes:[0]} as PdfImportJob);
 expect(pdfQuestionId(job,0)).toBe('old-q0');expect(pdfDraftSaved(job,0)).toBe(true);
 expect(loadAiSettings({getItem:key=>key==='cuojian_ai'?JSON.stringify({...settings,apiKey:'saved'}):null}).apiKey).toBe('saved');
 expect(()=>parsePdfIndex({questions:[]})).toThrow();
});
it('carries document notes and answer evidence into subsequent question conversations',()=>{
 const context=questionContext({extractedNotes:'我把基期选错了',answerEvidence:'第2页答案表',pdfSource:{name:'卷.pdf',pages:[1]},answerConfirmed:true} as WrongQuestion);
 expect(context.documentNotes).toBe('我把基期选错了');expect(context.answerEvidence).toBe('第2页答案表');expect(context.pdfSource?.pages).toEqual([1]);
});
