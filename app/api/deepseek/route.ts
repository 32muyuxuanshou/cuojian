import { buildUpstreamRequest,parseUpstreamResult, type DeepSeekRequest } from '@/lib/deepseek-client';
export async function POST(request: Request) {
  let key='';const safe=(message:string)=>key?message.split(key).join('[密钥已隐藏]'):message;
  try {
    const body = await request.json() as DeepSeekRequest;
    key=body.apiKey;
    if (!body.apiKey) return Response.json({ error: '请先填写 API Key。' }, { status: 400 });
    const target=buildUpstreamRequest(body);
    const upstream = await fetch(target.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify(target.body), signal: AbortSignal.timeout(300000),
    });
    const raw = await upstream.json() as { error?: { message?: string } };
    if (!upstream.ok) return Response.json({ error: safe(raw.error?.message || `AI请求失败（${upstream.status}）`) }, { status: upstream.status });
    return Response.json({ data:parseUpstreamResult(raw) });
  } catch(error) { return Response.json({ error: safe(error instanceof Error?error.message:'请求超时或返回格式无效，请重试。') }, { status: 502 }); }
}
