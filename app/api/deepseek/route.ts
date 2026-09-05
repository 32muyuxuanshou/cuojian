import { buildNativeRequest, type DeepSeekRequest } from '@/lib/deepseek-client';
export async function POST(request: Request) {
  try {
    const body = await request.json() as DeepSeekRequest;
    if (!body.apiKey) return Response.json({ error: '请先填写 API Key。' }, { status: 400 });
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify(buildNativeRequest(body)), signal: AbortSignal.timeout(180000),
    });
    const raw = await upstream.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
    if (!upstream.ok) return Response.json({ error: raw.error?.message || 'DeepSeek 请求失败' }, { status: upstream.status });
    const content = raw.choices?.[0]?.message?.content || '';
    return Response.json({ data: JSON.parse(content.replace(/^```json\s*/i, '').replace(/\s*```$/, '')) });
  } catch { return Response.json({ error: '请求超时或返回格式无效，请重试。' }, { status: 502 }); }
}
