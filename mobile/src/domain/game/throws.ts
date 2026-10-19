import type { ThrowResult } from './types';

export type ThrowRing = ThrowResult['ring'];

export const BOARD_SECTORS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];

// Builds a ThrowResult with the same label/score conventions as the native bridge.
export const createThrow = (
  ring: ThrowRing,
  sector = 0,
  id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): ThrowResult => {
  switch (ring) {
    case 'innerBull':
      return { id, label: 'IB', score: 50, ring, pointNorm: { x: 0, y: 0 } };
    case 'outerBull':
      return { id, label: 'OB', score: 25, ring, pointNorm: { x: 0, y: 0 } };
    case 'miss':
      return { id, label: 'MISS', score: 0, ring, pointNorm: { x: 0, y: 0 } };
    case 'double':
      return { id, label: `D${sector}`, score: sector * 2, ring, pointNorm: { x: 0, y: 0 } };
    case 'triple':
      return { id, label: `T${sector}`, score: sector * 3, ring, pointNorm: { x: 0, y: 0 } };
    default:
      return { id, label: `S${sector}`, score: sector, ring, pointNorm: { x: 0, y: 0 } };
  }
};

// Returns the board sector of a throw: 1-20, 25 for bull, 0 for miss.
export const getThrowSector = (throwResult: ThrowResult) => {
  if (throwResult.ring === 'miss') {
    return 0;
  }
  if (throwResult.ring === 'innerBull' || throwResult.ring === 'outerBull') {
    return 25;
  }
  return parseInt(throwResult.label.replace(/^[DST]/, ''), 10) || 0;
};

export const getThrowMultiplier = (throwResult: ThrowResult) => {
  switch (throwResult.ring) {
    case 'triple':
      return 3;
    case 'double':
    case 'innerBull':
      return 2;
    case 'miss':
      return 0;
    default:
      return 1;
  }
};
