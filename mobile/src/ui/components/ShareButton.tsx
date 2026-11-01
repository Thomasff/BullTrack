import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../app/navigation/types';

interface ShareIconProps {
  size: number;
  color: string;
}

// Three linked dots, the usual Android share glyph.
export const ShareIcon = ({ size, color }: ShareIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8.6 10.7 15.4 7.3M8.6 13.3l6.8 3.4" stroke={color} strokeWidth={2} fill="none" />
    <Circle cx={18} cy={6} r={3} fill={color} />
    <Circle cx={6} cy={12} r={3} fill={color} />
    <Circle cx={18} cy={18} r={3} fill={color} />
  </Svg>
);

interface ShareButtonProps {
  onPress: () => void;
  // 'overlay' is a dark round button over the board, 'header' a bare icon for the title bar.
  variant: 'overlay' | 'header';
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const ShareButton = ({ onPress, variant, color, style }: ShareButtonProps) => (
  <Pressable
    accessibilityLabel="分享"
    hitSlop={8}
    onPress={onPress}
    style={({ pressed }) => [
      variant === 'overlay' ? styles.overlay : styles.header,
      pressed && styles.pressed,
      style,
    ]}>
    <ShareIcon size={variant === 'overlay' ? 18 : 20} color={color ?? (variant === 'overlay' ? '#F7F8FA' : '#1E1A16')} />
  </Pressable>
);

// Title bar button of the match detail page: shares the whole match.
export const MatchShareHeaderButton = ({ matchId }: { matchId: number }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <ShareButton variant="header" onPress={() => navigation.navigate('SharePreview', { matchId })} />;
};

const styles = StyleSheet.create({
  overlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 16, 24, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  header: {
    padding: 6,
  },
  pressed: {
    opacity: 0.7,
  },
});
