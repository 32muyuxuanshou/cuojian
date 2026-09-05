import type {WrongQuestion} from './models';

// Keep source screenshot records until the reviewed set is saved atomically.
export function distributeCaptureGroup(seed:WrongQuestion[], materialIds:string[]) {
  const materials=seed.filter(q=>materialIds.includes(q.id));
  const others=seed.filter(q=>!materialIds.includes(q.id));
  const children:WrongQuestion[]=[];
  const consumed=[...materials];
  for(const q of others){
    const previous=q.captureQuestionId && children.find(c=>c.captureGroupId===q.captureGroupId && c.captureQuestionId===q.captureQuestionId);
    if(previous){
      previous.extraImages=[...(previous.extraImages||[]),...(q.imageDataUrl?[{id:q.id,role:'question' as const,dataUrl:q.imageDataUrl}]:[]),...(q.extraImages||[])];
      previous.stem=[previous.stem,q.stem].filter(Boolean).join('\n');consumed.push(q);
    }else children.push({...q,extraImages:[...(q.extraImages||[])]});
  }
  return {materials,children,consumed};
}
