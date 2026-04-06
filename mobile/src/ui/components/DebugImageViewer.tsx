import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { DebugArtifact } from '../../domain/vision/types';
import { colors } from '../theme/colors';

interface DebugImageViewerProps {
  artifact: DebugArtifact;
}

export const DebugImageViewer = ({ artifact }: DebugImageViewerProps) => (
  <View style={styles.container}>
    <Text style={styles.title}>{artifact.title}</Text>
    <Text style={styles.meta}>{artifact.kind}</Text>
    {artifact.path.startsWith('file://') ? (
      <Image source={{ uri: artifact.path }} style={styles.preview} />
    ) : null}
    <Text style={styles.path}>{artifact.path}</Text>
    {artifact.note ? <Text style={styles.note}>{artifact.note}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FBF7EF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  meta: {
    fontSize: 12,
    color: colors.accent,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  preview: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: 12,
    backgroundColor: '#E9E1D4',
  },
  path: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.info,
  },
});
