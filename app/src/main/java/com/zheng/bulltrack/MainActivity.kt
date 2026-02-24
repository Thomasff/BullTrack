package com.zheng.bulltrack

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.ui.navigation.Screen
import com.zheng.bulltrack.ui.screens.*
import com.zheng.bulltrack.ui.theme.BullTrackTheme
import com.zheng.bulltrack.ui.viewmodel.GameViewModel
import com.zheng.bulltrack.ui.viewmodel.ViewModelFactory

class MainActivity : ComponentActivity() {
    
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (!isGranted) {
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        if (!hasCameraPermission()) {
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
        
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
    
    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }
}

@Composable
fun BullTrackApp() {
    val navController = rememberNavController()
    val viewModel: GameViewModel = viewModel { ViewModelFactory.createGameViewModel() }
    val uiState by viewModel.uiState.collectAsState()
    
    var selectedGameType by remember { mutableStateOf<GameType?>(null) }
    
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
                    selectedGameType = gameType
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
            } catch (e: Exception) {
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
                onCaptureBefore = {
                },
                onCaptureAfter = {
                },
                onConfirmResult = {
                    viewModel.confirmResult()
                },
                onManualAdjust = { index, sector, ring ->
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
