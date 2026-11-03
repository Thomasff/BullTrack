import type { GameType } from './types';
import type { zh } from '../../i18n/locales/zh';

type RuleLabel = keyof typeof zh.modes.ruleLabels;
type RuleText = keyof typeof zh.modes.rules;

// One labelled point of a game's rules, shown in the rules dialog. Both parts are keys
// under modes.ruleLabels / modes.rules, translated when the dialog draws them.
export interface RulePoint {
  label: RuleLabel;
  text: RuleText;
  values?: Record<string, number>;
}

const x01Rules = (start: number): RulePoint[] => [
  { label: 'goal', text: 'x01Goal', values: { start } },
  { label: 'finish', text: 'x01Finish' },
  { label: 'bust', text: 'x01Bust' },
];

const cricketMarks: RulePoint = { label: 'marks', text: 'cricketMarks' };

const cricketScoring: RulePoint = { label: 'scoring', text: 'cricketScoring' };

const cricketWin: RulePoint = { label: 'win', text: 'cricketWin' };

const halfRule: RulePoint = { label: 'half', text: 'halfRule' };

const checkoutFinish: RulePoint = { label: 'finish', text: 'checkoutFinish' };

export const MODE_RULES: Record<GameType, RulePoint[]> = {
  game301: x01Rules(301),
  game501: x01Rules(501),
  game701: x01Rules(701),
  cricket: [{ label: 'targets', text: 'cricketTargets' }, cricketMarks, cricketScoring, cricketWin],
  cricketNoScore: [
    { label: 'targets', text: 'cricketTargets' },
    cricketMarks,
    { label: 'win', text: 'noScoreWin' },
  ],
  tactics: [{ label: 'targets', text: 'tacticsTargets' }, cricketMarks, cricketScoring, cricketWin],
  randomCricket: [
    { label: 'targets', text: 'randomTargets' },
    cricketMarks,
    cricketScoring,
    cricketWin,
  ],
  cutThroat: [
    { label: 'targets', text: 'cricketTargets' },
    cricketMarks,
    { label: 'scoring', text: 'cutThroatScoring' },
    { label: 'win', text: 'cutThroatWin' },
  ],
  aroundTheClock: [
    { label: 'order', text: 'clockOrder' },
    { label: 'advance', text: 'clockAdvance' },
    { label: 'win', text: 'clockWin' },
  ],
  highScore: [
    { label: 'rounds', text: 'highScoreRounds' },
    { label: 'scoring', text: 'highScoreScoring' },
    { label: 'win', text: 'highScoreWin' },
  ],
  darts99: [
    { label: 'rounds', text: 'darts99Rounds' },
    { label: 'scoring', text: 'darts99Scoring' },
    { label: 'win', text: 'darts99Win' },
  ],
  shanghai: [
    { label: 'rounds', text: 'shanghaiRounds' },
    { label: 'shanghai', text: 'shanghaiShanghai' },
    { label: 'win', text: 'shanghaiWin' },
  ],
  halfIt: [
    { label: 'targets', text: 'halfItTargets' },
    { label: 'scoring', text: 'targetScoring' },
    halfRule,
    { label: 'win', text: 'halfItWin' },
  ],
  bermuda: [
    { label: 'targets', text: 'bermudaTargets' },
    { label: 'scoring', text: 'bermudaScoring' },
    halfRule,
    { label: 'win', text: 'bermudaWin' },
  ],
  killer: [
    { label: 'start', text: 'killerStart' },
    { label: 'killer', text: 'killerKiller' },
    { label: 'lives', text: 'killerLives' },
    { label: 'win', text: 'killerWin' },
  ],
  gotcha301: [
    { label: 'goal', text: 'gotchaGoal' },
    { label: 'reset', text: 'gotchaReset' },
    { label: 'bust', text: 'gotchaBust' },
  ],
  hammerCricket: [
    { label: 'targets', text: 'hammerTargets' },
    { label: 'scoring', text: 'hammerScoring' },
    { label: 'penalty', text: 'hammerPenalty' },
    { label: 'win', text: 'hammerWin' },
  ],
  catch40: [
    { label: 'targets', text: 'catch40Targets' },
    checkoutFinish,
    { label: 'scoring', text: 'catch40Scoring' },
    { label: 'win', text: 'catch40Win' },
  ],
  checkout4160: [
    { label: 'targets', text: 'checkout4160Targets' },
    checkoutFinish,
    { label: 'scoring', text: 'checkout4160Scoring' },
    { label: 'win', text: 'checkout4160Win' },
  ],
};
