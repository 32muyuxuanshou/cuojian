export type AnswerSource = 'official' | 'document' | 'user' | 'ai';
export type QuestionStatus = 'learning' | 'mastered';

export interface Attempt {
  id: string;
  answeredAt: string;
  answer: string;
  correct: boolean;
  mode?: 'initial' | 'practice' | 'review';
  selfRating?: 'mastered' | 'fuzzy' | 'unknown';
  durationMs?: number;
  revealedAnswer?: boolean;
  causeType?: string;
  personalCause?: string;
}

export interface AiAnalysis {
  summary: string;
  correctReasoning: string;
  myErrorDiagnosis: string;
  optionAnalysis?: string;
  pitfall: string;
  historyInsight?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface QuestionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface WrongQuestion {
  id: string;
  material?: SharedMaterial;
  subquestionNumber?: string;
  captureGroupId?: string;
  captureRole?: 'material' | 'question';
  captureQuestionId?: string;
  capturedAt?: string;
  organizedAt?: string;
  deletedAt?: string;
  inbox?: boolean;
  organizeState?: 'pending' | 'queued' | 'running' | 'done' | 'review' | 'error';
  organizeError?: string;
  answerConfirmed?: boolean;
  suggestedAnswer?: string;
  answerEvidence?: string;
  extractedNotes?: string;
  pdfSource?: { name:string; pages:number[] };
  extraImages?: Array<{ id: string; role: 'question' | 'material' | 'analysis'; dataUrl: string }>;
  analysisStale?: boolean;
  conversationResetAt?: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  sourceVerified: boolean;
  stem: string;
  options: Record<string, string>;
  correctAnswer: string;
  answerSource: AnswerSource;
  module: string;
  topic: string;
  tags: string[];
  imageDataUrl?: string;
  status: QuestionStatus;
  reviewLevel: number;
  nextReviewAt: string;
  attempts: Attempt[];
  correctReasoning?: string;
  answerAnalysisImageDataUrl?: string;
  pitfall?: string;
  analysis?: AiAnalysis;
  conversation?: QuestionMessage[];
  conversationSummary?: string;
  classificationPending?: boolean;
  isDemo?: boolean;
}

export interface SharedMaterial {
  id: string;
  title: string;
  text: string;
  images: string[];
  updatedAt: string;
}

export interface AiSettings {
  provider?: 'deepseek' | 'openai';
  baseUrl?: string;
  transport?: 'responses' | 'chat';
  apiKey: string;
  model: string;
  thinkingMode: 'disabled' | 'low' | 'high' | 'max';
}

export interface GithubSyncSettings {
  owner: string;
  dataRepo: string;
  branch: string;
  token: string;
  passphrase: string;
  autoSync: boolean;
}

export interface SyncStatus {
  state: 'disabled' | 'idle' | 'syncing' | 'success' | 'error' | 'conflict';
  message: string;
  lastSyncedAt?: string;
  conflicts?: number;
}

export interface ReviewCelebrationInput {
  mode: 'practice' | 'review';
  total: number;
  correct: number;
  incorrect: number;
  remembered: number;
  fuzzy: number;
  mastery: number;
}

export interface AiStudyDiagnosis {
  summary: string;
  priorities: Array<{
    scope: string;
    reason: string;
    evidence: string[];
    actions: Array<{
      title: string;
      detail: string;
      successCriteria: string;
    }>;
  }>;
  caution?: string;
}

export const modules = ['全部', '资料分析', '数量关系', '言语理解', '判断推理', '常识判断', '申论'];

export const causeTypes = [
  '知识盲区',
  '方法不熟',
  '审题失误',
  '计算错误',
  '时间不足',
  '选项纠结',
  '主观发挥',
  '其他',
];
