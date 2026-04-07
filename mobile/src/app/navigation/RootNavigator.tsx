import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../../ui/screens/HomeScreen';
import { ModeSelectScreen } from '../../ui/screens/ModeSelectScreen';
import { PlayerSetupScreen } from '../../ui/screens/PlayerSetupScreen';
import { GameScreen } from '../../ui/screens/GameScreen';
import { DebugScreen } from '../../ui/screens/DebugScreen';
import { colors } from '../../ui/theme/colors';
import type { RootStackParamList } from './types';

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
      options={{ title: 'BullTrack Mobile' }}
    />
    <Stack.Screen
      name="ModeSelect"
      component={ModeSelectScreen}
      options={{ title: '选择模式' }}
    />
    <Stack.Screen
      name="PlayerSetup"
      component={PlayerSetupScreen}
      options={{ title: '玩家设置' }}
    />
    <Stack.Screen name="Game" component={GameScreen} options={{ title: '对局' }} />
    <Stack.Screen name="Debug" component={DebugScreen} options={{ title: '调试图' }} />
  </Stack.Navigator>
);
