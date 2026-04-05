import React, { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';

export const Panel = ({ children }: PropsWithChildren) => (
  <View style={styles.panel}>{children}</View>
);

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
});
