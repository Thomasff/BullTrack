import {
  markerPoint,
  sectorAt,
  snapToRegionCenter,
  throwAt,
} from '../src/domain/game/boardGeometry';
import { createThrow } from '../src/domain/game/throws';

// Reference values follow VirtualBoardScorer.kt (y points down, 20 at the top).
describe('throwAt', () => {
  test.each([
    [{ x: 0, y: 0 }, 'IB', 50],
    [{ x: 0, y: -0.15 }, 'OB', 25],
    [{ x: 0, y: -0.3 }, 'S20', 20],
    [{ x: 0, y: -0.5 }, 'T20', 60],
    [{ x: 0, y: -0.7 }, 'S20', 20],
    [{ x: 0, y: -0.9 }, 'D20', 40],
    [{ x: 0, y: -0.95 }, 'MISS', 0],
    [{ x: 0.5, y: 0 }, 'T6', 18],
    [{ x: 0, y: 0.5 }, 'T3', 9],
    [{ x: -0.5, y: 0 }, 'T11', 33],
  ])('%j -> %s', (point, label, score) => {
    const result = throwAt(point);
    expect(result.label).toBe(label);
    expect(result.score).toBe(score);
  });

  test('sector boundaries are 9 degrees either side of the top', () => {
    const at = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return sectorAt({ x: Math.sin(radians), y: -Math.cos(radians) });
    };
    expect(at(8.9)).toBe(20);
    expect(at(9.1)).toBe(1);
    expect(at(-8.9)).toBe(20);
    expect(at(-9.1)).toBe(5);
  });
});

test('snapping keeps the region and moves to its center', () => {
  const raw = { x: 0.07, y: -0.47 };
  const snapped = snapToRegionCenter(raw);
  expect(throwAt(snapped).label).toBe(throwAt(raw).label);
  expect(snapped.x).toBeCloseTo(0);
});

test('markers for corrected throws land inside their region', () => {
  const corrected = createThrow('triple', 19);
  expect(throwAt(markerPoint(corrected, 0)).label).toBe('T19');
  const miss = createThrow('miss');
  expect(throwAt(markerPoint(miss, 1)).label).toBe('MISS');
});
