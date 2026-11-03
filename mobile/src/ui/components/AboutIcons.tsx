import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface IconProps {
  size: number;
  color: string;
}

export const MailIcon = ({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={3} y={5} width={18} height={14} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M3.5 6.5 12 13l8.5-6.5" stroke={color} strokeWidth={1.8} fill="none" />
  </Svg>
);

// The GitHub mark (Octicons mark-github).
export const GitHubIcon = ({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Path
      fill={color}
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </Svg>
);

// A page with a folded corner.
export const LicenseIcon = ({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 3h8l4 4v14H6z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
    <Path d="M14 3v4h4M9 12h6M9 16h6" stroke={color} strokeWidth={1.8} fill="none" />
  </Svg>
);
