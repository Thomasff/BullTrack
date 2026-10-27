import type { GameType } from './types';

// One labelled point of a game's rules, shown in the rules dialog.
export interface RulePoint {
  label: string;
  text: string;
}

const x01Rules = (start: number): RulePoint[] => [
  { label: '目标', text: `从 ${start} 分开始，每轮三镖的得分从剩余分里扣掉，先扣到正好 0 分者胜。` },
  { label: '收镖', text: '最后一镖必须打在双倍区或内牛（内牛算 50 分）。' },
  {
    label: '爆镖',
    text: '扣成负数、只剩 1 分，或扣到 0 但最后一镖不是双倍或内牛，这一轮不算，分数回到本轮开始时。',
  },
];

const cricketMarks: RulePoint = {
  label: '记次',
  text: '单倍记 1 次，双倍 2 次，三倍 3 次；外牛 1 次，内牛 2 次。同一目标记满 3 次即「关闭」。',
};

const cricketScoring: RulePoint = {
  label: '得分',
  text: '自己已关闭、但还有对手没关闭的目标，再打中就按这一镖的分数给自己加分。',
};

const cricketWin: RulePoint = {
  label: '胜负',
  text: '全部目标都关闭，且分数不低于任何对手，立即获胜。',
};

const halfRule: RulePoint = {
  label: '减半',
  text: '一轮三镖都没打中目标，总分减半（向下取整）。',
};

const checkoutFinish: RulePoint = {
  label: '收镖',
  text: '和 301 一样扣分，最后一镖必须打在双倍区或内牛；爆镖则这一轮不算，回到本轮开始时的分数。',
};

export const MODE_RULES: Record<GameType, RulePoint[]> = {
  game301: x01Rules(301),
  game501: x01Rules(501),
  game701: x01Rules(701),
  cricket: [{ label: '目标', text: '15 到 20 和靶心。' }, cricketMarks, cricketScoring, cricketWin],
  cricketNoScore: [
    { label: '目标', text: '15 到 20 和靶心。' },
    cricketMarks,
    { label: '胜负', text: '不计分，先把全部目标关闭者胜。' },
  ],
  tactics: [{ label: '目标', text: '10 到 20 和靶心。' }, cricketMarks, cricketScoring, cricketWin],
  randomCricket: [
    {
      label: '目标',
      text: '开局从 1 到 20 中随机抽 6 个不同的数，再加上靶心，本局目标显示在计分板的记次表里。',
    },
    cricketMarks,
    cricketScoring,
    cricketWin,
  ],
  cutThroat: [
    { label: '目标', text: '15 到 20 和靶心。' },
    cricketMarks,
    {
      label: '得分',
      text: '自己已关闭的目标再打中，分数加给这个目标还没关闭的每个对手。',
    },
    { label: '胜负', text: '全部目标都关闭，且分数不高于任何对手，立即获胜。' },
  ],
  aroundTheClock: [
    { label: '顺序', text: '按 1、2、3……20 再到靶心的顺序打。' },
    {
      label: '前进',
      text: '打中当前目标（单倍、双倍、三倍都算）就换下一个目标，一轮内可以连续前进。',
    },
    { label: '胜负', text: '先打完靶心者胜。' },
  ],
  highScore: [
    { label: '轮数', text: '每人 10 轮。' },
    { label: '得分', text: '每镖按实际分数累加。' },
    { label: '胜负', text: '10 轮后总分最高者胜。' },
  ],
  darts99: [
    { label: '轮数', text: '每人 33 轮，共 99 镖。' },
    { label: '得分', text: '只计打在 20 区的镖：单倍 20、双倍 40、三倍 60，其他区域不得分。' },
    { label: '胜负', text: '33 轮后总分最高者胜。' },
  ],
  shanghai: [
    { label: '轮数', text: '共 7 轮，第 N 轮只计打在 N 区的分。' },
    { label: 'Shanghai', text: '一轮内 N 区的单倍、双倍、三倍都打中，立即获胜。' },
    { label: '胜负', text: '没人打出 Shanghai，7 轮后总分最高者胜。' },
  ],
  halfIt: [
    {
      label: '目标',
      text: '起始 40 分，共 9 轮，目标依次为 15、16、任意双倍（含内牛）、17、18、任意三倍、19、20、靶心。',
    },
    { label: '得分', text: '打中本轮目标的镖按实际分数加分。' },
    halfRule,
    { label: '胜负', text: '9 轮后总分最高者胜。' },
  ],
  bermuda: [
    {
      label: '目标',
      text: '起始 0 分，共 13 轮，目标依次为 12、13、14、任意双倍（含内牛）、15、16、17、任意三倍、18、19、20、靶心、内牛。',
    },
    { label: '得分', text: '打中本轮目标的镖按实际分数加分；靶心那一轮内牛、外牛都算 25 分。' },
    halfRule,
    { label: '胜负', text: '13 轮后总分最高者胜。' },
  ],
  killer: [
    { label: '开局', text: '每人随机分到一个 1 到 20 的号码（计分板上的大字）和 3 条命，至少 2 人。' },
    { label: '杀手', text: '打中自己号码的双倍，成为「杀手」。' },
    {
      label: '扣命',
      text: '杀手打中对手号码的双倍，对手少一条命；杀手打中自己号码的双倍，自己少一条命。',
    },
    { label: '胜负', text: '命用完即出局，最后剩下的人获胜。' },
  ],
  gotcha301: [
    { label: '目标', text: '从 0 分往上加，正好加到 301 分获胜，不需要双倍收镖。' },
    { label: '清零', text: '任何一镖后你的总分正好等于某个对手，这个对手的分数清零。' },
    { label: '爆镖', text: '超过 301 分，这一轮不算，这一轮里让对手清零的也撤回。' },
  ],
  hammerCricket: [
    {
      label: '目标',
      text: '共 8 轮，目标依次为 20、19、18、17、16、15，最后两轮是随机抽的数（12 到 20 或靶心）。',
    },
    {
      label: '得分',
      text: '只计打中本轮目标的镖：第 1 镖按原分，第 2 镖乘 2，第 3 镖乘 3；最后一轮改为乘 1、3、5。',
    },
    { label: '扣分', text: '一轮三镖都没打中目标，扣 3 倍目标分（靶心扣 75 分），分数可以为负。' },
    { label: '胜负', text: '8 轮后总分最高者胜。' },
  ],
  catch40: [
    { label: '目标', text: '依次收 61 到 100 共 40 个数，每个数最多 6 镖（两轮）。' },
    checkoutFinish,
    {
      label: '得分',
      text: '2 镖收掉得 3 分，3 镖得 2 分（99 用 3 镖也得 3 分），4 到 6 镖得 1 分，没收掉 0 分。收掉或镖用完就换下一个数。',
    },
    { label: '胜负', text: '全部打完后总分最高者胜，满分 120。' },
  ],
  checkout4160: [
    { label: '目标', text: '依次收 41 到 60 共 20 个数，每个数一轮（3 镖）。' },
    checkoutFinish,
    { label: '得分', text: '1 到 2 镖收掉得 2 分，3 镖得 1 分，没收掉 0 分。' },
    { label: '胜负', text: '全部打完后总分最高者胜，满分 40。' },
  ],
};
