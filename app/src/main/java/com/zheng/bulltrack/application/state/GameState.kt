package com.zheng.bulltrack.application.state

enum class GameState {
    IDLE,
    MODE_SELECTED,
    WAITING_FOR_THROW,
    CAPTURING_START,
    CAPTURING_END,
    PROCESSING,
    SHOWING_RESULT,
    NEXT_ROUND,
    GAME_OVER
}
