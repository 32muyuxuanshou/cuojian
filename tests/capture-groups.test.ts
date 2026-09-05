import 'fake-indexeddb/auto';
import {beforeEach,expect,it} from 'vitest';
import {distributeCaptureGroup} from '../lib/capture-groups';
import {makeCapture} from '../lib/capture';
import {listQuestions,replaceAllQuestions,saveMaterialSet,saveQuestion} from '../lib/local-db';
import {organizeOne} from '../lib/organize';
import {validateBackup} from '../lib/backup';
import type {WrongQuestion} from '../lib/models';
const snap=(id:string,role:'material'|'question',qid?:string,group='set1'):WrongQuestion=>({...makeCapture('data:image/png;base64,'+id,id),captureGroupId:group,captureRole:role,captureQuestionId:qid});
const images=()=>[snap('m1','material'),snap('m2','material'),snap('q1','question','child1'),snap('q1b','question','child1'),snap('q2','question','child2')];
beforeEach(async()=>{await replaceAllQuestions([]);});
it('combines long materials and continuation without conflating separate children',()=>{
 const source=images();const result=distributeCaptureGroup(source,['m1','m2']);
 expect(result.materials).toHaveLength(2);expect(result.children).toHaveLength(2);
 expect(result.children[0].extraImages?.[0].id).toBe('q1b');expect(result.children[1].extraImages).toHaveLength(0);
 expect(result.consumed.map(q=>q.id)).toEqual(['m1','m2','q1b']);expect(source[2].extraImages).toBeUndefined();
});
it('never merges same question identifier across separate sets',()=>{expect(distributeCaptureGroup([snap('a','question','same','set1'),snap('b','question','same','set2')],[]).children).toHaveLength(2);});
it('legacy screenshots still become separate children',()=>{expect(distributeCaptureGroup([makeCapture('a'),makeCapture('b')],[]).children).toHaveLength(2);});
it('manual material role correction takes precedence',()=>{const r=distributeCaptureGroup(images(),['m1','m2','q1b']);expect(r.materials).toHaveLength(3);expect(r.children[0].extraImages).toHaveLength(0);});
it('rejects unreviewed raw set before any AI call',async()=>{await expect(organizeOne(images()[0],{apiKey:'',model:'',thinkingMode:'disabled'})).rejects.toThrow('先核对');});
it('backup preserves group and question continuation identity',()=>{const restored=validateBackup(JSON.parse(JSON.stringify({questions:images()})));expect(distributeCaptureGroup(restored,['m1','m2']).children).toHaveLength(2);});
it('saving grouped children consumes original screenshots atomically and retains recovery',async()=>{
 const source=images();await replaceAllQuestions(source);const r=distributeCaptureGroup(source,['m1','m2']);
 const material={id:'set1',title:'本套',text:'',images:r.materials.map(q=>q.imageDataUrl!),updatedAt:new Date().toISOString()};
 await saveMaterialSet(r.children.map(q=>({...q,material,captureGroupId:undefined})),r.consumed,source.filter(s=>r.children.some(q=>s.id===q.id)));
 const live=await listQuestions();expect(live).toHaveLength(2);expect(live[0].material?.images).toHaveLength(2);expect((await listQuestions(true)).filter(q=>q.deletedAt)).toHaveLength(3);
});
it('concurrent source modification aborts conversion without consuming material',async()=>{
 const source=images();await replaceAllQuestions(source);const r=distributeCaptureGroup(source,['m1','m2']);
 await saveQuestion({...source[3],updatedAt:'2099-01-01T00:00:00.000Z'});
 await expect(saveMaterialSet(r.children,r.consumed,source.filter(s=>r.children.some(q=>s.id===q.id)))).rejects.toThrow('已变化');expect(await listQuestions()).toHaveLength(5);
});
