import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLiveFrameStore } from '../../application/stores/liveFrameStore';

const FADE_IN_MS = 150;

// Shows the most recent frame the native round captured (about 3 per second).
// Double-buffered: a new frame loads invisibly on top of the current one and
// fades in after it has loaded, so the view never flashes black between frames.
export const LiveSnapshot = () => {
  const { t } = useTranslation();
  const uri = useLiveFrameStore(state => state.uri);
  const [shown, setShown] = useState<string | null>(null);
  const pendingOpacity = useRef(new Animated.Value(0)).current;
  const pendingStyle = useMemo(() => [styles.image, { opacity: pendingOpacity }], [pendingOpacity]);

  useEffect(() => {
    if (uri === null) {
      setShown(null);
    }
    pendingOpacity.setValue(0);
  }, [pendingOpacity, uri]);

  const pending = uri !== null && uri !== shown ? uri : null;

  return (
    <View style={styles.container}>
      {shown === null && pending === null ? (
        <Text style={styles.placeholder}>{t('game.capturing')}</Text>
      ) : null}
      {/* Same element type and key per frame, so the faded-in layer is reused, not reloaded. */}
      {[shown, pending].map(frameUri =>
        frameUri === null ? null : (
          <Animated.Image
            key={frameUri}
            source={{ uri: frameUri }}
            style={frameUri === pending ? pendingStyle : styles.image}
            resizeMode="cover"
            fadeDuration={0}
            onLoad={
              frameUri === pending
                ? () => {
                    Animated.timing(pendingOpacity, {
                      toValue: 1,
                      duration: FADE_IN_MS,
                      useNativeDriver: true,
                    }).start(({ finished }) => {
                      if (finished) {
                        setShown(frameUri);
                      }
                    });
                  }
                : undefined
            }
          />
        ),
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    fontSize: 13,
    color: '#D7DBE2',
  },
});
