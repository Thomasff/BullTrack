import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme/colors';

export interface ModePickerOption {
  // null is the overview.
  key: string | null;
  label: string;
  // Shown on the right of the dropdown row, e.g. the match count.
  detail?: string;
}

const BAR_HEIGHT = 40;
const FADE_WIDTH = 40;
const MENU_MAX_HEIGHT = 360;

// Joined segments that scroll sideways, fading into a dropdown button on the right.
export const ModeBar = ({
  options,
  selectedKey,
  menuOpen,
  onSelect,
  onToggleMenu,
}: {
  options: ModePickerOption[];
  selectedKey: string | null;
  menuOpen: boolean;
  onSelect: (key: string | null) => void;
  onToggleMenu: () => void;
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const segmentX = useRef(new Map<string, number>());
  const [scroll, setScroll] = useState({ x: 0, width: 0, content: 0 });
  const fadeVisible = scroll.content - scroll.x - scroll.width > 1;

  // Keeps the selected segment in view, e.g. after picking it from the dropdown.
  useEffect(() => {
    const x = segmentX.current.get(selectedKey ?? '');
    if (x !== undefined) {
      scrollRef.current?.scrollTo({ x: Math.max(0, x - FADE_WIDTH), animated: true });
    }
  }, [selectedKey]);

  return (
    <View style={styles.bar}>
      <View style={styles.segmentsArea}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={event => {
            const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
            setScroll({
              x: contentOffset.x,
              width: layoutMeasurement.width,
              content: contentSize.width,
            });
          }}
          onLayout={event => {
            const width = event.nativeEvent.layout.width;
            setScroll(current => ({ ...current, width }));
          }}
          onContentSizeChange={content => setScroll(current => ({ ...current, content }))}>
          {options.map((option, index) => {
            const active = option.key === selectedKey;
            return (
              <Pressable
                key={option.key ?? 'overview'}
                onLayout={event => segmentX.current.set(option.key ?? '', event.nativeEvent.layout.x)}
                onPress={() => onSelect(option.key)}
                style={({ pressed }) => [
                  styles.segment,
                  index > 0 && styles.segmentDivider,
                  active && styles.segmentActive,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {fadeVisible ? (
          <Svg pointerEvents="none" width={FADE_WIDTH} height={BAR_HEIGHT} style={styles.fade}>
            <Defs>
              <LinearGradient id="modeBarFade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.panelStrong} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.panelStrong} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect width={FADE_WIDTH} height={BAR_HEIGHT} fill="url(#modeBarFade)" />
          </Svg>
        ) : null}
      </View>
      <Pressable
        hitSlop={4}
        onPress={onToggleMenu}
        style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Path
            d={menuOpen ? 'M2 9.5 L7 4.5 L12 9.5' : 'M2 4.5 L7 9.5 L12 4.5'}
            stroke={colors.textPrimary}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
};

// Every option, one per row, over the page below the bar. Rendered as the last child of the
// scroll content: the backdrop covers the content, so a tap anywhere else closes it.
export const ModeMenu = ({
  options,
  selectedKey,
  top,
  onSelect,
  onClose,
}: {
  options: ModePickerOption[];
  selectedKey: string | null;
  top: number;
  onSelect: (key: string | null) => void;
  onClose: () => void;
}) => (
  <>
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
    <View style={[styles.menu, { top }]}>
      <ScrollView nestedScrollEnabled style={styles.menuScroll}>
        {options.map((option, index) => {
          const active = option.key === selectedKey;
          return (
            <Pressable
              key={option.key ?? 'overview'}
              onPress={() => onSelect(option.key)}
              style={({ pressed }) => [
                styles.menuRow,
                index > 0 && styles.menuDivider,
                active && styles.menuRowActive,
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.menuLabel, active && styles.menuLabelActive]}>
                {option.label}
              </Text>
              {option.detail ? <Text style={styles.menuDetail}>{option.detail}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  </>
);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    overflow: 'hidden',
  },
  segmentsArea: {
    flex: 1,
  },
  segment: {
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  segmentDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.accent,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  segmentLabelActive: {
    color: colors.panel,
  },
  fade: {
    position: 'absolute',
    right: 0,
    top: 0,
  },
  menuButton: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panelStrong,
  },
  pressed: {
    opacity: 0.7,
  },
  menu: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: colors.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 6,
    overflow: 'hidden',
  },
  menuScroll: {
    maxHeight: MENU_MAX_HEIGHT,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  menuRowActive: {
    backgroundColor: colors.panelStrong,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  menuLabelActive: {
    fontWeight: '800',
    color: colors.accent,
  },
  menuDetail: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
