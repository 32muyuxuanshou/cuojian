import {readFile} from 'node:fs/promises';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
const env=Object.fromEntries((await readFile('.env.local','utf8')).split(/\r?\n/).filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
let page=pdf.addPage([595,842]);let y=790;
for(const text of ['Shared material for questions 1-2:','Year 2023: 100 units. Year 2024: 120 units.','1. Growth rate from 2023 to 2024?','A. 10%  B. 20%  C. 30%  D. 40%','My answer: A','NOTE: I used the wrong base year.','2. Output in 2024?','A. 100  B. 110  C. 120  D. 130','My answer: C']){page.drawText(text,{x:40,y,size:14,font,color:rgb(0,0,0)});y-=32;}
page=pdf.addPage([595,842]);page.drawText('Answer key: 1 = B; 2 = C.',{x:40,y:790,size:18,font});
const data='data:application/pdf;base64,'+Buffer.from(await pdf.save()).toString('base64');
const schema={type:'object',properties:{questions:{type:'array',items:{type:'object',properties:{number:{type:'integer'},myAnswer:{type:'string'},correctAnswer:{type:'string'},note:{type:'string'},sharedMaterial:{type:'string'}},required:['number','myAnswer','correctAnswer','note','sharedMaterial'],additionalProperties:false}}},required:['questions'],additionalProperties:false};
const body={model:env.VITE_RELAY_MODEL,input:[{role:'user',content:[{type:'input_file',filename:'relay-capability-test.pdf',file_data:data,detail:'high'},{type:'input_text',text:'Read the PDF. Extract both questions, match the answer key on page 2, preserve my answers and note. Return JSON.'}]}],store:false,max_output_tokens:1000,reasoning:{effort:'low'},text:{format:{type:'json_schema',name:'pdf_probe',strict:true,schema}}};
try{
 const response=await fetch(env.VITE_RELAY_BASE_URL+'/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env.VITE_RELAY_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const raw=await response.json();if(!response.ok)throw new Error(JSON.stringify(raw.error||{status:response.status}));
 const text=raw.output_text||raw.output?.flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text).join('');
 const parsed=JSON.parse(text);const passed=parsed.questions?.length===2&&parsed.questions[0].correctAnswer.startsWith('B')&&parsed.questions[0].myAnswer.startsWith('A')&&parsed.questions[0].note&&parsed.questions[1].correctAnswer.startsWith('C');
 console.log(JSON.stringify({status:raw.status,model:raw.model,pdfSupported:!!passed,result:parsed}));if(!passed)process.exitCode=1;
}catch(error){console.error(String(error.message).replaceAll(env.VITE_RELAY_API_KEY,'[redacted]'));process.exitCode=1;}
