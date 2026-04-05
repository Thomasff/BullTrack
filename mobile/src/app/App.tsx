import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation/RootNavigator';
import { colors } from '../ui/theme/colors';

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.panel,
    text: colors.textPrimary,
    primary: colors.accent,
    border: colors.border,
  },
};

const App = () => (
  <SafeAreaProvider>
    <StatusBar barStyle="dark-content" backgroundColor={colors.panel} />
    <NavigationContainer theme={navigationTheme}>
      <RootNavigator />
    </NavigationContainer>
  </SafeAreaProvider>
);

export default App;
