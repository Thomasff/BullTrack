export type DebugArtifactKind =
  | 'boardRectifiedPreview'
  | 'adaptiveRedSamplePoints'
  | 'yoloRedetectOverlay'
  | 'localDiff';

export interface DebugArtifact {
  id: string;
  roundId: string;
  kind: DebugArtifactKind;
  title: string;
  path: string;
  note?: string;
}

// Where the board is before a round, from a still of the whole upright frame. The model saw a
// band as wide as the frame (bandTop, bandHeight); the board box is in frame pixels.
export interface PrepBoardDetection {
  // False while a round holds the camera or no preview runs; nothing else is set then.
  available: boolean;
  found?: boolean;
  zoomRatio?: number;
  frameWidth?: number;
  frameHeight?: number;
  bandTop?: number;
  bandHeight?: number;
  boardLeft?: number;
  boardTop?: number;
  boardWidth?: number;
  boardHeight?: number;
}
