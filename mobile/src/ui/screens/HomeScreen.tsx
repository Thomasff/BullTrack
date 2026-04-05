import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export const HomeScreen = ({ navigation }: Props) => (
  <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
    <SectionHeader
      eyebrow="Phase One"
      title="BullTrack React Native Shell"
      description="Android-first migration shell is ready. This stage focuses on navigation, state, and mock bridge boundaries."
    />

    <Panel>
      <Text style={styles.panelTitle}>Current status</Text>
      <Text style={styles.body}>
        Existing Kotlin, JNI and C++ vision code remains untouched in the original Android app.
        The React Native layer currently provides the shell that future Native bridge work will
        plug into.
      </Text>
    </Panel>

    <View style={styles.actionGroup}>
      <PrimaryButton
        label="Open Game Shell"
        onPress={() => navigation.navigate('Game')}
      />
      <SecondaryButton
        label="Open Debug Shell"
        onPress={() => navigation.navigate('Debug')}
      />
    </View>
  </ScrollView>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  actionGroup: {
    gap: 12,
  },
});
