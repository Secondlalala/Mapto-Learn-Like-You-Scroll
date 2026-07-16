export type GenerationStatus = 'queued' | 'generating' | 'completed' | 'failed';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  sourceUri: string | null;
  originalText: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OutlineNode {
  id: string;
  bookId: string;
  parentId: string | null;
  title: string;
  level: number;
  body: string;
  childIds: string[];
  status: GenerationStatus;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
}

export interface ConceptCard {
  id: string;
  bookId: string;
  sectionId: string;
  cardType: 'section_overview' | 'concept';
  chapter: string;
  title: string;
  sourceText: string;
  oneSentence: string;
  simpleExplanation: string;
  fable: string;
  formula: string;
  formulaExplanation: string;
  prerequisites: string[];
  relatedConcepts: string[];
  questions: string[];
  isFavorite: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  cardId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string[];
  createdAt: string;
}

export interface GenerationState {
  sectionId: string;
  status: GenerationStatus;
  nextChunkIndex: number;
  errorMessage: string | null;
  errorCode: string | null;
  updatedAt: string;
}

export interface TtsCacheEntry {
  cacheKey: string;
  filePath: string;
  voice: string;
  speed: number;
  modelVersion: string;
  settings: Record<string, unknown>;
  createdAt: string;
  lastAccessedAt: string;
}
