import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../../ui/screens/HomeScreen';
import { ModeSelectScreen } from '../../ui/screens/ModeSelectScreen';
import { PlayerSetupScreen } from '../../ui/screens/PlayerSetupScreen';
import { GameScreen } from '../../ui/screens/GameScreen';
import { DebugScreen } from '../../ui/screens/DebugScreen';
import { MatchDetailScreen } from '../../ui/screens/MatchDetailScreen';
import { PlayerDetailScreen } from '../../ui/screens/PlayerDetailScreen';
import { HeadToHeadScreen } from '../../ui/screens/HeadToHeadScreen';
import { MatchListScreen } from '../../ui/screens/MatchListScreen';
import { SharePreviewScreen } from '../../ui/screens/SharePreviewScreen';
import { CurrentModeRulesButton, ModeRulesButton } from '../../ui/components/ModeRulesButton';
import { MatchShareHeaderButton } from '../../ui/components/ShareButton';
import { colors } from '../../ui/theme/colors';
import type { RootStackParamList } from './types';
import { getModeCategory, getModeOption } from '../../domain/game/modeCatalog';
import type { ModeOptionId } from '../../domain/game/modeCatalog';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Header ⓘ buttons that open the rules of the mode being set up or played.
const renderOptionRules = (modeOptionId: ModeOptionId) => () => {
  const option = getModeOption(modeOptionId);
  return option ? <ModeRulesButton gameType={option.runtimeGameType} title={option.title} /> : null;
};

const renderCurrentModeRules = () => <CurrentModeRulesButton />;

const renderMatchShare = (matchId: number) => () => <MatchShareHeaderButton matchId={matchId} />;

export const RootNavigator = () => (
  <Stack.Navigator
    initialRouteName="Home"
    screenOptions={{
      headerStyle: { backgroundColor: colors.panel },
      headerTintColor: colors.textPrimary,
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.background },
      headerTitleStyle: {
        fontWeight: '700',
      },
    }}>
    <Stack.Screen
      name="Home"
      component={HomeScreen}
      options={{ title: 'BullTrack', headerShown: false }}
    />
    <Stack.Screen
      name="ModeSelect"
      component={ModeSelectScreen}
      options={({ route }) => ({
        title: getModeCategory(route.params.categoryId)?.title ?? '选择模式',
      })}
    />
    <Stack.Screen
      name="PlayerSetup"
      component={PlayerSetupScreen}
      options={({ route }) => ({
        title: getModeOption(route.params.modeOptionId)?.title ?? '信息设置',
        headerRight: renderOptionRules(route.params.modeOptionId),
      })}
    />
    <Stack.Screen
      name="Game"
      component={GameScreen}
      options={{ title: '对局', headerRight: renderCurrentModeRules }}
    />
    <Stack.Screen name="Debug" component={DebugScreen} options={{ title: '调试图' }} />
    <Stack.Screen
      name="MatchDetail"
      component={MatchDetailScreen}
      options={({ route }) => ({
        title: '比赛详情',
        headerRight: renderMatchShare(route.params.matchId),
      })}
    />
    <Stack.Screen
      name="PlayerDetail"
      component={PlayerDetailScreen}
      options={{ title: '玩家统计' }}
    />
    <Stack.Screen name="HeadToHead" component={HeadToHeadScreen} options={{ title: '对战' }} />
    <Stack.Screen name="MatchList" component={MatchListScreen} options={{ title: '全部比赛' }} />
    <Stack.Screen name="SharePreview" component={SharePreviewScreen} options={{ title: '分享' }} />
  </Stack.Navigator>
);
