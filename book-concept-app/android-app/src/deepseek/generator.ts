import {createRepositories, type Repositories} from '../data/repositories';
import {openDatabase} from '../data/database';
import type {ChatMessage, ConceptCard, GenerationState, OutlineNode} from '../domain/models';
import {DeepSeekSchemaError, hasValidFormulaNotation, parseGeneratedCards} from './cardSchema';
import {createDeepSeekClient, type DeepSeekClient} from './client';
import {buildChatMessages, buildGenerationMessages, type DeepSeekMessage} from './prompts';

type GenerationRepositories = Pick<Repositories,
  'claimSectionForGeneration' | 'listOutlineNodes' | 'setGenerationState' |
  'saveCardsAndAdvance' | 'getCard' | 'insertMessage'>;

export interface GenerationResult {
  sectionId: string;
  cards: ConceptCard[];
}

export interface DeepSeekGeneratorDependencies {
  repositories: GenerationRepositories;
  client: DeepSeekClient;
  createId(): string;
  createClaimToken(): string;
  now(): string;
}

export class DeepSeekGenerationError extends Error {
  readonly code = 'deepseek_generation_error';
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekGenerationError';
  }
}

export class DeepSeekChatValidationError extends Error {
  readonly code = 'deepseek_chat_invalid';
  readonly retryable = true;

  constructor() {
    super('DeepSeek returned an invalid chat answer. Try again.');
    this.name = 'DeepSeekChatValidationError';
  }
}

export class DeepSeekSectionNotClaimableError extends Error {
  readonly code = 'deepseek_section_not_claimable';
  readonly retryable = false;

  constructor() {
    super('This section is already generating or completed.');
    this.name = 'DeepSeekSectionNotClaimableError';
  }
}

function validateChatAnswer(content: string): string {
  // 空回答或公式定界符不完整都会破坏聊天区排版，因此在写入数据库前统一拒绝。
  // 这里不尝试静默修改模型答案，避免自动修补改变原公式的科学含义。
  const trimmed = content.trim();
  if (!trimmed || !hasValidFormulaNotation(trimmed)) {
    throw new DeepSeekChatValidationError();
  }
  return trimmed;
}

function repairMessages(messages: DeepSeekMessage[], invalidContent: string): DeepSeekMessage[] {
  // 首次结构化输出解析失败时，把原回答原样交还模型并只允许修复一次。
  // 第二次仍不符合 schema 就向上抛错，防止无上限重试消耗 API 配额。
  return [
    ...messages,
    {role: 'assistant', content: invalidContent},
    {
      role: 'user',
      content: 'Repair the previous response once. Return only a strict JSON array matching every requested field and constraint. No Markdown or commentary.',
    },
  ];
}

function safeFailure(error: unknown): Pick<GenerationState, 'errorCode' | 'errorMessage'> {
  const code = typeof error === 'object' && error !== null && typeof (error as {code?: unknown}).code === 'string'
    ? (error as {code: string}).code
    : 'deepseek_generation_error';
  const knownMessage = error instanceof DeepSeekSchemaError ||
    (error instanceof Error && error.name.startsWith('DeepSeek'));
  return {
    errorCode: code,
    errorMessage: knownMessage ? (error as Error).message : 'Generation failed. Try again.',
  };
}

function resolveChapterTitle(section: OutlineNode, outline: OutlineNode[]): string {
  // 从当前小节沿 parentId 向上寻找最顶层章节，用于给卡片补充稳定的章节标题。
  // visited 集合同时防御异常大纲中的循环引用，避免生成流程进入死循环。
  const nodesById = new Map(outline.map(node => [node.id, node]));
  const visited = new Set([section.id]);
  let chapter = section;
  while (chapter.parentId) {
    const parent = nodesById.get(chapter.parentId);
    if (!parent || visited.has(parent.id)) {
      break;
    }
    visited.add(parent.id);
    chapter = parent;
  }
  return chapter.title;
}

export function createDeepSeekGenerator(dependencies: DeepSeekGeneratorDependencies) {
  async function generateSectionImpl(sectionId: string): Promise<GenerationResult> {
    // 调用 DeepSeek 前先抢占小节生成权。未抢到说明该小节已被后台任务处理或已经完成，
    // 此时直接返回可识别错误，不能再次请求模型，否则会生成重复卡片。
    const claim = await dependencies.repositories.claimSectionForGeneration(
      sectionId,
      `claim:${dependencies.createClaimToken()}`,
      dependencies.now(),
    );
    if (!claim) {
      throw new DeepSeekSectionNotClaimableError();
    }
    const {section, previousCursor} = claim;

    try {
      const outline = await dependencies.repositories.listOutlineNodes(section.bookId);
      const chapterTitle = resolveChapterTitle(section, outline);
      const messages = buildGenerationMessages(section, chapterTitle);
      const initialContent = await dependencies.client.complete(messages);
      let generated;
      try {
        generated = parseGeneratedCards(initialContent);
      } catch (error) {
        if (!(error instanceof DeepSeekSchemaError)) {
          throw error;
        }
        // 只对 schema 错误进行一次定向修复；网络错误和其他异常保持原样交给失败状态处理。
        const repairedContent = await dependencies.client.complete(repairMessages(messages, initialContent));
        generated = parseGeneratedCards(repairedContent);
      }

      const createdAt = dependencies.now();
      const cards: ConceptCard[] = generated.map(card => ({
        id: dependencies.createId(),
        bookId: section.bookId,
        sectionId: section.id,
        ...card,
        chapter: chapterTitle,
        sourceText: section.body,
        isFavorite: false,
        createdAt,
      }));
      await dependencies.repositories.saveCardsAndAdvance(
        sectionId,
        cards,
        previousCursor + 1,
        dependencies.now(),
      );
      return {sectionId, cards};
    } catch (error) {
      // 失败时保留 previousCursor，不向后推进生成位置。
      // 用户重试时仍从同一节开始，同时保存可展示的错误码，避免整本书的生成链条断裂。
      const failure = safeFailure(error);
      await dependencies.repositories.setGenerationState({
        sectionId,
        status: 'failed',
        nextChunkIndex: previousCursor,
        ...failure,
        updatedAt: dependencies.now(),
      });
      throw error;
    }
  }

  async function generateNextSectionImpl(bookId: string, afterSectionId?: string): Promise<GenerationResult | null> {
    // 大纲按原文区间排序，确保后台预生成始终沿阅读顺序前进。
    // 若已有小节处于 generating 状态则本次不再启动任务；失败小节优先于新的 queued 小节重试。
    const sections = (await dependencies.repositories.listOutlineNodes(bookId)).sort((left, right) =>
      left.startOffset - right.startOffset ||
      left.endOffset - right.endOffset ||
      left.chunkIndex - right.chunkIndex ||
      left.id.localeCompare(right.id),
    );
    if (sections.some(section => section.status === 'generating')) {
      return null;
    }

    const failed = sections.find(section => section.status === 'failed');
    const activeIndex = afterSectionId ? sections.findIndex(section => section.id === afterSectionId) : -1;
    const queued = activeIndex >= 0
      ? sections.slice(activeIndex + 1).find(section => section.status === 'queued')
      : sections.find(section => section.status === 'queued');
    const next = failed ?? queued;
    if (!next) {
      return null;
    }
    try {
      return await generateSectionImpl(next.id);
    } catch (error) {
      if (error instanceof DeepSeekSectionNotClaimableError) {
        return null;
      }
      throw error;
    }
  }

  async function askCardImpl(cardId: string, question: string): Promise<ChatMessage> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      throw new DeepSeekChatValidationError();
    }
    const card = await dependencies.repositories.getCard(cardId);
    if (!card) {
      throw new DeepSeekGenerationError('The selected card no longer exists.');
    }

    const userMessage: ChatMessage = {
      id: dependencies.createId(),
      cardId,
      role: 'user',
      content: normalizedQuestion,
      citations: [],
      createdAt: dependencies.now(),
    };
    await dependencies.repositories.insertMessage(userMessage);

    const answer = validateChatAnswer(await dependencies.client.complete(buildChatMessages(card, normalizedQuestion)));
    const assistantMessage: ChatMessage = {
      id: dependencies.createId(),
      cardId,
      role: 'assistant',
      content: answer,
      citations: [],
      createdAt: dependencies.now(),
    };
    await dependencies.repositories.insertMessage(assistantMessage);
    return assistantMessage;
  }

  return {
    generateSection: generateSectionImpl,
    generateNextSection: generateNextSectionImpl,
    askCard: askCardImpl,
  };
}

function defaultId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function defaultGenerator() {
  const repositories = createRepositories(await openDatabase());
  return createDeepSeekGenerator({
    repositories,
    client: createDeepSeekClient(),
    createId: defaultId,
    createClaimToken: defaultId,
    now: () => new Date().toISOString(),
  });
}

export async function generateSection(sectionId: string): Promise<GenerationResult> {
  return (await defaultGenerator()).generateSection(sectionId);
}

export async function generateNextSection(bookId: string, afterSectionId?: string): Promise<GenerationResult | null> {
  return (await defaultGenerator()).generateNextSection(bookId, afterSectionId);
}

export async function askCard(cardId: string, question: string): Promise<ChatMessage> {
  return (await defaultGenerator()).askCard(cardId, question);
}
