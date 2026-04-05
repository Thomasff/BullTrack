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
