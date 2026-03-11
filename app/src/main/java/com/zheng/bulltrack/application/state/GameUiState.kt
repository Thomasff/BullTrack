package com.zheng.bulltrack.application.state

import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ScoreBoard
import com.zheng.bulltrack.domain.model.ThrowResult

data class GameUiState(
    val currentState: GameState = GameState.IDLE,
    val gameType: GameType? = null,
    val players: List<Player> = emptyList(),
    val currentPlayer: Player? = null,
    val scoreBoard: ScoreBoard? = null,
    val currentRoundResult: RoundResult? = null,
    val currentThrows: List<ThrowResult> = emptyList(),
    val winner: Player? = null,
    val errorMessage: String? = null,
    val statusMessage: String? = null,
    val roundNumber: Int = 0,
    val throwNumber: Int = 0,
    val detectedDartCount: Int = 0,
    val maxDartsPerRound: Int = 3,
    val isRoundActive: Boolean = false,
    val canRedetect: Boolean = false
)
