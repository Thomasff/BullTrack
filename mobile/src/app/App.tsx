import React, { useEffect } from 'react';
import '../i18n';
import { useSettingsStore } from '../application/stores/settingsStore';
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

const App = () => {
  const settingsLoaded = useSettingsStore(state => state.loaded);
  useEffect(() => {
    useSettingsStore.getState().loadSettings().catch(() => undefined);
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.panel} />
      {/* Settings carry the chosen language, so screens wait for them instead of redrawing. */}
      {settingsLoaded ? (
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator />
        </NavigationContainer>
      ) : null}
    </SafeAreaProvider>
  );
};

export default App;
