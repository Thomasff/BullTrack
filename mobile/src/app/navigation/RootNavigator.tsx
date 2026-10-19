import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../../ui/screens/HomeScreen';
import { ModeSelectScreen } from '../../ui/screens/ModeSelectScreen';
import { PlayerSetupScreen } from '../../ui/screens/PlayerSetupScreen';
import { GameScreen } from '../../ui/screens/GameScreen';
import { DebugScreen } from '../../ui/screens/DebugScreen';
import { MatchDetailScreen } from '../../ui/screens/MatchDetailScreen';
import { colors } from '../../ui/theme/colors';
import type { RootStackParamList } from './types';
import { getModeCategory, getModeOption } from '../../domain/game/modeCatalog';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
      })}
    />
    <Stack.Screen name="Game" component={GameScreen} options={{ title: '对局' }} />
    <Stack.Screen name="Debug" component={DebugScreen} options={{ title: '调试图' }} />
    <Stack.Screen
      name="MatchDetail"
      component={MatchDetailScreen}
      options={{ title: '比赛详情' }}
    />
  </Stack.Navigator>
);
