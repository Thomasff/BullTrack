import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
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
import {
  getModeCategory,
  getModeCategoryTitle,
  getModeOption,
  getModeOptionTitle,
} from '../../domain/game/modeCatalog';
import type { ModeOptionId } from '../../domain/game/modeCatalog';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Header ⓘ buttons that open the rules of the mode being set up or played.
const renderOptionRules = (modeOptionId: ModeOptionId) => () => {
  const option = getModeOption(modeOptionId);
  return option ? (
    <ModeRulesButton gameType={option.runtimeGameType} title={getModeOptionTitle(option)} />
  ) : null;
};

const modeOptionTitle = (modeOptionId: ModeOptionId) => {
  const option = getModeOption(modeOptionId);
  return option ? getModeOptionTitle(option) : null;
};

const renderCurrentModeRules = () => <CurrentModeRulesButton />;

const renderMatchShare = (matchId: number) => () => <MatchShareHeaderButton matchId={matchId} />;

// Uses the translation hook so header titles follow a language switch.
export const RootNavigator = () => {
  const { t } = useTranslation();
  return (
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
          title: getModeCategory(route.params.categoryId)
            ? getModeCategoryTitle(route.params.categoryId)
            : t('setup.screens.chooseMode'),
        })}
      />
      <Stack.Screen
        name="PlayerSetup"
        component={PlayerSetupScreen}
        options={({ route }) => ({
          title: modeOptionTitle(route.params.modeOptionId) ?? t('setup.screens.playerSetup'),
          headerRight: renderOptionRules(route.params.modeOptionId),
        })}
      />
      <Stack.Screen
        name="Game"
        component={GameScreen}
        options={{ title: t('setup.screens.game'), headerRight: renderCurrentModeRules }}
      />
      <Stack.Screen
        name="Debug"
        component={DebugScreen}
        options={{ title: t('setup.screens.debug') }}
      />
      <Stack.Screen
        name="MatchDetail"
        component={MatchDetailScreen}
        options={({ route }) => ({
          title: t('setup.screens.matchDetail'),
          headerRight: renderMatchShare(route.params.matchId),
        })}
      />
      <Stack.Screen
        name="PlayerDetail"
        component={PlayerDetailScreen}
        options={{ title: t('setup.screens.playerStats') }}
      />
      <Stack.Screen
        name="HeadToHead"
        component={HeadToHeadScreen}
        options={{ title: t('setup.screens.headToHead') }}
      />
      <Stack.Screen
        name="MatchList"
        component={MatchListScreen}
        options={{ title: t('setup.screens.allMatches') }}
      />
      <Stack.Screen
        name="SharePreview"
        component={SharePreviewScreen}
        options={{ title: t('setup.screens.share') }}
      />
    </Stack.Navigator>
  );
};
