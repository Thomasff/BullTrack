import React from 'react';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import {
  BOARD_OUTER_END,
  DOUBLE_END,
  INNER_BULL_END,
  INNER_SINGLE_END,
  OUTER_BULL_END,
  OUTER_SINGLE_END,
  SECTOR_ORDER,
  TRIPLE_END,
  VIEW_RADIUS,
} from '../../domain/game/boardGeometry';
import type { PlayerSegmentCount } from '../../domain/history/types';
import { wedgePath } from './DartBoard';

const HIT_COLORS = {
  numberRing: '#1E1A16',
  dark: '#2A2520',
  light: '#38312A',
  wire: 'rgba(255, 255, 255, 0.12)',
  number: '#F4F1E8',
  heat: '#F2C14E',
};

const SECTOR_SWEEP = (2 * Math.PI) / 20;

// Square root, so a few darts in a segment still show next to a well-used one.
const heatOpacity = (count: number, max: number) =>
  count > 0 ? 0.15 + 0.85 * Math.sqrt(count / max) : 0;

// Dartboard shaded by how many darts landed in each segment. A single counts for both
// single areas of its sector, since the saved throw does not say which one it was.
export const HitMapBoard = ({
  size,
  segments,
}: {
  size: number;
  segments: PlayerSegmentCount[];
}) => {
  const scale = size / 2 / VIEW_RADIUS;
  const countOf = (target: string, multiplier: number) =>
    segments.find(segment => segment.target === target && segment.multiplier === multiplier)
      ?.count ?? 0;
  const max = Math.max(
    1,
    ...segments.filter(segment => segment.target !== 'miss').map(segment => segment.count),
  );

  const wedges: Array<{ key: string; d: string; base: string; opacity: number }> = [];
  SECTOR_ORDER.forEach((sector, index) => {
    const start = index * SECTOR_SWEEP - SECTOR_SWEEP / 2;
    const end = start + SECTOR_SWEEP;
    const base = index % 2 === 0 ? HIT_COLORS.dark : HIT_COLORS.light;
    const target = `${sector}`;
    const single = heatOpacity(countOf(target, 1), max);
    wedges.push(
      {
        key: `d${sector}`,
        d: wedgePath(scale, OUTER_SINGLE_END, DOUBLE_END, start, end),
        base,
        opacity: heatOpacity(countOf(target, 2), max),
      },
      { key: `o${sector}`, d: wedgePath(scale, TRIPLE_END, OUTER_SINGLE_END, start, end), base, opacity: single },
      {
        key: `t${sector}`,
        d: wedgePath(scale, INNER_SINGLE_END, TRIPLE_END, start, end),
        base,
        opacity: heatOpacity(countOf(target, 3), max),
      },
      { key: `i${sector}`, d: wedgePath(scale, OUTER_BULL_END, INNER_SINGLE_END, start, end), base, opacity: single },
    );
  });

  const numberRadius = ((DOUBLE_END + BOARD_OUTER_END) / 2) * scale;
  const fontSize = Math.max(9, (BOARD_OUTER_END - DOUBLE_END) * scale * 0.95);

  return (
    <Svg width={size} height={size}>
      <G x={size / 2} y={size / 2}>
        <Circle r={BOARD_OUTER_END * scale} fill={HIT_COLORS.numberRing} />
        {wedges.map(wedge => (
          <G key={wedge.key}>
            <Path d={wedge.d} fill={wedge.base} stroke={HIT_COLORS.wire} strokeWidth={0.6} />
            {wedge.opacity > 0 ? (
              <Path d={wedge.d} fill={HIT_COLORS.heat} fillOpacity={wedge.opacity} />
            ) : null}
          </G>
        ))}
        <Circle r={OUTER_BULL_END * scale} fill={HIT_COLORS.dark} stroke={HIT_COLORS.wire} strokeWidth={0.6} />
        <Circle
          r={OUTER_BULL_END * scale}
          fill={HIT_COLORS.heat}
          fillOpacity={heatOpacity(countOf('OB', 1), max)}
        />
        <Circle r={INNER_BULL_END * scale} fill={HIT_COLORS.light} stroke={HIT_COLORS.wire} strokeWidth={0.6} />
        <Circle
          r={INNER_BULL_END * scale}
          fill={HIT_COLORS.heat}
          fillOpacity={heatOpacity(countOf('IB', 2), max)}
        />
        {SECTOR_ORDER.map((sector, index) => {
          const angle = index * SECTOR_SWEEP;
          return (
            <SvgText
              key={sector}
              x={numberRadius * Math.sin(angle)}
              y={-numberRadius * Math.cos(angle) + fontSize * 0.35}
              fill={HIT_COLORS.number}
              fontSize={fontSize}
              fontWeight="700"
              textAnchor="middle">
              {sector}
            </SvgText>
          );
        })}
      </G>
    </Svg>
  );
};
