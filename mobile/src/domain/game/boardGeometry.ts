import type { ThrowResult } from './types';
import { createThrow, getThrowSector, type ThrowRing } from './throws';

// Same normalized board model as the native scorer (VirtualBoardScorer.kt):
// radius 1 is the outer edge of the number ring, y points down, 20 is at the top.
export const INNER_BULL_END = 0.1;
export const OUTER_BULL_END = 0.2;
export const INNER_SINGLE_END = 0.45;
export const TRIPLE_END = 0.6;
export const OUTER_SINGLE_END = 0.8;
export const DOUBLE_END = 0.92;
export const BOARD_OUTER_END = 1;
// Misses produced by a manual stop sit at r = 1.08, so views need some margin.
export const VIEW_RADIUS = 1.15;

export const SECTOR_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const SECTOR_SWEEP = (2 * Math.PI) / 20;

export interface BoardPoint {
  x: number;
  y: number;
}

export const radiusOf = (point: BoardPoint) => Math.hypot(point.x, point.y);

// Clockwise angle from the top (the 20 direction), in [0, 2π).
const clockwiseAngle = (point: BoardPoint) => {
  const angle = Math.atan2(point.x, -point.y);
  return angle < 0 ? angle + 2 * Math.PI : angle;
};

export const sectorAt = (point: BoardPoint) => {
  const index = Math.floor((clockwiseAngle(point) + SECTOR_SWEEP / 2) / SECTOR_SWEEP) % 20;
  return SECTOR_ORDER[index];
};

const ringAt = (radius: number): ThrowRing => {
  if (radius < INNER_BULL_END) {
    return 'innerBull';
  }
  if (radius < OUTER_BULL_END) {
    return 'outerBull';
  }
  if (radius < INNER_SINGLE_END) {
    return 'single';
  }
  if (radius < TRIPLE_END) {
    return 'triple';
  }
  if (radius < OUTER_SINGLE_END) {
    return 'single';
  }
  if (radius <= DOUBLE_END) {
    return 'double';
  }
  return 'miss';
};

export const clampToView = (point: BoardPoint): BoardPoint => {
  const radius = radiusOf(point);
  if (radius <= VIEW_RADIUS || radius === 0) {
    return point;
  }
  const scale = VIEW_RADIUS / radius;
  return { x: point.x * scale, y: point.y * scale };
};

export const throwAt = (point: BoardPoint, id?: string): ThrowResult => {
  const ring = ringAt(radiusOf(point));
  const sector = ring === 'single' || ring === 'double' || ring === 'triple' ? sectorAt(point) : 0;
  return { ...createThrow(ring, sector, id), pointNorm: { x: point.x, y: point.y } };
};

const pointAt = (radius: number, clockwise: number): BoardPoint => ({
  x: radius * Math.sin(clockwise),
  y: -radius * Math.cos(clockwise),
});

const sectorCenterAngle = (sector: number) => SECTOR_ORDER.indexOf(sector) * SECTOR_SWEEP;

// Moves a released marker to the middle of its region so it reads clearly.
export const snapToRegionCenter = (point: BoardPoint): BoardPoint => {
  const radius = radiusOf(point);
  const ring = ringAt(radius);
  switch (ring) {
    case 'innerBull':
      return { x: 0, y: 0 };
    case 'outerBull':
    case 'miss':
      return point;
    case 'triple':
      return pointAt((INNER_SINGLE_END + TRIPLE_END) / 2, sectorCenterAngle(sectorAt(point)));
    case 'double':
      return pointAt((OUTER_SINGLE_END + DOUBLE_END) / 2, sectorCenterAngle(sectorAt(point)));
    default: {
      const singleRadius =
        radius < INNER_SINGLE_END
          ? (OUTER_BULL_END + INNER_SINGLE_END) / 2
          : (TRIPLE_END + OUTER_SINGLE_END) / 2;
      return pointAt(singleRadius, sectorCenterAngle(sectorAt(point)));
    }
  }
};

// Where to draw a throw: its detected point when it agrees with the label,
// otherwise the region center (e.g. after a manual correction from the editor).
export const markerPoint = (throwResult: ThrowResult, index: number): BoardPoint => {
  const point = throwResult.pointNorm;
  if (throwAt(point).label === throwResult.label) {
    return point;
  }
  switch (throwResult.ring) {
    case 'innerBull':
      return { x: 0, y: 0 };
    case 'outerBull':
      return pointAt((INNER_BULL_END + OUTER_BULL_END) / 2, index * ((2 * Math.PI) / 3));
    case 'miss':
      return pointAt(1.08, Math.PI / 2 + index * ((2 * Math.PI) / 3));
    case 'triple':
      return pointAt((INNER_SINGLE_END + TRIPLE_END) / 2, sectorCenterAngle(getThrowSector(throwResult)));
    case 'double':
      return pointAt((OUTER_SINGLE_END + DOUBLE_END) / 2, sectorCenterAngle(getThrowSector(throwResult)));
    default:
      return pointAt((TRIPLE_END + OUTER_SINGLE_END) / 2, sectorCenterAngle(getThrowSector(throwResult)));
  }
};
