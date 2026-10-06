import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfPageAsset {
  pageNumber: number;
  text: string;
  overview: string;
  tiles: string[];
}

export interface PdfExtractedQuestion {
  draftId?: string;
  originalNumber: string;
  sectionKey: string;
  stem: string;
  options: Record<string,string>;
  detectedMyAnswer: string;
  detectedCorrectAnswer: string;
  answerEvidence: string;
  extractedNotes: string;
  explanation: string;
  source: string;
  module: string;
  topic: string;
  tags: string[];
  materialKey: string;
  materialText: string;
  materialRegions: PdfRegion[];
  questionRegions: PdfRegion[];
  pageNumbers: number[];
  confidence: 'high'|'medium'|'low';
  uncertainties: string[];
}

export interface PdfRegion {pageNumber:number;x:number;y:number;width:number;height:number}

export interface PdfExtractResult {
  questions: PdfExtractedQuestion[];
  unresolved: string[];
  tailContext: string;
}

function textValue(value:unknown) {
  if(value===undefined||value===null)return '';
  if(typeof value==='string')return value;
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  if(Array.isArray(value)&&value.every(item=>['string','number'].includes(typeof item)))return value.join('、');
  return '';
}

function optionText(value:unknown) {
  if(typeof value==='string')return value;
  if(!value||typeof value!=='object'||Array.isArray(value))return '';
  const item=value as Record<string,unknown>;
  return textValue(item.text ?? item.content ?? item.value ?? item.optionText ?? item.description);
}

function normalizeOptions(value:unknown):Record<string,string> {
  const result:Record<string,string>={};
  if(Array.isArray(value))value.forEach((item,index)=>{
    const fallback=String.fromCharCode(65+index);
    if(typeof item==='string'){
      const match=item.match(/^\s*([A-Z])\s*[.、:：)）]?\s*(.*)$/i);result[(match?.[1]||fallback).toUpperCase()]=(match?.[2]||item).trim();return;
    }
    if(!item||typeof item!=='object')return;
    const record=item as Record<string,unknown>;const direct=Object.entries(record).find(([key,val])=>/^[A-Z]$/i.test(key)&&typeof val==='string');
    if(direct){result[direct[0].toUpperCase()]=direct[1] as string;return;}
    const label=textValue(record.label ?? record.key ?? record.letter ?? record.id ?? record.option).trim().replace(/[.、:：)）]/g,'').toUpperCase();
    const text=optionText(record);if(text)result[/^[A-Z]$/.test(label)?label:fallback]=text;
  });
  else if(typeof value==='string')for(const line of value.split(/\r?\n|(?=\s*[A-Z]\s*[.、:：)）])/i)){
    const match=line.match(/^\s*([A-Z])\s*[.、:：)）]?\s*(.+)$/i);if(match)result[match[1].toUpperCase()]=match[2].trim();
  }
  else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
    const text=optionText(item);if(text)result[key.toUpperCase()]=text;
  }
  return result;
}

function normalizeRegions(value:unknown):PdfRegion[] {
  if(!Array.isArray(value))return [];
  return value.flatMap(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return [];
    const data=item as Record<string,unknown>;const region={pageNumber:Number(data.pageNumber),x:Number(data.x),y:Number(data.y),width:Number(data.width),height:Number(data.height)};
    if(!Number.isInteger(region.pageNumber)||region.pageNumber<1||![region.x,region.y,region.width,region.height].every(Number.isFinite)||region.width<=0||region.height<=0)return [];
    region.x=Math.max(0,Math.min(1000,region.x));region.y=Math.max(0,Math.min(1000,region.y));region.width=Math.min(1000-region.x,region.width);region.height=Math.min(1000-region.y,region.height);
    return region.width>=10&&region.height>=10?[region]:[];
  });
}

export function validatePdfExtract(value:unknown):PdfExtractResult {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('PDF识别结果不是对象。');
  const data=value as Record<string,unknown>;
  if(!Array.isArray(data.questions))throw new Error('PDF识别结果缺少题目列表。');
  const questions=data.questions.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`第 ${index+1} 道识别结果无效。`);
    const q=item as Record<string,unknown>;
    const stem=textValue(q.stem);if(!stem.trim())throw new Error(`第 ${index+1} 道缺少题干。`);q.stem=stem;
    const optionalStrings=['originalNumber','sectionKey','detectedMyAnswer','detectedCorrectAnswer','answerEvidence','extractedNotes','explanation','source','module','topic','materialKey','materialText'] as const;
    for(const field of optionalStrings)q[field]=textValue(q[field]);
    q.options=normalizeOptions(q.options);
    q.materialRegions=normalizeRegions(q.materialRegions);
    q.questionRegions=normalizeRegions(q.questionRegions);
    for(const field of ['detectedMyAnswer','detectedCorrectAnswer'] as const){const match=String(q[field]).trim().match(/^([A-E])(?:[.、:：)）\s]|$)/i);if(match)q[field]=match[1].toUpperCase();}
    for(const field of ['tags','uncertainties'] as const){const raw=q[field];q[field]=(Array.isArray(raw)?raw.map(textValue):typeof raw==='string'?raw.split(/[,，、;；]/):[]).map(value=>value.trim()).filter(Boolean);}
    const rawPages=Array.isArray(q.pageNumbers)?q.pageNumbers:[q.pageNumbers];q.pageNumbers=rawPages.map(page=>Number(page)).filter(page=>Number.isInteger(page)&&page>0);
    if(!(q.pageNumbers as number[]).length)throw new Error(`第 ${index+1} 道页码无效。`);
    if(!['high','medium','low'].includes(String(q.confidence)))q.confidence='low';
    return q as unknown as PdfExtractedQuestion;
  });
  const unresolved=Array.isArray(data.unresolved)?data.unresolved.filter(v=>typeof v==='string') as string[]:[];
  return {questions,unresolved,tailContext:typeof data.tailContext==='string'?data.tailContext:''};
}

export async function pdfFileData(file:File):Promise<string> {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('PDF文件编码失败。'));reader.onerror=()=>reject(new Error('读取PDF文件失败。'));reader.readAsDataURL(file);});
}

export async function splitPdf(original:Uint8Array,pages:number[]):Promise<{name:string;dataUrl:string}> {
  const {PDFDocument}=await import('pdf-lib');const source=await PDFDocument.load(original,{updateMetadata:false});const target=await PDFDocument.create();
  const copied=await target.copyPages(source,pages.map(page=>page-1));for(const page of copied)target.addPage(page);
  const bytes=await target.save();return {name:`pages-${pages[0]}-${pages.at(-1)}.pdf`,dataUrl:await pdfFileData(new File([new Uint8Array(bytes)],'part.pdf',{type:'application/pdf'}))};
}

export async function cropNormalizedRegion(dataUrl:string,region:PdfRegion):Promise<string> {
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=()=>reject(new Error('PDF资料图片裁剪失败。'));element.src=dataUrl;});
  const left=Math.floor(image.width*region.x/1000);const top=Math.floor(image.height*region.y/1000);
  const width=Math.max(1,Math.min(image.width-left,Math.ceil(image.width*region.width/1000)));const height=Math.max(1,Math.min(image.height-top,Math.ceil(image.height*region.height/1000)));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,left,top,width,height,0,0,width,height);
  const result=canvas.toDataURL('image/jpeg',.82);canvas.width=canvas.height=1;return result;
}

export async function openPdf(file:File):Promise<{document:PDFDocumentProxy;destroy:()=>Promise<void>}> {
  if(!file.name.toLowerCase().endsWith('.pdf') && file.type!=='application/pdf')throw new Error('请选择 PDF 文件。');
  if(file.size>40*1024*1024)throw new Error('试验版暂时支持 40MB 以内的 PDF。');
  const pdfjs=await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
  return {document:await task.promise,destroy:()=>task.destroy()};
}

function scaledCopy(source:HTMLCanvasElement,width:number,quality:number) {
  const target=document.createElement('canvas');const ratio=width/source.width;
  target.width=width;target.height=Math.max(1,Math.round(source.height*ratio));
  target.getContext('2d')!.drawImage(source,0,0,target.width,target.height);
  return target.toDataURL('image/jpeg',quality);
}

export async function renderPdfPages(pdf:PDFDocumentProxy,pageNumbers:number[]):Promise<PdfPageAsset[]> {
  const pdfjs=await import('pdfjs-dist');const result:PdfPageAsset[]=[];
  for(const pageNumber of pageNumbers){
    const page=await pdf.getPage(pageNumber);const natural=page.getViewport({scale:1});
    const scale=Math.min(3,1500/natural.width);const viewport=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvas,viewport,annotationMode:pdfjs.AnnotationMode.ENABLE,background:'#fff'}).promise;
    const textContent=await page.getTextContent();
    const text=textContent.items.map(item=>'str' in item?item.str:'').filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    const tiles:string[]=[];const segments=3;const overlap=Math.round(canvas.height*.035);const base=Math.ceil(canvas.height/segments);
    for(let i=0;i<segments;i++){
      const top=Math.max(0,i*base-overlap);const bottom=Math.min(canvas.height,(i+1)*base+overlap);
      const tile=document.createElement('canvas');tile.width=canvas.width;tile.height=bottom-top;
      const context=tile.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,tile.width,tile.height);context.drawImage(canvas,0,top,canvas.width,bottom-top,0,0,tile.width,tile.height);
      tiles.push(tile.toDataURL('image/jpeg',.82));tile.width=tile.height=1;
    }
    result.push({pageNumber,text,overview:scaledCopy(canvas,1100,.7),tiles});
    canvas.width=canvas.height=1;page.cleanup();
  }
  return result;
}

export function mergeExtractedQuestions(current:PdfExtractedQuestion[],incoming:PdfExtractedQuestion[]) {
  const merged=[...current];
  for(const question of incoming){
    const number=question.originalNumber.trim();
    const match=merged.findIndex(existing=>{
      const nearby=existing.pageNumbers.some(page=>question.pageNumbers.some(next=>Math.abs(page-next)<=1));
      return nearby&&existing.sectionKey===question.sectionKey&&((number&&existing.originalNumber.trim()===number)||(!number&&!existing.originalNumber&&existing.stem.slice(0,48)===question.stem.slice(0,48)));
    });
    if(match<0){merged.push({...question,draftId:question.draftId||crypto.randomUUID()});continue;}
    const old=merged[match];const better=(question.stem.length+Object.keys(question.options).length*20+question.explanation.length)>(old.stem.length+Object.keys(old.options).length*20+old.explanation.length);
    const answerConflict=!!old.detectedCorrectAnswer&&!!question.detectedCorrectAnswer&&old.detectedCorrectAnswer!==question.detectedCorrectAnswer;
    const mineConflict=!!old.detectedMyAnswer&&!!question.detectedMyAnswer&&old.detectedMyAnswer!==question.detectedMyAnswer;
    const materialRegions=[...new Map([...old.materialRegions,...question.materialRegions].map(region=>[`${region.pageNumber}-${region.x}-${region.y}-${region.width}-${region.height}`,region])).values()];
    const questionRegions=[...new Map([...old.questionRegions,...question.questionRegions].map(region=>[`${region.pageNumber}-${region.x}-${region.y}-${region.width}-${region.height}`,region])).values()];
    const preferred=better?question:old;const other=better?old:question;
    merged[match]={...other,...preferred,draftId:old.draftId||crypto.randomUUID(),detectedMyAnswer:preferred.detectedMyAnswer||other.detectedMyAnswer,detectedCorrectAnswer:preferred.detectedCorrectAnswer||other.detectedCorrectAnswer,answerEvidence:preferred.answerEvidence||other.answerEvidence,extractedNotes:preferred.extractedNotes||other.extractedNotes,materialKey:preferred.materialKey||other.materialKey,materialText:preferred.materialText.length>=other.materialText.length?preferred.materialText:other.materialText,materialRegions,questionRegions,pageNumbers:[...new Set([...old.pageNumbers,...question.pageNumbers])].sort((a,b)=>a-b),uncertainties:[...new Set([...old.uncertainties,...question.uncertainties])]};
    if(answerConflict||mineConflict){merged[match].confidence='low';merged[match].uncertainties.push('重叠页识别的答案不一致，请核对原文。');if(answerConflict)merged[match].detectedCorrectAnswer='';if(mineConflict)merged[match].detectedMyAnswer='';}
  }
  return merged.sort((a,b)=>(a.pageNumbers[0]||0)-(b.pageNumbers[0]||0));
}
