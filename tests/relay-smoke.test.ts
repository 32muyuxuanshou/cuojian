// Opt-in paid test: RUN_RELAY_SMOKE=1 npx vitest run tests/relay-smoke.test.ts
import {readFile} from 'node:fs/promises';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {expect,it} from 'vitest';
import {parsePdfIndex,pdfStatistics,validatePdfReport} from '../lib/pdf-ai';
import {validatePdfExtract} from '../lib/pdf-import';

it.skipIf(process.env.RUN_RELAY_SMOKE!=='1')('imports a native PDF and produces an evidence-based report through the app API',async()=>{
 const env=Object.fromEntries((await readFile('.env.local','utf8')).split(/\r?\n/).filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
 const page=pdf.addPage([595,842]);let y=790;
 for(const text of ['Shared material for questions 1-2:','Year 2023: 100 units. Year 2024: 120 units.','1. Growth rate from 2023 to 2024?','A. 10%  B. 20%  C. 30%  D. 40%','My answer: A','NOTE: I used the wrong base year.','2. Output in 2024?','A. 100  B. 110  C. 120  D. 130','My answer: C']){page.drawText(text,{x:40,y,size:14,font});y-=32;}
 const answerPage=pdf.addPage([595,842]);answerPage.drawText('Answer key: 1 = B; 2 = C.',{x:40,y:790,size:18,font});
 const pdfBytes=await pdf.save();const file={name:'integration-test.pdf',dataUrl:'data:application/pdf;base64,'+Buffer.from(pdfBytes).toString('base64')};
 const {createCanvas}=await import('@napi-rs/canvas');const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const loading=getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true});const document=await loading.promise;const overviews:string[]=[];
 for(let i=1;i<=document.numPages;i++){const page=await document.getPage(i);const viewport=page.getViewport({scale:1100/595});const canvas=createCanvas(1100,Math.ceil(viewport.height));await page.render({canvas:canvas as unknown as HTMLCanvasElement,canvasContext:canvas.getContext('2d') as unknown as CanvasRenderingContext2D,viewport}).promise;overviews.push(canvas.toDataURL('image/jpeg'));}await loading.destroy();
 const config={provider:'openai',baseUrl:env.VITE_RELAY_BASE_URL,apiKey:env.VITE_RELAY_API_KEY,model:env.VITE_RELAY_MODEL,transport:'responses',thinkingMode:'low'};
 async function call(payload:Record<string,unknown>){
  const response=await fetch('http://localhost:3000/api/deepseek',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,...payload}),signal:AbortSignal.timeout(180000)});
  const result=await response.json() as {data:unknown;error?:string};if(!response.ok)throw new Error((result.error||'API failed').split(config.apiKey).join('[redacted]'));return result.data;
 }
 const index=parsePdfIndex(await call({action:'pdfIndex',file,question:{originalPages:[1,2],annotationMeaning:''}}));expect(index.questions).toHaveLength(2);expect(index.answers.map(a=>a.correctAnswer.charAt(0)).sort()).toEqual(['B','C']);
 const extract=validatePdfExtract(await call({action:'pdfExtract',file,imageDataUrls:overviews,question:{originalPages:[1,2],pages:[{pageNumber:1,imageRoles:['overview']},{pageNumber:2,imageRoles:['overview']}],documentIndex:index,annotationMeaning:'',previousTailContext:''}}));
 console.log(JSON.stringify(extract.questions.map(q=>({number:q.originalNumber,materialKey:q.materialKey,confidence:q.confidence,materialRegions:q.materialRegions,questionRegions:q.questionRegions,uncertainties:q.uncertainties}))));
 expect(extract.questions).toHaveLength(2);const first=extract.questions.find(q=>q.originalNumber==='1')!;const second=extract.questions.find(q=>q.originalNumber==='2')!;
 expect(first.detectedMyAnswer).toBe('A');expect(first.detectedCorrectAnswer).toBe('B');expect(first.extractedNotes).toBeTruthy();expect(first.materialKey).toBeTruthy();expect(second.materialKey).toBe(first.materialKey);expect(first.materialRegions.length).toBeGreaterThan(0);expect(first.questionRegions.length).toBeGreaterThan(0);
 const stats=pdfStatistics(extract.questions,'paper');expect(stats).toMatchObject({total:2,correct:1,incorrect:1,accuracy:50,materialGroups:1});
 const evidenceIds=extract.questions.map((_,i)=>`PDF-${i+1}`);const raw=await call({action:'pdfReport',diagnosis:{statistics:stats,questions:extract.questions.map((q,i)=>({...q,evidenceId:evidenceIds[i]})),history:[]}});
 const report=validatePdfReport(raw,evidenceIds);expect(report.summary).toBeTruthy();expect(report.message.startsWith('小羊')).toBe(true);expect(report.priorities.length).toBeGreaterThan(0);
 console.log(JSON.stringify({nativePdf:true,questions:stats.total,materialGroups:stats.materialGroups,correct:stats.correct,incorrect:stats.incorrect,notes:first.extractedNotes,reportPriorities:report.priorities.map(p=>p.topic)}));
},240000);
