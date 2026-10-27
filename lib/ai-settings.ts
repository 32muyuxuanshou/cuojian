import type { AiSettings } from './models';
import { DEEPSEEK_MODEL } from './deepseek-client-config';

const relay = import.meta.env;
export function defaultAiSettings(): AiSettings {
  const model = relay.VITE_RELAY_MODEL || DEEPSEEK_MODEL;
  const deepseek = model.startsWith('deepseek-');
  return relay.VITE_RELAY_API_KEY
    ? {
        provider: deepseek ? 'deepseek' : 'openai',
        baseUrl: relay.VITE_RELAY_BASE_URL || 'https://api.lingxiaihub.com',
        apiKey: relay.VITE_RELAY_API_KEY,
        model,
        transport:
          deepseek || relay.VITE_RELAY_TRANSPORT === 'chat'
            ? 'chat'
            : 'responses',
        thinkingMode: 'high',
      }
    : {
        provider: 'deepseek',
        baseUrl: 'https://api.lingxiaihub.com',
        apiKey: '',
        model: DEEPSEEK_MODEL,
        transport: 'chat',
        thinkingMode: 'high',
      };
}
export function loadAiSettings(storage: Pick<Storage, 'getItem'>): AiSettings {
  const current = storage.getItem('cuojian_ai');
  if (current)
    try {
      const saved = { ...defaultAiSettings(), ...JSON.parse(current) };
      if (
        (saved.baseUrl || '').includes('api.lingxiaihub.com') &&
        ['gpt-5.5', 'deepseek-v4-flash', 'deepseek-flash'].includes(saved.model)
      )
        return {
          ...saved,
          provider: 'deepseek',
          model: DEEPSEEK_MODEL,
          transport: 'chat',
        };
      return saved;
    } catch {
      /* Recover with local defaults. */
    }
  const defaults = defaultAiSettings();
  if (defaults.apiKey) return defaults;
  const legacy = storage.getItem('cuojian_deepseek');
  if (legacy)
    try {
      return {
        ...defaults,
        ...JSON.parse(legacy),
        provider: 'deepseek',
        model: DEEPSEEK_MODEL,
      };
    } catch {
      /* Ignore a broken legacy setting. */
    }
  return defaults;
}
export function aiLabel(settings: AiSettings) {
  return settings.provider === 'openai' ? 'GPT' : 'DeepSeek';
}
export function aiBaseUrl(settings: AiSettings) {
  const url = new URL(
    settings.baseUrl ||
      (settings.provider === 'openai'
        ? 'https://api.openai.com'
        : 'https://api.deepseek.com'),
  );
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('API地址须为不带账号和查询参数的 HTTPS 地址。');
  return url.href.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
}
