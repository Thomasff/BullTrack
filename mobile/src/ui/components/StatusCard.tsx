import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

interface StatusCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'info' | 'success' | 'warning' | 'danger';
}

const toneMap = {
  default: colors.textPrimary,
  info: colors.info,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
} as const;

export const StatusCard = ({
  label,
  value,
  tone = 'default',
}: StatusCardProps) => (
  <View style={styles.card}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, { color: toneMap[tone] }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#F9F5EC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  value: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
});
