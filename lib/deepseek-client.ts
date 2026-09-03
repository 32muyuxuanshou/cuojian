import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { skillMethodPrompt, topicTaxonomy } from '@/lib/gongkao-skill';
import { getHuasheng13Knowledge, huasheng13Source } from '@/lib/huasheng13-knowledge';
import type { AiSettings, ReviewCelebrationInput } from '@/lib/models';

export type DeepSeekRequest = AiSettings & {
  action: 'classify' | 'analyze' | 'chat' | 'celebrate' | 'diagnose';
  imageDataUrl?: string;
  imageDataUrls?: Array<string | undefined>;
  question?: Record<string, unknown>;
  history?: unknown[];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  reviewResult?: ReviewCelebrationInput;
  diagnosis?: Record<string, unknown>;
};

export async function requestDeepSeek<T>(body: DeepSeekRequest): Promise<T> {
  if (!Capacitor.isNativePlatform()) {
    const response = await fetch('/api/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string; data?: T };
    if (!response.ok || !result.data) throw new Error(result.error || 'DeepSeek 请求失败');
    return result.data;
  }

  const request = buildNativeRequest(body);
  const response = await CapacitorHttp.post({
    url: 'https://api.deepseek.com/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` },
    data: request,
  });
  const raw = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(raw?.error?.message || `DeepSeek 请求失败（${response.status}）`);
  }
  const text = raw?.choices?.[0]?.message?.content || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned) as T; }
  catch { throw new Error('DeepSeek 返回内容不是有效 JSON，请重试。'); }
}

function buildNativeRequest(body: DeepSeekRequest) {
  const isAnalysis = body.action === 'analyze';
  const isChat = body.action === 'chat';
  const isCelebration = body.action === 'celebrate';
  const isDiagnosis = body.action === 'diagnose';
  const question = body.question as { module?: string; topic?: string } | undefined;
  const relevantKnowledge = getHuasheng13Knowledge(question?.module, question?.topic);
  const system = isDiagnosis
    ? `${skillMethodPrompt}\n以下是从花生十三 Skill 检索出的当前优先考点方法参考（来源版本 ${huasheng13Source.revision}）：\n${relevantKnowledge || '未命中专项资料，请只根据统计证据提出保守建议。'}\n你在生成个人错题库的学习诊断。薄弱分和证据等级由本地程序计算，你不得修改、夸大或自行补充。只能根据提供的证据描述可改进的具体行为，不得评价用户的智力、能力或性格。每个判断必须引用输入里的证据题来源或ID；证据不足时明确写“仍需更多复刷数据”。建议必须能直接执行，优先使用现有错题主动回忆，并给出完成标准。只输出JSON：summary、priorities、caution。priorities最多3项，每项字段为scope、reason、evidence（字符串数组）、actions（数组，每项含title、detail、successCriteria）。`
    : isCelebration
    ? '你为一个人的本地公考错题本写完成复盘后的鼓励语。称呼必须以“小羊，”开头。结合成绩事实，语气温柔、真诚、克制，不说教，不制造焦虑，不讽刺低正确率，不夸大进步。只写1到2句话、35到70个汉字。不要使用Markdown，不要给学习建议清单。只输出JSON，字段为 message。'
    : isChat
      ? `${skillMethodPrompt}\n以下是从公考花生十三 skill 按当前模块检索出的本地方法参考（来源版本 ${huasheng13Source.revision}）。它是方法参考，不是答案来源：\n${relevantKnowledge || '未命中具体模块，按通用复盘方法回答。'}\n你正在同一道错题的连续会话中。回答用户本次问题，优先解决追问，不要每轮重复完整解析。涉及历史错题时只能根据提供的证据回答，证据不足就明确说不知道。语气清楚、耐心。只输出JSON，字段为 reply、summary。summary用一句话更新本题会话摘要。`
      : isAnalysis
        ? `${skillMethodPrompt}\n以下是从公考花生十三 skill 按当前模块检索出的本地方法参考（来源版本 ${huasheng13Source.revision}）。它是解题方法提示，不是正确答案来源；若与题干事实冲突，以题干和用户确认答案为准：\n${relevantKnowledge || '未命中具体模块，仅按通用单题复盘流程分析。'}\n请只输出JSON，字段必须为 summary、correctReasoning、myErrorDiagnosis、optionAnalysis、pitfall、historyInsight、confidence。confidence只能是high、medium或low。`
        : `你负责把公考错题整理成结构化档案，不负责讲题。只能从以下分类体系选择模块和细分考点：${JSON.stringify(topicTaxonomy)}。来源可以识别但必须标记是否需要确认。不要推测个人错因，不要解答题目。只输出JSON，字段为 stem、options、detectedSource、sourceNeedsConfirmation、module、topic、tags、uncertainties。options为A/B/C/D等键值对象。`;
  const payloadText = isDiagnosis
    ? `请在不改变本地评分的前提下解释这份诊断，并制定加强方案：${JSON.stringify(body.diagnosis || {})}`
    : isCelebration
    ? `这是小羊今天完成的复盘结果：${JSON.stringify(body.reviewResult || {})}。请写一句只属于本次结果的温柔鼓励。`
    : isChat
      ? `当前错题：${JSON.stringify(body.question)}\n相关历史错题证据：${JSON.stringify(body.history || [])}`
      : isAnalysis
        ? `请分析这道错题：${JSON.stringify(body.question)}\n相关历史错题：${JSON.stringify(body.history || [])}`
        : '请逐字识别这道题并归类。看不清的内容写入uncertainties，不要擅自补全。';
  const imageDataUrls = (body.imageDataUrls?.length ? body.imageDataUrls : body.imageDataUrl ? [body.imageDataUrl] : []).filter((value): value is string => Boolean(value?.startsWith('data:image/')));
  const content: unknown = imageDataUrls.length
    ? [{ type: 'text', text: payloadText }, ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'original' } }))]
    : payloadText;
  const thinkingMode = body.thinkingMode || 'high';
  return {
    model: body.model,
    messages: isChat
      ? [{ role: 'system', content: system }, { role: 'user', content }, ...(body.messages || [])]
      : [{ role: 'system', content: system }, { role: 'user', content }],
    response_format: { type: 'json_object' },
    thinking: { type: thinkingMode === 'disabled' ? 'disabled' : 'enabled' },
    ...(thinkingMode === 'disabled' ? {} : { reasoning_effort: thinkingMode }),
  };
}
