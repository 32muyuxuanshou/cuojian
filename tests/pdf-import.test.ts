import {expect,it} from 'vitest';
import {mergeExtractedQuestions,validatePdfExtract,type PdfExtractedQuestion} from '../lib/pdf-import';
import {buildNativeRequest} from '../lib/deepseek-client';

const question=(overrides:Partial<PdfExtractedQuestion>={}):PdfExtractedQuestion=>({originalNumber:'1',sectionKey:'section-p1',stem:'题干',options:{A:'甲',B:'乙'},detectedMyAnswer:'A',detectedCorrectAnswer:'B',answerEvidence:'第1页答案栏明确标注B',extractedNotes:'注意主体',explanation:'原文解析',source:'测试卷',module:'判断推理',topic:'定义判断',tags:['主体'],materialKey:'',materialText:'',materialRegions:[],questionRegions:[],pageNumbers:[1],confidence:'high',uncertainties:[],...overrides});

it('validates evidence-based PDF extraction',()=>{
 const value=validatePdfExtract({questions:[question()],unresolved:[],tailContext:''});
 expect(value.questions[0].detectedCorrectAnswer).toBe('B');expect(value.questions[0].extractedNotes).toBe('注意主体');
});
it('rejects malformed PDF extraction instead of partially saving it',()=>expect(()=>validatePdfExtract({questions:[{stem:'',pageNumbers:[1]}],unresolved:[],tailContext:''})).toThrow('缺少题干'));
it('fills optional fields omitted by the model instead of rejecting the PDF',()=>{
 const value=validatePdfExtract({questions:[{stem:'题干',pageNumbers:[2]}]});
 expect(value.questions[0].extractedNotes).toBe('');expect(value.questions[0].options).toEqual({});expect(value.questions[0].confidence).toBe('low');expect(value.unresolved).toEqual([]);
});
it('normalizes option arrays and loose model field types',()=>{
 const value=validatePdfExtract({questions:[{stem:'题干',originalNumber:1,options:[{label:'A',text:'甲'},{B:'乙'},'C. 丙'],tags:'资料分析，增长率',pageNumbers:'3',materialRegions:[{pageNumber:3,x:50,y:100,width:900,height:400}]}]});
 expect(value.questions[0].originalNumber).toBe('1');expect(value.questions[0].options).toEqual({A:'甲',B:'乙',C:'丙'});expect(value.questions[0].tags).toEqual(['资料分析','增长率']);expect(value.questions[0].pageNumbers).toEqual([3]);expect(value.questions[0].materialRegions).toHaveLength(1);
});
it('merges the overlapping-page copy but keeps repeated question numbers from a later paper',()=>{
 const merged=mergeExtractedQuestions([question({stem:'短题干',pageNumbers:[4]})],[question({stem:'更完整的题干',pageNumbers:[4,5]}),question({stem:'另一份卷子的第一题',pageNumbers:[20]})]);
 expect(merged).toHaveLength(2);expect(merged[0].stem).toBe('更完整的题干');expect(merged[0].pageNumbers).toEqual([4,5]);
});
it('keeps document answers separate from model reasoning in the prompt',()=>{
 const request=buildNativeRequest({apiKey:'hidden',model:'deepseek-flash',thinkingMode:'low',action:'pdfExtract',question:{pages:[{pageNumber:1,text:'你的答案A，正确答案B',imageRoles:['overview','tile-1']} ]},imageDataUrls:['data:image/jpeg;base64,x']});
 const text=JSON.stringify(request.messages);expect(text).toContain('不能仅凭颜色');expect(text).toContain('detectedMyAnswer');expect(text).toContain('overview');expect(text).toContain('materialRegions');
});
