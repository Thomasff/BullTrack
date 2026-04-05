import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../../ui/screens/HomeScreen';
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
      name="Game"
      component={GameScreen}
      options={{ title: 'Game Shell' }}
    />
    <Stack.Screen
      name="Debug"
      component={DebugScreen}
      options={{ title: 'Debug Shell' }}
    />
  </Stack.Navigator>
);
