import React, { memo, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
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
  clampToView,
  markerPoint,
  snapToRegionCenter,
  throwAt,
  type BoardPoint,
} from '../../domain/game/boardGeometry';
import type { ThrowResult } from '../../domain/game/types';

export const DART_MARKER_COLORS = ['#F2C14E', '#4FB3BF', '#E8775A'];

const BOARD_COLORS = {
  background: '#15120F',
  numberRing: '#1E1A16',
  darkSingle: '#2A2520',
  lightSingle: '#EFE3C8',
  red: '#C2402F',
  green: '#2E7D4F',
  wire: 'rgba(255, 255, 255, 0.18)',
  number: '#F4F1E8',
  highlight: 'rgba(255, 255, 255, 0.45)',
};

const MARKER_SIZE = 26;
const TOUCH_SIZE = 52;
const SECTOR_SWEEP = (2 * Math.PI) / 20;

interface DartBoardProps {
  size: number;
  throws: ThrowResult[];
  editable: boolean;
  onThrowChange?: (index: number, throwResult: ThrowResult) => void;
}

// Annular wedge between two radii (normalized) and two clockwise-from-top angles.
const wedgePath = (
  scale: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) => {
  const point = (radius: number, angle: number) =>
    `${(radius * scale * Math.sin(angle)).toFixed(2)} ${(-radius * scale * Math.cos(angle)).toFixed(2)}`;
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const outerR = (outerRadius * scale).toFixed(2);
  const innerR = (innerRadius * scale).toFixed(2);
  return [
    `M ${point(outerRadius, startAngle)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${point(outerRadius, endAngle)}`,
    `L ${point(innerRadius, endAngle)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${point(innerRadius, startAngle)}`,
    'Z',
  ].join(' ');
};

// Region (ring band + sector) under a point, used for the drag highlight.
const regionPath = (scale: number, point: BoardPoint) => {
  const scored = throwAt(point);
  if (scored.ring === 'miss') {
    return null;
  }
  if (scored.ring === 'innerBull' || scored.ring === 'outerBull') {
    const outer = scored.ring === 'innerBull' ? INNER_BULL_END : OUTER_BULL_END;
    const inner = scored.ring === 'innerBull' ? 0.0001 : INNER_BULL_END;
    return wedgePath(scale, inner, outer, 0, 2 * Math.PI - 0.0001);
  }
  const radius = Math.hypot(point.x, point.y);
  const [inner, outer] =
    scored.ring === 'triple'
      ? [INNER_SINGLE_END, TRIPLE_END]
      : scored.ring === 'double'
        ? [OUTER_SINGLE_END, DOUBLE_END]
        : radius < INNER_SINGLE_END
          ? [OUTER_BULL_END, INNER_SINGLE_END]
          : [TRIPLE_END, OUTER_SINGLE_END];
  const index = SECTOR_ORDER.indexOf(parseInt(scored.label.replace(/^[DST]/, ''), 10));
  const start = index * SECTOR_SWEEP - SECTOR_SWEEP / 2;
  return wedgePath(scale, inner, outer, start, start + SECTOR_SWEEP);
};

// Static board drawing; memoized so dragging a marker never redraws it.
const BoardFace = memo(({ size }: { size: number }) => {
  const scale = size / 2 / VIEW_RADIUS;
  const wedges = useMemo(() => {
    const paths: Array<{ key: string; d: string; fill: string }> = [];
    SECTOR_ORDER.forEach((_, index) => {
      const start = index * SECTOR_SWEEP - SECTOR_SWEEP / 2;
      const end = start + SECTOR_SWEEP;
      const even = index % 2 === 0;
      const single = even ? BOARD_COLORS.darkSingle : BOARD_COLORS.lightSingle;
      const multiplier = even ? BOARD_COLORS.red : BOARD_COLORS.green;
      paths.push(
        { key: `d${index}`, d: wedgePath(scale, OUTER_SINGLE_END, DOUBLE_END, start, end), fill: multiplier },
        { key: `o${index}`, d: wedgePath(scale, TRIPLE_END, OUTER_SINGLE_END, start, end), fill: single },
        { key: `t${index}`, d: wedgePath(scale, INNER_SINGLE_END, TRIPLE_END, start, end), fill: multiplier },
        { key: `i${index}`, d: wedgePath(scale, OUTER_BULL_END, INNER_SINGLE_END, start, end), fill: single },
      );
    });
    return paths;
  }, [scale]);

  const numberRadius = ((DOUBLE_END + BOARD_OUTER_END) / 2) * scale;
  const fontSize = Math.max(9, (BOARD_OUTER_END - DOUBLE_END) * scale * 0.95);

  return (
    <Svg width={size} height={size}>
      <G x={size / 2} y={size / 2}>
        <Circle r={BOARD_OUTER_END * scale} fill={BOARD_COLORS.numberRing} />
        {wedges.map(wedge => (
          <Path
            key={wedge.key}
            d={wedge.d}
            fill={wedge.fill}
            stroke={BOARD_COLORS.wire}
            strokeWidth={0.6}
          />
        ))}
        <Circle r={OUTER_BULL_END * scale} fill={BOARD_COLORS.green} stroke={BOARD_COLORS.wire} strokeWidth={0.6} />
        <Circle r={INNER_BULL_END * scale} fill={BOARD_COLORS.red} stroke={BOARD_COLORS.wire} strokeWidth={0.6} />
        {SECTOR_ORDER.map((sector, index) => {
          const angle = index * SECTOR_SWEEP;
          return (
            <SvgText
              key={sector}
              x={numberRadius * Math.sin(angle)}
              y={-numberRadius * Math.cos(angle) + fontSize * 0.35}
              fill={BOARD_COLORS.number}
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
});

interface MarkerProps {
  index: number;
  needsCheck: boolean;
  point: BoardPoint;
  scale: number;
  center: number;
  editable: boolean;
  dragging: boolean;
  onDragStart: (index: number) => void;
  onDragMove: (index: number, point: BoardPoint) => void;
  onDragEnd: (index: number, point: BoardPoint) => void;
}

const Marker = ({
  index,
  needsCheck,
  point,
  scale,
  center,
  editable,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
}: MarkerProps) => {
  // Refs keep the responder stable while props change during a drag.
  const startPoint = useRef(point);
  const lastPoint = useRef(point);
  const latest = useRef({ point, scale, editable, onDragStart, onDragMove, onDragEnd });
  latest.current = { point, scale, editable, onDragStart, onDragMove, onDragEnd };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => latest.current.editable,
        onMoveShouldSetPanResponder: () => latest.current.editable,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startPoint.current = latest.current.point;
          lastPoint.current = latest.current.point;
          latest.current.onDragStart(index);
        },
        onPanResponderMove: (_event, gesture) => {
          const next = clampToView({
            x: startPoint.current.x + gesture.dx / latest.current.scale,
            y: startPoint.current.y + gesture.dy / latest.current.scale,
          });
          lastPoint.current = next;
          latest.current.onDragMove(index, next);
        },
        onPanResponderRelease: () => latest.current.onDragEnd(index, lastPoint.current),
        onPanResponderTerminate: () => latest.current.onDragEnd(index, lastPoint.current),
      }),
    [index],
  );

  const color = DART_MARKER_COLORS[index % DART_MARKER_COLORS.length];
  return (
    <View
      {...responder.panHandlers}
      style={[
        styles.touchArea,
        {
          left: center + point.x * scale - TOUCH_SIZE / 2,
          top: center + point.y * scale - TOUCH_SIZE / 2,
        },
      ]}>
      <View
        style={[
          styles.marker,
          { backgroundColor: color },
          dragging && styles.markerDragging,
        ]}>
        <Text style={styles.markerLabel}>{needsCheck ? '?' : index + 1}</Text>
      </View>
    </View>
  );
};

export const DartBoard = ({ size, throws, editable, onThrowChange }: DartBoardProps) => {
  const [drag, setDrag] = useState<{ index: number; point: BoardPoint } | null>(null);
  const scale = size / 2 / VIEW_RADIUS;
  const center = size / 2;
  const hovered = drag ? throwAt(drag.point) : null;
  const highlight = drag ? regionPath(scale, drag.point) : null;

  return (
    <View style={{ width: size, height: size }}>
      <BoardFace size={size} />
      {highlight ? (
        <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
          <G x={center} y={center}>
            <Path d={highlight} fill={BOARD_COLORS.highlight} />
          </G>
        </Svg>
      ) : null}
      {throws.map((throwResult, index) => (
        <Marker
          key={index}
          index={index}
          needsCheck={throwResult.needsCheck === true}
          point={drag?.index === index ? drag.point : markerPoint(throwResult, index)}
          scale={scale}
          center={center}
          editable={editable}
          dragging={drag?.index === index}
          onDragStart={dragIndex =>
            setDrag({ index: dragIndex, point: markerPoint(throws[dragIndex], dragIndex) })
          }
          onDragMove={(dragIndex, point) => setDrag({ index: dragIndex, point })}
          onDragEnd={(dragIndex, point) => {
            setDrag(null);
            const snapped = snapToRegionCenter(point);
            onThrowChange?.(dragIndex, throwAt(snapped, throws[dragIndex]?.id));
          }}
        />
      ))}
      {hovered && drag ? (
        // Corner badge stays off the board numbers; it drops to the bottom
        // corner while the finger is in the upper-right quarter so it is not covered.
        <View
          style={[
            styles.hoverBadge,
            drag.point.x > 0 && drag.point.y < 0 ? styles.hoverBadgeBottom : styles.hoverBadgeTop,
          ]}
          pointerEvents="none">
          <Text style={styles.hoverLabel}>
            {hovered.ring === 'miss' ? '脱靶' : hovered.label} · {hovered.score}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  touchArea: {
    position: 'absolute',
    width: TOUCH_SIZE,
    height: TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  markerDragging: {
    transform: [{ scale: 1.25 }],
  },
  markerLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E1A16',
  },
  hoverBadge: {
    position: 'absolute',
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(12, 16, 24, 0.82)',
  },
  hoverBadgeTop: {
    top: 0,
  },
  hoverBadgeBottom: {
    bottom: 0,
  },
  hoverLabel: {
    color: '#F7F8FA',
    fontSize: 15,
    fontWeight: '800',
  },
});
