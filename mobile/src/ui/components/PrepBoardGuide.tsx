import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';
import { bullTrackNativeBridge } from '../../native-bridge/bulltrack/bullTrackNative';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { colors } from '../theme/colors';
import {
  CENTRE_HALF_SIZE,
  FAST_INTERVAL_MS,
  INITIAL_PREP_GUIDE_STATE,
  previewGuide,
  stepPrepGuide,
  toPrepBoard,
  type GuideHint,
  type PrepBoard,
} from '../../domain/vision/boardGuide';

export interface PrepGuideView {
  board: PrepBoard | null;
  hint: GuideHint;
}

// Checks where the board is while the player gets ready (a still of the whole frame through the
// model, about 0.2-0.4 s), zooms it to size and reports it for the overlay. Runs only while
// active; the next check waits for the previous one.
export const usePrepBoardGuide = ({
  active,
  zoomMin,
  zoomMax,
  autoZoomPaused,
  getZoom,
  zoomTo,
}: {
  active: boolean;
  zoomMin: number;
  zoomMax: number;
  autoZoomPaused: boolean;
  getZoom: () => number;
  zoomTo: (zoomRatio: number) => void;
}): PrepGuideView | null => {
  const [view, setView] = useState<PrepGuideView | null>(null);
  // Read on every check without restarting the loop.
  const latestRef = useRef({ autoZoomPaused, getZoom, zoomTo });
  latestRef.current = { autoZoomPaused, getZoom, zoomTo };

  useEffect(() => {
    if (!active) {
      setView(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let state = INITIAL_PREP_GUIDE_STATE;
    const check = async () => {
      const startedAt = Date.now();
      let delayMs = FAST_INTERVAL_MS;
      try {
        const detection = await bullTrackNativeBridge.detectPrepBoard(
          useSettingsStore.getState().yoloOnCpu,
        );
        const latest = latestRef.current;
        const zoomNow = latest.getZoom();
        // A still taken before the zoom last changed no longer matches the preview.
        if (
          !cancelled &&
          detection.available &&
          Math.abs((detection.zoomRatio ?? zoomNow) - zoomNow) < 0.01
        ) {
          const step = stepPrepGuide(
            state,
            detection,
            zoomNow,
            zoomMin,
            zoomMax,
            latest.autoZoomPaused,
          );
          state = step.state;
          delayMs = step.delayMs;
          setView({ board: toPrepBoard(detection), hint: step.hint });
          if (step.zoomTo !== null) {
            latest.zoomTo(step.zoomTo);
          }
        }
      } catch {
        // Try again on the next check; the round start reports camera problems.
      }
      if (!cancelled) {
        timer = setTimeout(check, Math.max(200, delayMs - (Date.now() - startedAt)));
      }
    };
    check();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [active, zoomMax, zoomMin]);

  return view;
};

const ARROW_LENGTH = 52;
const ARROW_HEIGHT = 32;
const ARROW_TRAVEL = 26;
// A hollow arrow outlined with a dashed line: shaft, then a head as tall as the arrow.
const ARROW_HEAD = 20;
const ARROW_SHAFT_HALF = 6;
const ARROW_DASH = 6;
const ARROW_GAP = 4;
// The outline starts halfway up the back edge, so the path's two ends meet inside a dash.
const ARROW_CORNERS = (() => {
  const mid = ARROW_HEIGHT / 2;
  const neck = ARROW_LENGTH - ARROW_HEAD;
  return [
    [3, mid],
    [3, mid - ARROW_SHAFT_HALF],
    [neck, mid - ARROW_SHAFT_HALF],
    [neck, 3],
    [ARROW_LENGTH - 3, mid],
    [neck, ARROW_HEIGHT - 3],
    [neck, mid + ARROW_SHAFT_HALF],
    [3, mid + ARROW_SHAFT_HALF],
    [3, mid],
  ];
})();
const ARROW_PATH = ARROW_CORNERS.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
// Dashes stretched per edge so every edge starts and ends with a dash; the dashes meet at the
// corners, so the outline stays closed there (the head's tip included).
const ARROW_DASH_ARRAY = (() => {
  const lengths: number[] = [];
  let dash = 0;
  for (let i = 1; i < ARROW_CORNERS.length; i += 1) {
    const [x0, y0] = ARROW_CORNERS[i - 1];
    const [x1, y1] = ARROW_CORNERS[i];
    const edge = Math.hypot(x1 - x0, y1 - y0);
    const gaps = Math.max(0, Math.round((edge - ARROW_DASH) / (ARROW_DASH + ARROW_GAP)));
    const edgeDash = edge / (gaps + 1 + (gaps * ARROW_GAP) / ARROW_DASH);
    for (let k = 0; k < gaps; k += 1) {
      lengths.push(dash + edgeDash, (edgeDash * ARROW_GAP) / ARROW_DASH);
      dash = 0;
    }
    dash += edgeDash;
  }
  lengths.push(dash, ARROW_GAP);
  return lengths.map(length => length.toFixed(2)).join(' ');
})();
// The arrow starts this far inside the preview when the bull is off it.
const EDGE_INSET = 24;
// A dart left in the board: a ring on its tip and a wider one spreading out from it.
const DART_RING_SIZE = 14;
const DART_PULSE_SIZE = 30;
const DART_RING_WIDTH = 1.5;

// The target region in the middle of the square preview, and an arrow sliding from the bull
// (the board box centre) towards it. The region turns green once the bull is inside. Darts
// still in the board are marked where their tips are.
export const PrepBoardGuideOverlay = ({
  size,
  view,
}: {
  size: number;
  view: PrepGuideView | null;
}) => {
  const { t } = useTranslation();
  const progress = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const guide = view?.board ? previewGuide(view.board, size) : null;
  const showArrow = guide !== null && !guide.centred;
  const showDarts = (guide?.dartTips.length ?? 0) > 0;

  useEffect(() => {
    if (!showDarts) {
      return;
    }
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, showDarts]);

  useEffect(() => {
    if (!showArrow) {
      return;
    }
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, showArrow]);

  if (!view || size <= 0) {
    return null;
  }
  const regionSide = CENTRE_HALF_SIZE * 2 * size;
  const start = guide
    ? {
        x: Math.min(size - EDGE_INSET, Math.max(EDGE_INSET, guide.bull.x)),
        y: Math.min(size - EDGE_INSET, Math.max(EDGE_INSET, guide.bull.y)),
      }
    : null;
  const angle = start ? Math.atan2(size / 2 - start.y, size / 2 - start.x) : 0;
  const box = ARROW_LENGTH + ARROW_TRAVEL;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.region,
          {
            left: (size - regionSide) / 2,
            top: (size - regionSide) / 2,
            width: regionSide,
            height: regionSide,
          },
          guide?.centred && styles.regionCentred,
        ]}
      />
      {showArrow && start ? (
        // Centred on the bull and turned towards the region; the arrow slides out along it.
        <View
          style={[
            styles.arrowTurn,
            {
              left: start.x - box,
              top: start.y - box,
              width: box * 2,
              height: box * 2,
              transform: [{ rotate: `${angle}rad` }],
            },
          ]}>
          <Animated.View
            style={{
              ...styles.arrow,
              left: box,
              top: box - ARROW_HEIGHT / 2,
              opacity: progress.interpolate({
                inputRange: [0, 0.2, 0.75, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, ARROW_TRAVEL],
                  }),
                },
              ],
            }}>
            <Svg width={ARROW_LENGTH} height={ARROW_HEIGHT}>
              <Path
                d={ARROW_PATH}
                stroke={colors.accent}
                strokeWidth={3}
                strokeDasharray={ARROW_DASH_ARRAY}
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Animated.View>
        </View>
      ) : null}
      {guide?.dartTips.map((tip, index) => (
        <View
          key={index}
          style={[
            styles.dartMark,
            {
              left: tip.x - DART_PULSE_SIZE / 2,
              top: tip.y - DART_PULSE_SIZE / 2,
            },
          ]}>
          <Animated.View
            style={[
              styles.dartPulse,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [DART_RING_SIZE / DART_PULSE_SIZE, 1],
                    }),
                  },
                ],
              },
            ]}
          />
          <View style={styles.dartRing} />
        </View>
      ))}
      {view.hint ? (
        <View style={styles.hintBadge}>
          <Text style={styles.hintText}>{t(`game.guide.${view.hint}`)}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  region: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 10,
    borderColor: 'rgba(255, 255, 255, 0.75)',
  },
  arrowTurn: {
    position: 'absolute',
  },
  arrow: {
    position: 'absolute',
  },
  regionCentred: {
    borderStyle: 'solid',
    borderColor: '#4ADE80',
  },
  dartMark: {
    position: 'absolute',
    width: DART_PULSE_SIZE,
    height: DART_PULSE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dartPulse: {
    position: 'absolute',
    width: DART_PULSE_SIZE,
    height: DART_PULSE_SIZE,
    borderRadius: DART_PULSE_SIZE / 2,
    borderWidth: DART_RING_WIDTH,
    borderColor: colors.accent,
  },
  dartRing: {
    width: DART_RING_SIZE,
    height: DART_RING_SIZE,
    borderRadius: DART_RING_SIZE / 2,
    borderWidth: DART_RING_WIDTH,
    borderColor: colors.accent,
    backgroundColor: 'rgba(200, 40, 46, 0.2)',
  },
  hintBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    maxWidth: '70%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(12, 16, 24, 0.82)',
  },
  hintText: {
    color: '#F7F8FA',
    fontSize: 12,
    fontWeight: '800',
  },
});
