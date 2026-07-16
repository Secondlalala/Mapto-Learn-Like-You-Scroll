import {createRepositories, type Repositories} from '../data/repositories';
import {openDatabase} from '../data/database';
import type {ChatMessage, ConceptCard, GenerationState} from '../domain/models';
import {DeepSeekSchemaError, parseGeneratedCards} from './cardSchema';
import {createDeepSeekClient, type DeepSeekClient} from './client';
import {buildChatMessages, buildGenerationMessages, type DeepSeekMessage} from './prompts';

type GenerationRepositories = Pick<Repositories,
  'getOutlineNode' | 'listOutlineNodes' | 'getGenerationState' | 'setGenerationState' |
  'saveCardsAndAdvance' | 'getCard' | 'insertMessage'>;

export interface GenerationResult {
  sectionId: string;
  cards: ConceptCard[];
}

export interface DeepSeekGeneratorDependencies {
  repositories: GenerationRepositories;
  client: DeepSeekClient;
  createId(): string;
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

const unicodeFormulaSubstitutes = /[×÷≤≥≠≈√∑∫∞]/u;
const latexSegment = /\$\$[^$]+\$\$|\$(?!\$)[^$\r\n]+\$/g;

function validateChatAnswer(content: string): string {
  const trimmed = content.trim();
  const withoutLatex = trimmed.replace(latexSegment, '');
  if (!trimmed || trimmed.includes('```') || unicodeFormulaSubstitutes.test(trimmed) || withoutLatex.includes('$')) {
    throw new DeepSeekChatValidationError();
  }
  return trimmed;
}

function repairMessages(messages: DeepSeekMessage[], invalidContent: string): DeepSeekMessage[] {
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

export function createDeepSeekGenerator(dependencies: DeepSeekGeneratorDependencies) {
  async function generateSectionImpl(sectionId: string): Promise<GenerationResult> {
    const section = await dependencies.repositories.getOutlineNode(sectionId);
    if (!section) {
      throw new DeepSeekGenerationError('The selected section no longer exists.');
    }
    const previousState = await dependencies.repositories.getGenerationState(sectionId);
    const previousCursor = previousState?.nextChunkIndex ?? section.chunkIndex;
    await dependencies.repositories.setGenerationState({
      sectionId,
      status: 'generating',
      nextChunkIndex: previousCursor,
      errorMessage: null,
      errorCode: null,
      updatedAt: dependencies.now(),
    });

    try {
      const messages = buildGenerationMessages(section);
      const initialContent = await dependencies.client.complete(messages);
      let generated;
      try {
        generated = parseGeneratedCards(initialContent);
      } catch (error) {
        if (!(error instanceof DeepSeekSchemaError)) {
          throw error;
        }
        const repairedContent = await dependencies.client.complete(repairMessages(messages, initialContent));
        generated = parseGeneratedCards(repairedContent);
      }

      const createdAt = dependencies.now();
      const cards: ConceptCard[] = generated.map(card => ({
        id: dependencies.createId(),
        bookId: section.bookId,
        sectionId: section.id,
        ...card,
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

  async function generateNextSectionImpl(bookId: string): Promise<GenerationResult | null> {
    const sections = await dependencies.repositories.listOutlineNodes(bookId);
    const next = sections
      .filter(section => section.status === 'queued')
      .sort((left, right) =>
        left.startOffset - right.startOffset ||
        left.endOffset - right.endOffset ||
        left.chunkIndex - right.chunkIndex,
      )[0];
    return next ? generateSectionImpl(next.id) : null;
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
    now: () => new Date().toISOString(),
  });
}

export async function generateSection(sectionId: string): Promise<GenerationResult> {
  return (await defaultGenerator()).generateSection(sectionId);
}

export async function generateNextSection(bookId: string): Promise<GenerationResult | null> {
  return (await defaultGenerator()).generateNextSection(bookId);
}

export async function askCard(cardId: string, question: string): Promise<ChatMessage> {
  return (await defaultGenerator()).askCard(cardId, question);
}
