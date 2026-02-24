package com.zheng.bulltrack.ui.navigation

sealed class Screen(val route: String) {
    object Home : Screen("home")
    object ModeSelect : Screen("mode_select")
    object PlayerSetup : Screen("player_setup/{gameType}") {
        fun createRoute(gameType: String) = "player_setup/$gameType"
    }
    object Game : Screen("game/{gameType}/{playerCount}") {
        fun createRoute(gameType: String, playerCount: Int) = "game/$gameType/$playerCount"
    }
    object GameOver : Screen("game_over")
}
