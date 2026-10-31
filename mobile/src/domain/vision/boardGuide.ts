import type { PrepBoardDetection } from './types';

// Auto zoom and aiming guide before a round. The model only sees a square of the frame (side =
// frame width) and was trained on boards 0.55-0.9 of its height; zooming the board to
// 0.82-0.85 leaves room for swings while keeping it well inside that range. Zoom happens about
// the frame centre, so it also moves an off-centre board outwards.
export const TARGET_SHARE_MIN = 0.82;
export const TARGET_SHARE_MAX = 0.85;
const TARGET_SHARE = (TARGET_SHARE_MIN + TARGET_SHARE_MAX) / 2;
// Where the board centre (the box centre, roughly the bull) should be: a square around the frame
// centre, half its side in frame widths. Left/right is what limits it, as the model's square
// cannot move sideways: with the bull at the region's side edge the board can grow only to
// 0.76 of the width (0.96 - 2 x 0.1 with the fit margin) instead of 0.835. Players see a
// square more readily as "put the bull in here" (2026-10-31).
export const CENTRE_HALF_SIZE = 0.1;
// Space kept between a zoomed board and the edge of what the model sees, in frame widths.
const FIT_MARGIN = 0.02;
// Zoom step when the board is cut off on two opposite sides (too big to measure).
const ZOOM_OUT_STEP = 0.7;
const MIN_ZOOM_CHANGE = 0.02;

export interface PrepBoard {
  zoomRatio: number;
  frameWidth: number;
  frameHeight: number;
  bandTop: number;
  bandHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type GuideHint = 'noBoard' | 'tooBig' | 'tooSmall' | null;

export const toPrepBoard = (detection: PrepBoardDetection): PrepBoard | null =>
  detection.available && detection.found
    ? {
        zoomRatio: detection.zoomRatio ?? 1,
        frameWidth: detection.frameWidth ?? 0,
        frameHeight: detection.frameHeight ?? 0,
        bandTop: detection.bandTop ?? 0,
        bandHeight: detection.bandHeight ?? 0,
        left: detection.boardLeft ?? 0,
        top: detection.boardTop ?? 0,
        width: detection.boardWidth ?? 0,
        height: detection.boardHeight ?? 0,
      }
    : null;

const squareSide = (board: PrepBoard) => Math.min(board.frameWidth, board.frameHeight);

// Sides on which the box runs into the edge of what the model saw (the board is cut off there).
export const cutSides = (board: PrepBoard) => {
  const margin = Math.max(2, squareSide(board) / 100);
  return {
    left: board.left <= margin,
    right: board.left + board.width >= board.frameWidth - margin,
    top: board.top <= board.bandTop + margin,
    bottom: board.top + board.height >= board.bandTop + board.bandHeight - margin,
  };
};

const isCut = (board: PrepBoard) => Object.values(cutSides(board)).some(Boolean);

export const isBullCentred = (board: PrepBoard) => {
  const side = squareSide(board);
  const dx = board.left + board.width / 2 - board.frameWidth / 2;
  const dy = board.top + board.height / 2 - board.frameHeight / 2;
  return Math.abs(dx) <= CENTRE_HALF_SIZE * side && Math.abs(dy) <= CENTRE_HALF_SIZE * side;
};

// The zoom that brings the board to the target share, or null to keep the zoom. Worked out
// before zooming so the board stays inside what the model sees (zoom spreads it from the frame
// centre); an off-centre board is then zoomed only as far as fits, and more once it is centred.
export const planZoom = (
  board: PrepBoard,
  zoomMin: number,
  zoomMax: number,
): { zoomRatio: number | null; hint: GuideHint } => {
  const zoom = board.zoomRatio;
  const clamp = (value: number) => Math.min(zoomMax, Math.max(zoomMin, value));
  const keepOr = (next: number) => (Math.abs(next - zoom) >= MIN_ZOOM_CHANGE ? next : null);
  const cut = cutSides(board);
  if ((cut.left && cut.right) || (cut.top && cut.bottom)) {
    const next = keepOr(clamp(zoom * ZOOM_OUT_STEP));
    return { zoomRatio: next, hint: next === null ? 'tooBig' : null };
  }
  if (isCut(board)) {
    // Only part of the board is seen, so its size is unknown; the arrow brings it in first.
    return { zoomRatio: null, hint: null };
  }
  const side = squareSide(board);
  const share = board.height / side;
  if (share >= TARGET_SHARE_MIN && share <= TARGET_SHARE_MAX) {
    return { zoomRatio: null, hint: null };
  }
  let factor = TARGET_SHARE / share;
  if (factor > 1) {
    const margin = FIT_MARGIN * side;
    const centreX = board.frameWidth / 2;
    const centreY = board.frameHeight / 2;
    const reachX = Math.max(centreX - board.left, board.left + board.width - centreX);
    const reachY = Math.max(centreY - board.top, board.top + board.height - centreY);
    const roomX = board.frameWidth / 2 - margin;
    const roomY = board.bandHeight / 2 - margin;
    factor = Math.max(1, Math.min(factor, roomX / reachX, roomY / reachY));
  }
  const wanted = zoom * (TARGET_SHARE / share);
  const next = keepOr(clamp(zoom * factor));
  const hint: GuideHint =
    share > TARGET_SHARE_MAX && wanted < zoomMin
      ? 'tooBig'
      : share < TARGET_SHARE_MIN && wanted > zoomMax
        ? 'tooSmall'
        : null;
  return { zoomRatio: next, hint };
};

// Two detections a second apart agree on the board, so a zoom is not set from a passing glitch
// (someone walking past, a swinging board).
export const sameBoard = (a: PrepBoard, b: PrepBoard) => {
  const side = squareSide(b);
  return (
    Math.abs(a.zoomRatio - b.zoomRatio) < 0.01 &&
    a.frameWidth === b.frameWidth &&
    a.frameHeight === b.frameHeight &&
    Math.abs(a.left + a.width / 2 - (b.left + b.width / 2)) <= 0.03 * side &&
    Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) <= 0.03 * side &&
    Math.abs(a.height - b.height) <= 0.05 * b.height
  );
};

export interface PrepGuideState {
  previous: PrepBoard | null;
  missCount: number;
  settledCount: number;
}

export const INITIAL_PREP_GUIDE_STATE: PrepGuideState = {
  previous: null,
  missCount: 0,
  settledCount: 0,
};

export const FAST_INTERVAL_MS = 1000;
export const SLOW_INTERVAL_MS = 3000;
// Checks in a row with the board centred and at its size before checking less often.
const SETTLED_CHECKS = 3;
// Checks in a row without a board before zooming back out to find it.
const MISSES_BEFORE_RESET = 2;

// One check: the zoom to set (null to keep it), the hint to show and when to check again.
// autoZoomPaused: the player dragged the zoom slider this time, so only the arrow is shown.
export const stepPrepGuide = (
  state: PrepGuideState,
  detection: PrepBoardDetection,
  currentZoom: number,
  zoomMin: number,
  zoomMax: number,
  autoZoomPaused: boolean,
): { state: PrepGuideState; zoomTo: number | null; hint: GuideHint; delayMs: number } => {
  const board = toPrepBoard(detection);
  if (!board) {
    const missCount = state.missCount + 1;
    const zoomTo =
      !autoZoomPaused && missCount >= MISSES_BEFORE_RESET && currentZoom > zoomMin + 0.01
        ? zoomMin
        : null;
    return {
      state: { previous: null, missCount, settledCount: 0 },
      zoomTo,
      hint: 'noBoard',
      delayMs: FAST_INTERVAL_MS,
    };
  }
  const advice = planZoom(board, zoomMin, zoomMax);
  const confirmed = state.previous !== null && sameBoard(state.previous, board);
  const zoomTo = !autoZoomPaused && advice.zoomRatio !== null && confirmed ? advice.zoomRatio : null;
  const settled =
    (autoZoomPaused || advice.zoomRatio === null) &&
    advice.hint === null &&
    !isCut(board) &&
    isBullCentred(board);
  const settledCount = settled ? state.settledCount + 1 : 0;
  return {
    // A zoom change makes this box stale for the next comparison.
    state: { previous: zoomTo === null ? board : null, missCount: 0, settledCount },
    zoomTo,
    hint: advice.hint,
    delayMs: settledCount >= SETTLED_CHECKS ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS,
  };
};

// Board centre and target region on a square preview of the given size (FILL_CENTER shows the
// frame's full width and the middle of its height). The centre may fall outside the preview.
export const previewGuide = (board: PrepBoard, previewSize: number) => {
  const scale = previewSize / board.frameWidth;
  const hiddenTop = (board.frameHeight - board.frameWidth) / 2;
  return {
    bull: {
      x: (board.left + board.width / 2) * scale,
      y: (board.top + board.height / 2 - hiddenTop) * scale,
    },
    centred: isBullCentred(board),
  };
};
