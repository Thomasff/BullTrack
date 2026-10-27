import { requireNativeComponent, type NativeSyntheticEvent, type ViewProps } from 'react-native';

export type PreviewStateChangeEvent = NativeSyntheticEvent<{ streaming: boolean }>;

interface BullTrackPreviewProps extends ViewProps {
  zoomRatio: number;
  onPreviewStateChange?: (event: PreviewStateChangeEvent) => void;
}

// Native CameraX preview (BullTrackPreviewViewManager). It holds the camera while mounted, so
// render it only while the preview should be on screen.
export const BullTrackPreview = requireNativeComponent<BullTrackPreviewProps>('BullTrackPreview');
