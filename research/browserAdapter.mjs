// Compiled by CI as a standalone browser asset. No accounts, tokens, or backend needed.
import {predictIntelligence,BASELINE_CONFIG} from './intelligenceV2.mjs';
import {newLearningState,adaptivePrediction,recordForecast,settleResult,learningSummary,rebuildLearningState} from './continualLearning.mjs';
globalThis.PredictorV2={predictIntelligence,BASELINE_CONFIG,
 newLearningState,adaptivePrediction,recordForecast,settleResult,learningSummary,rebuildLearningState};
