// Aggregator module: re-exports schema, analysis, and generator APIs
export * from './schema.ts';
export { analyzeCard, analyzeGlobal } from './analysis.ts';
export { generateCard, type GenerateCardOptions } from './generator.ts';

