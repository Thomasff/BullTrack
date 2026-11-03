import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Trans, useTranslation } from 'react-i18next';
import Svg, { Circle, Ellipse, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { BoardFace } from './DartBoard';
import { PrimaryButton } from './PrimaryButton';
import { useSettingsStore, type BoardKind } from '../../application/stores/settingsStore';
import { VIEW_RADIUS } from '../../domain/game/boardGeometry';
import { colors } from '../theme/colors';

interface PlacementGuideProps {
  visible: boolean;
  onClose: () => void;
}

// Scenes are drawn in a 300 × 262 box and scaled to the card's width.
const SCENE_W = 300;
const SCENE_H = 262;
// Each frame of a step: move for MOVE_MS, then hold; a step ends after its last frame.
const FRAME_MS = 2300;
const MOVE_MS = 650;
const TICK_MS = 33;
// BoardFace is drawn once at this size and scaled, so the animation never redraws its wedges.
const BOARD_BASE = 200;

// Step 1 is the room seen from above and behind the throw line, in metres: x to the right,
// y up, z out from the wall. The board and the phone are drawn larger than life to be seen.
type Vec = [number, number, number];
const CAMERA: Vec = [0.35, 4.0, 4.9];
const TARGET: Vec = [0, 0.75, 1.0];
const FOCAL = 300;
const OCHE_Z = 2.37;
const BOARD_Y = 1.73;
const BOARD_R = 0.4;
const PHONE_Y = 1.0;
const TAN_15 = Math.tan(Math.PI / 12);
// The phone stands 35-50% of the way from the board to the throw line.
const ZONE_NEAR = 0.35 * OCHE_Z;
const ZONE_FAR = 0.5 * OCHE_Z;

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};
const FORWARD = unit(sub(TARGET, CAMERA));
const RIGHT = unit(cross(FORWARD, [0, 1, 0]));
const UP = cross(RIGHT, FORWARD);

type Point = [number, number];
const project = (x: number, y: number, z: number): Point => {
  const d = sub([x, y, z], CAMERA);
  const depth = dot(d, FORWARD);
  return [150 + (FOCAL * dot(d, RIGHT)) / depth, 130 - (FOCAL * dot(d, UP)) / depth];
};
const pointList = (points: Point[]) => points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

const WALL = pointList([project(-1.5, 2.35, 0), project(1.5, 2.35, 0), project(1.5, 0, 0), project(-1.5, 0, 0)]);
const FLOOR = pointList([project(-1.5, 0, 0), project(1.5, 0, 0), project(1.5, 0, 2.75), project(-1.5, 0, 2.75)]);
const zone = (side: number) =>
  pointList([
    project(side * ZONE_NEAR * TAN_15, 0, ZONE_NEAR),
    project(side * ZONE_NEAR, 0, ZONE_NEAR),
    project(side * ZONE_FAR, 0, ZONE_FAR),
    project(side * ZONE_FAR * TAN_15, 0, ZONE_FAR),
  ]);
const ZONES = [zone(-1), zone(1)];
const WALL_FOOT = project(0, 0, 0);
const CENTRE_END = project(0, 0, OCHE_Z);
// 15° and 45° off straight ahead, both sides.
const RAYS = [-1, 1].flatMap(side => [project(side * OCHE_Z * TAN_15, 0, OCHE_Z), project(side * 1.5, 0, 1.5)]);
const RULER = [project(1.35, 0, 0), project(1.35, 0, OCHE_Z)];
const RULER_ZONE = [project(1.35, 0, ZONE_NEAR), project(1.35, 0, ZONE_FAR)];
const RULER_MID = [project(1.28, 0, ZONE_FAR), project(1.42, 0, ZONE_FAR)];
const OCHE = [project(-0.6, 0, OCHE_Z), project(0.6, 0, OCHE_Z)];
const ZONE_LABEL = project(-ZONE_FAR - 0.05, 0, ZONE_FAR + 0.05);
const BOARD_CENTRE = project(0, BOARD_Y, 0);
const BOARD_LEFT = project(-BOARD_R, BOARD_Y, 0);
const BOARD_RIGHT = project(BOARD_R, BOARD_Y, 0);
const BOARD_RX = (BOARD_RIGHT[0] - BOARD_LEFT[0]) / 2;
const BOARD_RY = (project(0, BOARD_Y - BOARD_R, 0)[1] - project(0, BOARD_Y + BOARD_R, 0)[1]) / 2;

type Label =
  | 'guide.position.tooStraight'
  | 'guide.position.tooAngled'
  | 'guide.position.tooFar'
  | 'guide.position.left'
  | 'guide.position.right'
  | 'guide.view.small'
  | 'guide.view.centre'
  | 'guide.view.zoom'
  | 'guide.light.dark'
  | 'guide.light.glare'
  | 'guide.light.good';

interface Frame {
  values: Record<string, number>;
  ok: boolean;
  label: Label;
}

const STEPS: Array<{ title: 'guide.steps.position' | 'guide.steps.view' | 'guide.steps.light'; frames: Frame[] }> = [
  {
    // Where the tripod stands on the floor (x, z in metres).
    title: 'guide.steps.position',
    frames: [
      { values: { x: 0, z: 1.0 }, ok: false, label: 'guide.position.tooStraight' },
      { values: { x: -1.25, z: 1.0 }, ok: false, label: 'guide.position.tooAngled' },
      { values: { x: -0.55, z: 1.95 }, ok: false, label: 'guide.position.tooFar' },
      { values: { x: -0.5, z: 1.0 }, ok: true, label: 'guide.position.left' },
      { values: { x: 0.5, z: 1.0 }, ok: true, label: 'guide.position.right' },
    ],
  },
  {
    // The board in the phone's view: centre, size (1 = radius 100) and the zoom slider.
    title: 'guide.steps.view',
    frames: [
      { values: { cx: 92, cy: 72, size: 0.42, zoom: 1 }, ok: false, label: 'guide.view.small' },
      { values: { cx: 150, cy: 110, size: 0.42, zoom: 1 }, ok: false, label: 'guide.view.centre' },
      { values: { cx: 150, cy: 110, size: 0.84, zoom: 1.8 }, ok: true, label: 'guide.view.zoom' },
    ],
  },
  {
    // Darkness over the scene, glare on the board and the lamp.
    title: 'guide.steps.light',
    frames: [
      { values: { dark: 0.62, glare: 0, lamp: 0 }, ok: false, label: 'guide.light.dark' },
      { values: { dark: 0, glare: 0.9, lamp: 1 }, ok: false, label: 'guide.light.glare' },
      { values: { dark: 0, glare: 0, lamp: 1 }, ok: true, label: 'guide.light.good' },
    ],
  },
];

const TIPS = ['side', 'depth', 'frame', 'light', 'still'] as const;

const easeInOut = (a: number) => (a < 0.5 ? 2 * a * a : 1 - Math.pow(-2 * a + 2, 2) / 2);

// A BoardFace scaled to an ellipse with radii rx, ry (outer edge) round (cx, cy), in scene units.
const BoardEllipse = ({ kind, scale, cx, cy, rx, ry }: {
  kind: BoardKind;
  scale: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}) => {
  const fullSize = BOARD_BASE / VIEW_RADIUS;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.board,
        {
          left: cx * scale - BOARD_BASE / 2,
          top: cy * scale - BOARD_BASE / 2,
          transform: [{ scaleX: (2 * rx * scale) / fullSize }, { scaleY: (2 * ry * scale) / fullSize }],
        },
      ]}>
      <BoardFace size={BOARD_BASE} kind={kind} showNumbers={false} />
    </View>
  );
};

const PositionScene = ({ v, ok, scale, kind, ocheLabel, midLabel }: {
  v: Record<string, number>;
  ok: boolean | null;
  scale: number;
  kind: BoardKind;
  ocheLabel: string;
  midLabel: string;
}) => {
  const { x, z } = v;
  // The phone faces the board, upright, on a tripod.
  const toBoard = unit([-x, 0, -z]);
  const across: Vec = [-toBoard[2], 0, toBoard[0]];
  const corner = (a: number, b: number) => project(x + across[0] * a, PHONE_Y + b, z + across[2] * a);
  const phone = pointList([corner(-0.075, -0.12), corner(0.075, -0.12), corner(0.075, 0.12), corner(-0.075, 0.12)]);
  const top = project(x, PHONE_Y - 0.12, z);
  const foot = project(x, 0, z);
  const legs = [0, 1, 2].map(i => {
    const angle = (i / 3) * 2 * Math.PI + 0.5;
    return project(x + Math.cos(angle) * 0.28, 0, z + Math.sin(angle) * 0.28);
  });
  const centre = project(x, PHONE_Y, z);
  const sightColor = ok === null ? '#8C8172' : ok ? colors.success : colors.danger;
  return (
    <View style={{ width: SCENE_W * scale, height: SCENE_H * scale }}>
      <Svg width={SCENE_W * scale} height={SCENE_H * scale} viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}>
        <Polygon points={WALL} fill="#E6DCCB" />
        <Polygon points={FLOOR} fill="#EFE6D4" />
        <Line x1={WALL_FOOT[0]} y1={WALL_FOOT[1]} x2={CENTRE_END[0]} y2={CENTRE_END[1]} stroke="#B9AE9C" strokeDasharray="4 4" />
        {RAYS.map((ray, index) => (
          <Line key={index} x1={WALL_FOOT[0]} y1={WALL_FOOT[1]} x2={ray[0]} y2={ray[1]} stroke="#C9BFAF" strokeWidth={0.8} />
        ))}
        {ZONES.map((points, index) => (
          <Polygon key={index} points={points} fill={colors.success} fillOpacity={0.16} stroke={colors.success} strokeWidth={1} />
        ))}
        <SvgText x={ZONE_LABEL[0] - 4} y={ZONE_LABEL[1] + 14} fontSize={11} fill={colors.success}>
          15°–45°
        </SvgText>
        <Line x1={RULER[0][0]} y1={RULER[0][1]} x2={RULER[1][0]} y2={RULER[1][1]} stroke="#C9BFAF" />
        <Line
          x1={RULER_ZONE[0][0]}
          y1={RULER_ZONE[0][1]}
          x2={RULER_ZONE[1][0]}
          y2={RULER_ZONE[1][1]}
          stroke={colors.success}
          strokeWidth={4}
        />
        <Line x1={RULER_MID[0][0]} y1={RULER_MID[0][1]} x2={RULER_MID[1][0]} y2={RULER_MID[1][1]} stroke={colors.textSecondary} />
        <SvgText x={RULER_MID[1][0] + 3} y={RULER_MID[1][1] + 4} fontSize={11} fill={colors.textSecondary}>
          {midLabel}
        </SvgText>
        <Line x1={OCHE[0][0]} y1={OCHE[0][1]} x2={OCHE[1][0]} y2={OCHE[1][1]} stroke={colors.textSecondary} strokeWidth={2.5} />
        <SvgText x={OCHE[0][0] - 4} y={OCHE[0][1] + 4} fontSize={11} fill={colors.textSecondary} textAnchor="end">
          {ocheLabel}
        </SvgText>
        <Line x1={centre[0]} y1={centre[1]} x2={BOARD_LEFT[0]} y2={BOARD_LEFT[1]} stroke={sightColor} strokeDasharray="3 3" />
        <Line x1={centre[0]} y1={centre[1]} x2={BOARD_RIGHT[0]} y2={BOARD_RIGHT[1]} stroke={sightColor} strokeDasharray="3 3" />
        <Ellipse cx={foot[0]} cy={foot[1]} rx={12} ry={4} fill={colors.textPrimary} opacity={0.15} />
        {legs.map((leg, index) => (
          <Line key={index} x1={top[0]} y1={top[1]} x2={leg[0]} y2={leg[1]} stroke="#6F665A" strokeWidth={1.6} />
        ))}
        <Polygon points={phone} fill={colors.textPrimary} stroke={colors.textSecondary} strokeWidth={0.8} />
      </Svg>
      <BoardEllipse kind={kind} scale={scale} cx={BOARD_CENTRE[0]} cy={BOARD_CENTRE[1]} rx={BOARD_RX} ry={BOARD_RY} />
    </View>
  );
};

const ViewScene = ({ v, scale, kind, caption }: {
  v: Record<string, number>;
  scale: number;
  kind: BoardKind;
  caption: string;
}) => (
  <View style={{ width: SCENE_W * scale, height: SCENE_H * scale }}>
    <Svg width={SCENE_W * scale} height={SCENE_H * scale} viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}>
      <Rect x={10} y={10} width={280} height={200} rx={10} fill="#7D766B" />
      <SvgText x={150} y={234} fontSize={12} fill={colors.textSecondary} textAnchor="middle">
        {caption}
      </SvgText>
    </Svg>
    {/* Seen from the side, the board is narrower than it is tall. */}
    <BoardEllipse kind={kind} scale={scale} cx={v.cx} cy={v.cy} rx={100 * v.size * 0.8} ry={100 * v.size} />
    <Svg
      style={StyleSheet.absoluteFill}
      width={SCENE_W * scale}
      height={SCENE_H * scale}
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      pointerEvents="none">
      <Rect x={62} y={23} width={174} height={174} fill="none" stroke={colors.panel} strokeOpacity={0.75} strokeDasharray="5 4" />
      <Line x1={272} y1={40} x2={272} y2={180} stroke={colors.panel} strokeOpacity={0.6} strokeWidth={3} strokeLinecap="round" />
      <Circle cx={272} cy={180 - ((v.zoom - 1) / 2) * 140} r={7} fill={colors.panel} />
      <SvgText x={262} y={32} fontSize={11} fill={colors.panel}>
        {`${v.zoom.toFixed(1)}x`}
      </SvgText>
    </Svg>
  </View>
);

const LightScene = ({ v, scale, kind }: { v: Record<string, number>; scale: number; kind: BoardKind }) => (
  <View style={{ width: SCENE_W * scale, height: SCENE_H * scale }}>
    <Svg width={SCENE_W * scale} height={SCENE_H * scale} viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}>
      <Rect x={10} y={10} width={280} height={230} rx={10} fill="#E6DCCB" />
      <Line x1={150} y1={10} x2={150} y2={30} stroke={colors.textSecondary} strokeWidth={2} />
      <Polygon points="134,44 166,44 158,30 142,30" fill={colors.textSecondary} />
      <Circle cx={150} cy={46} r={5} fill={v.lamp > 0.5 ? '#F2C14E' : '#B9AE9C'} />
      {[[138, 56, 118, 80], [150, 58, 150, 84], [162, 56, 182, 80]].map(([x1, y1, x2, y2]) => (
        <Line
          key={x1}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#E8B53E"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={v.lamp}
        />
      ))}
    </Svg>
    <BoardEllipse kind={kind} scale={scale} cx={150} cy={160} rx={66} ry={66} />
    <Svg
      style={StyleSheet.absoluteFill}
      width={SCENE_W * scale}
      height={SCENE_H * scale}
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      pointerEvents="none">
      <Ellipse cx={172} cy={128} rx={30} ry={18} fill="#FFFFFF" opacity={v.glare} />
      <Rect x={10} y={10} width={280} height={230} rx={10} fill="#120F0C" opacity={v.dark} />
    </Svg>
  </View>
);

// One step's page. Only the shown page runs its frames; the others hold their first frame.
const StepPage = React.memo(({ step, active, width, kind, onDone }: {
  step: number;
  active: boolean;
  width: number;
  kind: BoardKind;
  onDone: () => void;
}) => {
  const { t } = useTranslation();
  const frames = STEPS[step].frames;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      const time = Date.now() - start;
      if (time >= frames.length * FRAME_MS) {
        clearInterval(timer);
        onDone();
      } else {
        setElapsed(time);
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active, frames.length, onDone]);

  const index = Math.min(frames.length - 1, Math.floor(elapsed / FRAME_MS));
  const current = frames[index];
  // The first frame is already in place when the page comes in.
  const previous = index === 0 ? current : frames[index - 1];
  const progress = index === 0 ? 1 : Math.min(1, (elapsed % FRAME_MS) / MOVE_MS);
  const eased = easeInOut(progress);
  const values: Record<string, number> = {};
  Object.keys(current.values).forEach(key => {
    values[key] = previous.values[key] + (current.values[key] - previous.values[key]) * eased;
  });
  const arrived = progress >= 1;
  const scale = width / SCENE_W;

  return (
    <View style={{ width }}>
      {step === 0 ? (
        <PositionScene
          v={values}
          ok={arrived ? current.ok : null}
          scale={scale}
          kind={kind}
          ocheLabel={t('guide.position.oche')}
          midLabel={t('guide.position.midpoint')}
        />
      ) : step === 1 ? (
        <ViewScene v={values} scale={scale} kind={kind} caption={t('guide.view.caption')} />
      ) : (
        <LightScene v={values} scale={scale} kind={kind} />
      )}
      <View style={styles.pillRow}>
        <Text
          style={[
            styles.pill,
            current.ok ? styles.pillOk : styles.pillBad,
            !arrived && styles.pillMoving,
          ]}>
          {`${current.ok ? '✓' : '✕'} ${t(current.label)}`}
        </Text>
      </View>
    </View>
  );
});

// The looping animation, stepping on by itself; swiping or the dots move to a step.
const GuideAnimation = ({ width }: { width: number }) => {
  const { t } = useTranslation();
  const kind = useSettingsStore(state => state.boardKind);
  const [step, setStep] = useState(0);
  const pager = useRef<ScrollView>(null);

  const goTo = useCallback(
    (next: number) => {
      pager.current?.scrollTo({ x: next * width, animated: true });
      setStep(next);
    },
    [width],
  );
  const onDone = useCallback(() => goTo((step + 1) % STEPS.length), [goTo, step]);

  return (
    <View>
      <View style={styles.sceneHeader}>
        <Text style={styles.stepTitle}>{`${step + 1} · ${t(STEPS[step].title)}`}</Text>
        <View style={styles.dots}>
          {STEPS.map((item, i) => (
            <Pressable
              key={item.title}
              hitSlop={8}
              onPress={() => goTo(i)}
              style={[styles.dot, i === step && styles.dotActive]}
            />
          ))}
        </View>
      </View>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width }}
        onMomentumScrollEnd={event => {
          const page = Math.round(event.nativeEvent.contentOffset.x / width);
          setStep(Math.max(0, Math.min(STEPS.length - 1, page)));
        }}>
        {STEPS.map((item, i) => (
          <StepPage key={item.title} step={i} active={i === step} width={width} kind={kind} onDone={onDone} />
        ))}
      </ScrollView>
    </View>
  );
};

export const PlacementGuide = ({ visible, onClose }: PlacementGuideProps) => {
  const { t } = useTranslation();
  const [sceneWidth, setSceneWidth] = useState(0);
  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>{t('guide.title')}</Text>
            <View
              style={styles.sceneBox}
              onLayout={event => setSceneWidth(Math.floor(event.nativeEvent.layout.width) - 16)}>
              {visible && sceneWidth > 0 ? <GuideAnimation width={sceneWidth} /> : null}
            </View>
            <View style={styles.tips}>
              {TIPS.map((key, index) => (
                <View key={key} style={styles.tipRow}>
                  <Text style={styles.tipNumber}>{`${index + 1}.`}</Text>
                  <Text style={styles.tipText}>
                    <Trans i18nKey={`guide.tips.${key}`} components={{ b: <Text style={styles.bold} /> }} />
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.support}>{t('guide.support')}</Text>
            <PrimaryButton label={t('guide.gotIt')} onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    maxHeight: '92%',
    backgroundColor: colors.background,
    borderRadius: 22,
    overflow: 'hidden',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sceneBox: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 8,
  },
  board: {
    position: 'absolute',
  },
  sceneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 4,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dots: {
    flexDirection: 'row',
    gap: 10,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
  },
  pillRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Hidden while the scene moves to the next frame.
  pillMoving: {
    opacity: 0,
  },
  pillOk: {
    backgroundColor: '#E3EFE5',
    color: colors.success,
  },
  pillBad: {
    backgroundColor: '#F6E1E1',
    color: colors.danger,
  },
  tips: {
    gap: 6,
  },
  tipRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tipNumber: {
    width: 18,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  bold: {
    fontWeight: '800',
  },
  support: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    backgroundColor: colors.panelStrong,
    borderRadius: 10,
    padding: 10,
    overflow: 'hidden',
  },
});
