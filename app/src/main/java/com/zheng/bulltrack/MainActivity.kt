package com.zheng.bulltrack

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.ui.navigation.Screen
import com.zheng.bulltrack.ui.screens.GameScreen
import com.zheng.bulltrack.ui.screens.HomeScreen
import com.zheng.bulltrack.ui.screens.ModeSelectScreen
import com.zheng.bulltrack.ui.screens.PlayerSetupScreen
import com.zheng.bulltrack.ui.theme.BullTrackTheme
import com.zheng.bulltrack.ui.viewmodel.GameViewModel
import com.zheng.bulltrack.ui.viewmodel.ViewModelFactory

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            BullTrackTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    BullTrackApp()
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
fun BullTrackApp() {
    val navController = rememberNavController()
    val context = androidx.compose.ui.platform.LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val viewModel: GameViewModel = viewModel { ViewModelFactory.createGameViewModel(context) }
    val uiState by viewModel.uiState.collectAsState()

    NavHost(
        navController = navController,
        startDestination = Screen.Home.route
    ) {
        composable(Screen.Home.route) {
            HomeScreen(
                onStartGame = {
                    navController.navigate(Screen.ModeSelect.route)
                }
            )
        }

        composable(Screen.ModeSelect.route) {
            ModeSelectScreen(
                onModeSelected = { gameType ->
                    viewModel.selectGameMode(gameType)
                    navController.navigate(Screen.PlayerSetup.createRoute(gameType.name))
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = Screen.PlayerSetup.route,
            arguments = listOf(
                navArgument("gameType") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val gameTypeArg = backStackEntry.arguments?.getString("gameType")
            val gameType = try {
                GameType.valueOf(gameTypeArg ?: "HIGH_SCORE")
            } catch (_: Exception) {
                GameType.HIGH_SCORE
            }

            PlayerSetupScreen(
                gameType = gameType,
                onStartGame = { playerNames ->
                    viewModel.setPlayers(playerNames)
                    navController.navigate(Screen.Game.route)
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(Screen.Game.route) {
            GameScreen(
                uiState = uiState,
                onScreenOpened = { viewModel.warmUpDetectorOnGameScreenOpened() },
                onStartRound = {
                    viewModel.startRound()
                },
                onEndRound = {
                    viewModel.endRound()
                },
                onConfirmResult = {
                    viewModel.confirmResult()
                },
                onRedetect = {
                    viewModel.redetectRound()
                },
                onManualAdjustPosition = { index, position ->
                    viewModel.updatePendingThrowPosition(index, position)
                },
                onCameraPermissionChanged = { granted ->
                    viewModel.setCameraPermissionGranted(granted)
                },
                onBindPreview = { previewView ->
                    viewModel.bindPreview(previewView, lifecycleOwner)
                },
                onUnbindPreview = {
                    viewModel.unbindPreview()
                },
                onZoomRatioChanged = { zoomRatio ->
                    viewModel.updateZoomRatio(zoomRatio)
                },
                onReset = {
                    viewModel.resetGame()
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                }
            )
        }
    }
}

