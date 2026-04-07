import React from 'react';
import {
  UIManager,
  requireNativeComponent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  collapsable?: boolean;
}

const LegacyBullTrackCameraPreview = requireNativeComponent<NativeProps>('BullTrackCameraPreview');
const hasPreviewManagerConfig = Boolean(UIManager.getViewManagerConfig?.('BullTrackCameraPreview'));
const previewRenderStrategy = hasPreviewManagerConfig ? 'legacy-requireNativeComponent' : 'missing-view-manager-config';

export const BullTrackCameraPreview = ({ style }: NativeProps) => {
  return <LegacyBullTrackCameraPreview style={style} collapsable={false} />;
};

export const bullTrackCameraPreviewDiagnostics = {
  hasPreviewManagerConfig,
  previewRenderStrategy,
};
