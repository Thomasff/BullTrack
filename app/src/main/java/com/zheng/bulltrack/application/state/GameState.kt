package com.zheng.bulltrack.application.state

enum class GameState {
    IDLE,
    MODE_SELECTED,
    WAITING_FOR_THROW,
    ROUND_IN_PROGRESS,
    PROCESSING,
    SHOWING_RESULT,
    GAME_OVER
}
