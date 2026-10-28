import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
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
const HEAT_FADE_DURATION = 700;

// Linear, so the most used segments stand out; any hit still shows faintly.
const heatOpacity = (count: number, max: number) =>
  count > 0 ? 0.08 + 0.92 * (count / max) : 0;

// Dartboard shaded by how many darts landed in each segment. A single counts for both
// single areas of its sector, since the saved throw does not say which one it was.
// The shading sits on its own layer over the plain board and fades in when shown, so every
// segment goes from the board colour to its own shade together.
export const HitMapBoard = ({
  size,
  segments,
}: {
  size: number;
  segments: PlayerSegmentCount[];
}) => {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: HEAT_FADE_DURATION,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade]);

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
  const heats = wedges.filter(wedge => wedge.opacity > 0);
  const outerBullHeat = heatOpacity(countOf('OB', 1), max);
  const innerBullHeat = heatOpacity(countOf('IB', 2), max);

  const numberRadius = ((DOUBLE_END + BOARD_OUTER_END) / 2) * scale;
  const fontSize = Math.max(9, (BOARD_OUTER_END - DOUBLE_END) * scale * 0.95);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G x={size / 2} y={size / 2}>
          <Circle r={BOARD_OUTER_END * scale} fill={HIT_COLORS.numberRing} />
          {wedges.map(wedge => (
            <Path
              key={wedge.key}
              d={wedge.d}
              fill={wedge.base}
              stroke={HIT_COLORS.wire}
              strokeWidth={0.6}
            />
          ))}
          <Circle r={OUTER_BULL_END * scale} fill={HIT_COLORS.dark} stroke={HIT_COLORS.wire} strokeWidth={0.6} />
          <Circle r={INNER_BULL_END * scale} fill={HIT_COLORS.light} stroke={HIT_COLORS.wire} strokeWidth={0.6} />
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
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Svg width={size} height={size}>
          <G x={size / 2} y={size / 2}>
            {heats.map(heat => (
              <Path key={heat.key} d={heat.d} fill={HIT_COLORS.heat} fillOpacity={heat.opacity} />
            ))}
            {/* The outer bull as a thick ring, so it does not cover the inner bull. */}
            <Circle
              r={((INNER_BULL_END + OUTER_BULL_END) / 2) * scale}
              fill="none"
              stroke={HIT_COLORS.heat}
              strokeWidth={(OUTER_BULL_END - INNER_BULL_END) * scale}
              strokeOpacity={outerBullHeat}
            />
            <Circle r={INNER_BULL_END * scale} fill={HIT_COLORS.heat} fillOpacity={innerBullHeat} />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
};
