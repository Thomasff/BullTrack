import type { Translation } from '../zh';

export const debug: Translation['debug'] = {
  title: 'Debug images',
  description:
    'Keeps the debug images and logs of the last 10 rounds. When detection goes wrong, pick that round and export a debug bundle to attach to your report.',
  boardPreview: 'Virtual board preview',
  rounds: 'Rounds',
  currentRound: '{{clock}} (this round)',
  noRounds: 'No debug images yet. Turn on "Show debug info" and play a round, and they will show up here.',
  noImages: 'No debug images for this round (it may have failed at the start); the debug bundle only has the log.',
  packing: 'Packing…',
  exportBundle: 'Export debug bundle',
  exportFailed: 'Export failed: {{error}}',
  reload: 'Reload',
};
