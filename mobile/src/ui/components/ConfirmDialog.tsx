import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  // Omit for a single-button notice.
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// App-styled replacement for the system Alert dialog.
export const ConfirmDialog = ({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => (
  <Modal
    transparent
    statusBarTranslucent
    animationType="fade"
    visible={visible}
    onRequestClose={onCancel}>
    <Pressable style={styles.backdrop} onPress={onCancel}>
      <Pressable style={styles.card} onPress={() => undefined}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.actions}>
          {cancelLabel ? (
            <View style={styles.action}>
              <SecondaryButton label={cancelLabel} onPress={onCancel} />
            </View>
          ) : null}
          <View style={styles.action}>
            <PrimaryButton label={confirmLabel} onPress={onConfirm} danger={danger} />
          </View>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 12, 0.45)',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 22,
    padding: 22,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  action: {
    flex: 1,
  },
});
