import {emptyPaperLedger,checkPaperLedger,proposePaperTicket,placePaperTicket,settlePaperTickets,paperSummary} from './paperSimulation.mjs';
import {buildAutoTickets,matchOffer,evaluateOffer,normalizeOffer,normClub,AUTO_TICKET_PROFILES} from './autoOddsScanner.mjs';
import {evaluateCombo} from './ticketEvaluator.mjs';
// Compiled by CI as a standalone browser asset. No accounts, tokens, or backend needed.
import {predictIntelligence,BASELINE_CONFIG} from './intelligenceV2.mjs';
import {newLearningState,adaptivePrediction,recordForecast,settleResult,learningSummary,rebuildLearningState} from './continualLearning.mjs';
import {hockeyStandingsProfile,hockeyFixtureRates,calibrateRegulationHockey,hockeyTeamKey} from './hockeyV2.mjs';
globalThis.PredictorV2={predictIntelligence,BASELINE_CONFIG,
 newLearningState,adaptivePrediction,recordForecast,settleResult,learningSummary,rebuildLearningState};

globalThis.HockeyModel={hockeyStandingsProfile,hockeyFixtureRates,calibrateRegulationHockey,hockeyTeamKey};

globalThis.TicketCalculator={evaluateCombo};

globalThis.AutoOdds={buildAutoTickets,matchOffer,evaluateOffer,normalizeOffer,normClub,AUTO_TICKET_PROFILES};

globalThis.PaperBet={emptyPaperLedger,checkPaperLedger,proposePaperTicket,placePaperTicket,settlePaperTickets,paperSummary};
