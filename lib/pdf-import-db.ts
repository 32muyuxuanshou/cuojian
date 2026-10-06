import type {PdfExtractedQuestion} from './pdf-import';
import type {PdfIndex,PdfReport} from './pdf-ai';
export interface PdfImportJob {
  id:string;file:File;name:string;updatedAt:string;kind:'mistakes'|'paper';annotationMeaning:string;batchSize:number;
  nextPage:number;totalPages:number;index?:PdfIndex;indexParts?:PdfIndex[];nextIndexPage?:number;indexChunkSize?:number;drafts:PdfExtractedQuestion[];previews:Record<number,string>;unresolved:string[];tail:string;complete:boolean;report?:PdfReport;savedIndexes:number[];savedDraftIds?:string[];
}
export function restorePdfJob(job:PdfImportJob):PdfImportJob {
  const drafts=job.drafts.map((q,index)=>({...q,draftId:q.draftId||`legacy-${index}`}));
  return {...job,drafts,savedDraftIds:job.savedDraftIds||job.savedIndexes.map(index=>drafts[index]?.draftId).filter((id):id is string=>!!id)};
}
export function pdfQuestionId(job:PdfImportJob,index:number){const draft=job.drafts[index];return draft.draftId?.startsWith('legacy-')?`${job.id}-q${draft.draftId.slice(7)}`:`${job.id}-q-${draft.draftId}`;}
export function pdfMaterialId(job:PdfImportJob,key:string){return `${job.id}-material-${encodeURIComponent(key)}`;}
export function pdfDraftSaved(job:PdfImportJob,index:number){return !!job.drafts[index]?.draftId&&!!job.savedDraftIds?.includes(job.drafts[index].draftId!);}
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('cuojian-pdf-imports',1);request.onupgradeneeded=()=>request.result.createObjectStore('jobs',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function savePdfJob(job:PdfImportJob){const db=await open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('jobs','readwrite');tx.objectStore('jobs').put({...job,updatedAt:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(new Error('PDF进度保存失败，请检查本机存储空间。'));};});}
export async function latestPdfJob(){const db=await open();return new Promise<PdfImportJob|undefined>((resolve,reject)=>{const tx=db.transaction('jobs','readonly');const request=tx.objectStore('jobs').getAll();request.onsuccess=()=>resolve((request.result as PdfImportJob[]).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]);request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close();});}
