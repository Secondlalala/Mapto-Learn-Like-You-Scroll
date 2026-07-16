export interface GeneratedCard {
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
}

export class DeepSeekSchemaError extends Error {
  readonly code = 'deepseek_schema_invalid';
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekSchemaError';
  }
}

const fields: Array<keyof GeneratedCard> = [
  'cardType',
  'chapter',
  'title',
  'sourceText',
  'oneSentence',
  'simpleExplanation',
  'fable',
  'formula',
  'formulaExplanation',
  'prerequisites',
  'relatedConcepts',
  'questions',
];

const requiredTextFields: Array<keyof GeneratedCard> = [
  'chapter',
  'title',
  'sourceText',
  'oneSentence',
  'simpleExplanation',
  'fable',
];

const unicodeFormulaSubstitutes = /[×÷≤≥≠≈√∑∫∞]/u;
const latexSegment = /\$\$[^$]+\$\$|\$(?!\$)[^$\r\n]+\$/g;
const bareTexCommand = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|mathrm|mathbf|begin|end)\b/;
const bareRelation = /[\p{L}\p{N}_.)]+\s*(?:=|!=|<=|>=|<|>)\s*[\p{L}\p{N}_(.-]+/u;
const spacedArithmetic = /(?:\b[A-Za-z]|\d+(?:\.\d+)?)\s+[+*/^-]\s+(?:[A-Za-z]\b|\d)/;
const compactExponent = /(?:\b[A-Za-z]|\d+(?:\.\d+)?)\s*\^\s*(?:[A-Za-z]\b|\d)/;
const compactSum = /\b[A-Za-z]\s*\+\s*(?:[A-Za-z]\b|\d)/;
const compactLowercaseDivision = /\b[a-z]\s*\/\s*[a-z]\b/;
const implicitMultiplication = /\b\d+(?:\.\d+)?[a-z]\b/;
const superscriptExponent = /\b[A-Za-z][\u00b2\u00b3\u00b9\u2070-\u2079]/;
const unicodeMinusExpression = /\b[A-Za-z]\s*\u2212\s*[A-Za-z]\b/;

function fail(message: string): never {
  throw new DeepSeekSchemaError(message);
}

export function hasValidFormulaNotation(value: string, requireSegment = false): boolean {
  if (value.includes('```') || unicodeFormulaSubstitutes.test(value)) {
    return false;
  }
  const matches = value.match(latexSegment) ?? [];
  const withoutSegments = value.replace(latexSegment, '');
  return !withoutSegments.includes('$') &&
    !bareTexCommand.test(withoutSegments) &&
    !bareRelation.test(withoutSegments) &&
    !spacedArithmetic.test(withoutSegments) &&
    !compactExponent.test(withoutSegments) &&
    !compactSum.test(withoutSegments) &&
    !compactLowercaseDivision.test(withoutSegments) &&
    !implicitMultiplication.test(withoutSegments) &&
    !superscriptExponent.test(withoutSegments) &&
    !unicodeMinusExpression.test(withoutSegments) &&
    (!requireSegment || matches.length > 0);
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    fail(`${field} must be an array of non-blank strings.`);
  }
  return value as string[];
}

function validateCard(value: unknown, index: number): GeneratedCard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`Card ${index} must be an object.`);
  }
  const card = value as Record<string, unknown>;
  const unknownFields = Object.keys(card).filter(key => !fields.includes(key as keyof GeneratedCard));
  if (unknownFields.length > 0 || fields.some(field => !(field in card))) {
    fail(`Card ${index} must contain exactly the supported fields.`);
  }
  if (card.cardType !== 'section_overview' && card.cardType !== 'concept') {
    fail(`Card ${index} has an unsupported cardType.`);
  }
  for (const field of requiredTextFields) {
    if (typeof card[field] !== 'string' || !(card[field] as string).trim()) {
      fail(`Card ${index} field ${field} must be non-blank text.`);
    }
  }
  for (const field of ['formula', 'formulaExplanation'] as const) {
    if (typeof card[field] !== 'string') {
      fail(`Card ${index} field ${field} must be text.`);
    }
  }

  const formula = card.formula as string;
  const formulaExplanation = card.formulaExplanation as string;
  if (formula.trim()) {
    if (!formulaExplanation.trim() || !hasValidFormulaNotation(formula, true) || !hasValidFormulaNotation(formulaExplanation, true)) {
      fail(`Card ${index} formula fields must use balanced standard LaTeX delimiters.`);
    }
  } else if (formulaExplanation.trim()) {
    fail(`Card ${index} cannot explain an empty formula.`);
  }

  for (const field of ['title', 'oneSentence', 'simpleExplanation', 'fable'] as const) {
    if (!hasValidFormulaNotation(card[field] as string)) {
      fail(`Card ${index} field ${field} contains invalid formula notation.`);
    }
  }

  const prerequisites = requireStringArray(card.prerequisites, 'prerequisites');
  const relatedConcepts = requireStringArray(card.relatedConcepts, 'relatedConcepts');
  const questions = requireStringArray(card.questions, 'questions');
  if (questions.length !== 3) {
    fail(`Card ${index} must have exactly three questions.`);
  }
  for (const textItem of [...prerequisites, ...relatedConcepts, ...questions]) {
    if (!hasValidFormulaNotation(textItem)) {
      fail(`Card ${index} contains invalid formula notation in a text list.`);
    }
  }

  return {
    cardType: card.cardType,
    chapter: card.chapter as string,
    title: card.title as string,
    sourceText: card.sourceText as string,
    oneSentence: card.oneSentence as string,
    simpleExplanation: card.simpleExplanation as string,
    fable: card.fable as string,
    formula,
    formulaExplanation,
    prerequisites,
    relatedConcepts,
    questions,
  };
}

export function parseGeneratedCards(content: string): GeneratedCard[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    fail('DeepSeek response must be strict JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) {
    fail('DeepSeek response must contain between 1 and 20 cards.');
  }

  const cards = parsed.map(validateCard);
  if (cards[0].cardType !== 'section_overview' || cards.slice(1).some(card => card.cardType !== 'concept')) {
    fail('The first card must be the only section_overview card.');
  }
  return cards;
}
