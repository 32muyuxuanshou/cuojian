import type {AiSettings} from './models';
import {DEEPSEEK_MODEL} from './deepseek-client-config';

const relay = import.meta.env;
export function defaultAiSettings():AiSettings {
  return relay.VITE_RELAY_API_KEY
    ? {provider:'openai',baseUrl:relay.VITE_RELAY_BASE_URL||'https://api.lingxiaihub.com',apiKey:relay.VITE_RELAY_API_KEY,model:relay.VITE_RELAY_MODEL||'gpt-5.5',transport:'responses',thinkingMode:'high'}
    : {provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'',model:DEEPSEEK_MODEL,transport:'chat',thinkingMode:'high'};
}
export function loadAiSettings(storage:Pick<Storage,'getItem'>):AiSettings {
  const current=storage.getItem('cuojian_ai');
  if(current)try{return {...defaultAiSettings(),...JSON.parse(current)};}catch{/* Recover with local defaults. */}
  const defaults=defaultAiSettings();
  if(defaults.apiKey)return defaults;
  const legacy=storage.getItem('cuojian_deepseek');
  if(legacy)try{return {...defaults,...JSON.parse(legacy),provider:'deepseek',model:DEEPSEEK_MODEL};}catch{/* Ignore a broken legacy setting. */}
  return defaults;
}
export function aiLabel(settings:AiSettings) {return settings.provider==='openai'?'GPT':'DeepSeek';}
export function aiBaseUrl(settings:AiSettings) {
  const url=new URL(settings.baseUrl|| (settings.provider==='openai'?'https://api.openai.com':'https://api.deepseek.com'));
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('API地址须为不带账号和查询参数的 HTTPS 地址。');
  return url.href.replace(/\/$/,'').replace(/\/v1$/,'')+'/v1';
}
