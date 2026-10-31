import {
  FAST_INTERVAL_MS,
  INITIAL_PREP_GUIDE_STATE,
  SLOW_INTERVAL_MS,
  isBullCentred,
  planZoom,
  previewGuide,
  stepPrepGuide,
  toPrepBoard,
} from '../src/domain/vision/boardGuide';
import type { PrepBoardDetection } from '../src/domain/vision/types';

// A 1080x1920 portrait frame; the model sees the 1400-tall band through its centre.
const detection = (
  centreX: number,
  centreY: number,
  size: number,
  zoomRatio = 1,
): PrepBoardDetection => ({
  available: true,
  found: true,
  zoomRatio,
  frameWidth: 1080,
  frameHeight: 1920,
  bandTop: 260,
  bandHeight: 1400,
  boardLeft: Math.round(centreX - size / 2),
  boardTop: Math.round(centreY - size / 2),
  boardWidth: size,
  boardHeight: size,
});

const board = (centreX: number, centreY: number, size: number, zoomRatio = 1) =>
  toPrepBoard(detection(centreX, centreY, size, zoomRatio))!;

describe('planZoom', () => {
  test('zooms a centred board to the middle of the target range', () => {
    const result = planZoom(board(540, 960, 810, 1.5), 1, 4);
    expect(result.zoomRatio).toBeCloseTo(1.5 * (0.835 / 0.75), 2);
    expect(result.hint).toBeNull();
  });

  test('keeps the zoom inside the target range', () => {
    expect(planZoom(board(540, 960, 896, 2), 1, 4).zoomRatio).toBeNull();
  });

  test('zooms an off-centre board only as far as it stays in the frame', () => {
    // Right edge 1014 px, 474 px right of centre; 518 px of room with the margin.
    const result = planZoom(board(690, 960, 648), 1, 4);
    expect(result.zoomRatio).toBeCloseTo((540 - 21.6) / 474, 2);
  });

  test('zooms a board that is too big back out', () => {
    const result = planZoom(board(540, 960, 1000, 2), 1, 4);
    expect(result.zoomRatio).toBeCloseTo(2 * (0.835 / (1000 / 1080)), 2);
  });

  test('asks to step back when the board is too big at the widest zoom', () => {
    expect(planZoom(board(540, 960, 1000), 1, 4)).toEqual({ zoomRatio: null, hint: 'tooBig' });
  });

  test('asks to come closer when even the longest zoom is too short', () => {
    const result = planZoom(board(540, 960, 300, 3.8), 1, 4);
    expect(result.zoomRatio).toBe(4);
    expect(result.hint).toBe('tooSmall');
  });

  test('does not size a board cut off on one side', () => {
    expect(planZoom(board(540, 300, 700), 1, 4)).toEqual({ zoomRatio: null, hint: null });
  });

  test('zooms out when the board is cut off at the top and the bottom', () => {
    expect(planZoom(board(540, 960, 1500, 2), 1, 4).zoomRatio).toBeCloseTo(1.4, 5);
  });
});

describe('isBullCentred', () => {
  test('takes a square of a fifth of the width around the centre', () => {
    expect(isBullCentred(board(540 + 100, 960 - 100, 800))).toBe(true);
    expect(isBullCentred(board(540 + 120, 960, 800))).toBe(false);
    expect(isBullCentred(board(540, 960 + 120, 800))).toBe(false);
  });
});

describe('stepPrepGuide', () => {
  test('zooms only after two checks agree', () => {
    const first = stepPrepGuide(INITIAL_PREP_GUIDE_STATE, detection(540, 960, 700), 1, 1, 4, false);
    expect(first.zoomTo).toBeNull();
    const second = stepPrepGuide(first.state, detection(545, 958, 705), 1, 1, 4, false);
    expect(second.zoomTo).toBeGreaterThan(1.2);
    expect(second.state.previous).toBeNull();
  });

  test('leaves the zoom to the player after a manual drag', () => {
    const first = stepPrepGuide(INITIAL_PREP_GUIDE_STATE, detection(540, 960, 700), 1, 1, 4, true);
    const second = stepPrepGuide(first.state, detection(540, 960, 700), 1, 1, 4, true);
    expect(second.zoomTo).toBeNull();
  });

  test('goes back to the widest zoom after two checks without a board', () => {
    const missing: PrepBoardDetection = { available: true, found: false };
    const first = stepPrepGuide(INITIAL_PREP_GUIDE_STATE, missing, 2, 1, 4, false);
    expect(first).toMatchObject({ zoomTo: null, hint: 'noBoard' });
    expect(stepPrepGuide(first.state, missing, 2, 1, 4, false).zoomTo).toBe(1);
    expect(stepPrepGuide(first.state, missing, 2, 1, 4, true).zoomTo).toBeNull();
  });

  test('checks less often once the board stays centred at its size', () => {
    let state = INITIAL_PREP_GUIDE_STATE;
    const delays: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const step = stepPrepGuide(state, detection(540, 1000, 900, 2), 2, 1, 4, false);
      state = step.state;
      delays.push(step.delayMs);
    }
    expect(delays).toEqual([FAST_INTERVAL_MS, FAST_INTERVAL_MS, SLOW_INTERVAL_MS, SLOW_INTERVAL_MS]);
  });
});

describe('previewGuide', () => {
  test('maps the frame centre to the middle of the square preview', () => {
    expect(previewGuide(board(540, 960, 800), 300).bull).toEqual({ x: 150, y: 150 });
  });

  test('places a high board above the preview', () => {
    expect(previewGuide(board(540, 300, 400), 300).bull.y).toBeLessThan(0);
  });
});
