import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { isRealBullTrackNativeBridgeAvailable } from '../../native-bridge/bulltrack/bullTrackNative';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export const HomeScreen = ({ navigation }: Props) => (
  <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
    <SectionHeader
      eyebrow="Phase Three"
      title="BullTrack React Native Game Flow"
      description="Android 主流程已经迁移到 RN：选择模式、设置玩家、进入对局，并继续复用原生 CameraX 与 JNI/C++ 检测链。"
    />

    <Panel>
      <Text style={styles.panelTitle}>当前状态</Text>
      <Text style={styles.body}>
        {isRealBullTrackNativeBridgeAvailable
          ? '当前运行时已接入真实 Android Native bridge。真机上会走 CameraX 预览与 JNI/C++/YOLO 识别。'
          : '当前运行时没有拿到原生 bridge，会退回 mock 行为，仅用于页面结构调试。'}
      </Text>
    </Panel>

    <Panel>
      <Text style={styles.panelTitle}>第三阶段验收</Text>
      <View style={styles.list}>
        <Text style={styles.body}>1. 选择游戏模式并设置玩家。</Text>
        <Text style={styles.body}>2. 进入对局页并看到原生相机预览。</Text>
        <Text style={styles.body}>3. 开始一轮、结束/重检、确认结果并推进下一位玩家。</Text>
      </View>
    </Panel>

    <View style={styles.actionGroup}>
      <PrimaryButton
        label="开始新游戏"
        onPress={() => navigation.navigate('ModeSelect')}
      />
      <SecondaryButton
        label="查看调试图"
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
  list: {
    gap: 8,
  },
  actionGroup: {
    gap: 12,
  },
});
