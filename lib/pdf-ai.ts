import type {PdfExtractedQuestion} from './pdf-import';

const string={type:'string'};const strings={type:'array',items:string};
function object(properties:Record<string,unknown>){return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};}
const region=object({pageNumber:{type:'integer'},x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}});
const regions={type:'array',items:region};
export const pdfExtractSchema=object({questions:{type:'array',items:object({originalNumber:string,sectionKey:string,stem:string,options:object({A:string,B:string,C:string,D:string,E:string}),detectedMyAnswer:string,detectedCorrectAnswer:string,answerEvidence:string,extractedNotes:string,explanation:string,source:string,module:string,topic:string,tags:strings,materialKey:string,materialText:string,materialRegions:regions,questionRegions:regions,pageNumbers:{type:'array',items:{type:'integer'}},confidence:{type:'string',enum:['high','medium','low']},uncertainties:strings})},unresolved:strings,tailContext:string});
export const pdfIndexSchema=object({questions:{type:'array',items:object({originalNumber:string,sectionKey:string,pageNumbers:{type:'array',items:{type:'integer'}},materialKey:string})},answers:{type:'array',items:object({originalNumber:string,sectionKey:string,correctAnswer:string,myAnswer:string,pageNumber:{type:'integer'},evidence:string})},issues:strings});
export interface PdfIndex {questions:Array<{originalNumber:string;sectionKey:string;pageNumbers:number[];materialKey:string}>;answers:Array<{originalNumber:string;sectionKey:string;correctAnswer:string;myAnswer:string;pageNumber:number;evidence:string}>;issues:string[]}
export const pdfReportSchema=object({summary:string,priorities:{type:'array',items:object({topic:string,observation:string,evidence:strings,advice:string,successCriteria:string})},caution:string,message:string});
export interface PdfReport {summary:string;priorities:Array<{topic:string;observation:string;evidence:string[];advice:string;successCriteria:string}>;caution:string;message:string}
export function parsePdfIndex(value:unknown):PdfIndex {
  const data=value as PdfIndex;
  if(!data||!Array.isArray(data.questions)||!Array.isArray(data.answers)||!Array.isArray(data.issues))throw new Error('PDF题号清单格式无效。');
  return {questions:data.questions.filter(q=>q&&typeof q.originalNumber==='string'&&Array.isArray(q.pageNumbers)&&q.pageNumbers.every(p=>Number.isInteger(p)&&p>0)),answers:data.answers.filter(a=>a&&typeof a.correctAnswer==='string'&&typeof a.evidence==='string'&&Number.isInteger(a.pageNumber)&&a.pageNumber>0),issues:data.issues.filter(i=>typeof i==='string')};
}
export function mergePdfIndexes(indexes:PdfIndex[]):PdfIndex {
  const questions=new Map<string,PdfIndex['questions'][number]>();const answers=new Map<string,PdfIndex['answers'][number]>();
  for(const index of indexes){
    for(const q of index.questions){const key=`${q.sectionKey||''}:${q.originalNumber}:${q.pageNumbers[0]}`;questions.set(key,q);}
    for(const a of index.answers){const key=`${a.sectionKey||''}:${a.originalNumber}`;const old=answers.get(key);if(!old)answers.set(key,a);else if(old.correctAnswer!==a.correctAnswer)answers.set(key,{...old,correctAnswer:'',evidence:`答案冲突：${old.evidence}；${a.evidence}`});}
  }
  return {questions:[...questions.values()],answers:[...answers.values()],issues:[...new Set(indexes.flatMap(i=>i.issues))]};
}
function normalizedAnswer(value:string){return value.trim().toUpperCase().replace(/^(?:我的答案|正确答案|答案)[:：\s]*/,'').replace(/[\s、,，.。]/g,'');}
export function pdfStatistics(questions:PdfExtractedQuestion[],kind:'mistakes'|'paper') {
  const assessable=questions.filter(q=>q.confidence==='high'&&q.answerEvidence.trim()&&normalizedAnswer(q.detectedCorrectAnswer)&&normalizedAnswer(q.detectedMyAnswer));
  const correct=assessable.filter(q=>normalizedAnswer(q.detectedMyAnswer)===normalizedAnswer(q.detectedCorrectAnswer));
  const topics=[...new Set(questions.map(q=>`${q.module||'未归类'} · ${q.topic||'待细分'}`))].map(topic=>{
    const matched=questions.filter(q=>`${q.module||'未归类'} · ${q.topic||'待细分'}`===topic);const judged=assessable.filter(q=>matched.includes(q));
    return {topic,total:matched.length,assessable:judged.length,incorrect:judged.filter(q=>!correct.includes(q)).length,materialGroups:new Set(matched.map(q=>q.materialKey).filter(Boolean)).size};
  });
  return {total:questions.length,materialGroups:new Set(questions.map(q=>q.materialKey).filter(Boolean)).size,answersDetected:questions.filter(q=>q.detectedCorrectAnswer).length,notesDetected:questions.filter(q=>q.extractedNotes).length,assessable:assessable.length,correct:correct.length,incorrect:assessable.length-correct.length,unassessable:questions.length-assessable.length,accuracy:kind==='paper'&&assessable.length===questions.length&&questions.length?Math.round(correct.length/questions.length*100):null,kind,topics};
}
export function validatePdfReport(value:unknown,evidenceIds:string[]):PdfReport {
  const data=value as PdfReport;
  if(!data||typeof data.summary!=='string'||!Array.isArray(data.priorities))throw new Error('复盘报告格式无效。');
  return {...data,priorities:data.priorities.filter(item=>item&&typeof item.topic==='string'&&typeof item.observation==='string'&&typeof item.advice==='string'&&typeof item.successCriteria==='string'&&Array.isArray(item.evidence)&&item.evidence.length>0&&item.evidence.every(id=>evidenceIds.includes(id))).slice(0,3),caution:typeof data.caution==='string'?data.caution:'',message:typeof data.message==='string'?data.message:''};
}
