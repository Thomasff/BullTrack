import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
}

export const PrimaryButton = ({ label, onPress }: PrimaryButtonProps) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <Text style={styles.label}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.9,
  },
  label: {
    color: '#FFF9F1',
    fontSize: 16,
    fontWeight: '700',
  },
});
