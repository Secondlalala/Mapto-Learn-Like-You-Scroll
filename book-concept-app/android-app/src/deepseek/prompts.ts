import type {ConceptCard, OutlineNode} from '../domain/models';

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildGenerationMessages(node: OutlineNode): DeepSeekMessage[] {
  const system = [
    'Create a coherent Chinese learning-card sequence from exactly one bounded source section.',
    'Return a strict JSON array only: no Markdown fences, no commentary, and no extra keys.',
    'Return 1-20 cards. Card zero must be cardType section_overview; every later card must be cardType concept.',
    'The overview must explain why the section is needed, what it enables, downstream concepts, and include a detailed fable.',
    'Do not create cards for isolated terms, references, URLs, author names, headers, or ordinary words.',
    'Every card must contain cardType, chapter, title, sourceText, oneSentence, simpleExplanation, fable, formula, formulaExplanation, prerequisites, relatedConcepts, and questions.',
    'Target 250-450 Chinese characters for each useful, detailed fable.',
    'Provide exactly three useful follow-up questions per card.',
    'Use only standard LaTeX delimiters $...$ or $$...$$ for formulas. Do not use Unicode formula substitutes or Markdown code fences.',
    'When formula is non-empty, formulaExplanation must explain every symbol using LaTeX notation.',
  ].join('\n');
  const context = JSON.stringify({
    chapter: node.title,
    sectionTitle: node.title,
    sourceText: node.body,
  });
  return [
    {role: 'system', content: system},
    {role: 'user', content: `Generate cards from this single bounded section:\n${context}`},
  ];
}

export function buildChatMessages(card: ConceptCard, question: string): DeepSeekMessage[] {
  const system = [
    'Answer the question using only the selected card context.',
    'Write readable paragraphs.',
    'Use standard LaTeX delimiters $...$ or $$...$$ for every formula and explain symbols where needed.',
    'Do not use Unicode formula substitutes or Markdown code fences.',
    'Do not use unrelated book text.',
  ].join('\n');
  const context = JSON.stringify({
    chapter: card.chapter,
    title: card.title,
    sourceText: card.sourceText,
    oneSentence: card.oneSentence,
    simpleExplanation: card.simpleExplanation,
    formula: card.formula,
    formulaExplanation: card.formulaExplanation,
  });
  return [
    {role: 'system', content: system},
    {role: 'user', content: `Selected card:\n${context}\n\nQuestion:\n${question}`},
  ];
}
