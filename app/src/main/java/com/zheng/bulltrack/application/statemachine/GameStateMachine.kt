package com.zheng.bulltrack.application.statemachine

import com.zheng.bulltrack.application.state.GameState
import com.zheng.bulltrack.application.state.GameUiState
import com.zheng.bulltrack.domain.gamemode.GameMode
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ThrowResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class GameStateMachine {

    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()

    private var gameMode: GameMode? = null

    fun selectMode(gameType: GameType) {
        updateState {
            it.copy(
                currentState = GameState.MODE_SELECTED,
                gameType = gameType
            )
        }
    }

    fun setPlayers(players: List<Player>) {
        updateState {
            it.copy(
                players = players,
                currentPlayer = players.firstOrNull()
            )
        }
    }

    fun startGame(gameMode: GameMode) {
        this.gameMode = gameMode
        updateState {
            it.copy(
                currentState = GameState.WAITING_FOR_THROW,
                currentPlayer = gameMode.getCurrentPlayer(),
                scoreBoard = gameMode.getScoreBoard(),
                roundNumber = 1,
                throwNumber = 0,
                detectedDartCount = 0,
                currentThrows = emptyList(),
                currentRoundResult = null,
                errorMessage = null,
                statusMessage = "准备开始新一轮",
                isRoundActive = false,
                canRedetect = false
            )
        }
    }

    fun startRound(statusMessage: String) {
        updateState {
            it.copy(
                currentState = GameState.ROUND_IN_PROGRESS,
                currentThrows = emptyList(),
                currentRoundResult = null,
                errorMessage = null,
                statusMessage = statusMessage,
                detectedDartCount = 0,
                isRoundActive = true,
                canRedetect = false
            )
        }
    }

    fun updateRoundProgress(throws: List<ThrowResult>, statusMessage: String) {
        updateState {
            it.copy(
                currentState = GameState.ROUND_IN_PROGRESS,
                currentThrows = throws,
                statusMessage = statusMessage,
                detectedDartCount = throws.size,
                throwNumber = throws.size,
                isRoundActive = true,
                canRedetect = false
            )
        }
    }

    fun beginProcessing(statusMessage: String) {
        updateState {
            it.copy(
                currentState = GameState.PROCESSING,
                statusMessage = statusMessage
            )
        }
    }

    fun showDetectedResult(throws: List<ThrowResult>, statusMessage: String, canRedetect: Boolean = true) {
        updateState {
            it.copy(
                currentState = GameState.SHOWING_RESULT,
                currentThrows = throws,
                currentRoundResult = null,
                statusMessage = statusMessage,
                detectedDartCount = throws.count { throwResult -> throwResult.score > 0 || throwResult.ring != com.zheng.bulltrack.domain.model.RingType.MISS },
                throwNumber = throws.size,
                isRoundActive = false,
                canRedetect = canRedetect
            )
        }
    }

    fun updateShowingThrows(throws: List<ThrowResult>) {
        if (_uiState.value.currentState != GameState.SHOWING_RESULT) return
        updateState {
            it.copy(
                currentThrows = throws,
                detectedDartCount = throws.count { throwResult -> throwResult.score > 0 || throwResult.ring != com.zheng.bulltrack.domain.model.RingType.MISS },
                throwNumber = throws.size
            )
        }
    }

    fun applyRoundResult(result: RoundResult) {
        gameMode?.let { mode ->
            updateState {
                it.copy(
                    currentState = GameState.SHOWING_RESULT,
                    currentRoundResult = result,
                    scoreBoard = mode.getScoreBoard(),
                    statusMessage = "本轮结果已确认",
                    isRoundActive = false,
                    canRedetect = false
                )
            }
        }
    }

    fun confirmResult() {
        gameMode?.let { mode ->
            if (mode.isGameOver()) {
                updateState {
                    it.copy(
                        currentState = GameState.GAME_OVER,
                        winner = mode.getWinner(),
                        statusMessage = "比赛结束",
                        isRoundActive = false,
                        canRedetect = false
                    )
                }
            } else {
                updateState {
                    it.copy(
                        currentState = GameState.WAITING_FOR_THROW,
                        currentPlayer = mode.getCurrentPlayer(),
                        currentThrows = emptyList(),
                        currentRoundResult = null,
                        throwNumber = 0,
                        detectedDartCount = 0,
                        statusMessage = "准备开始下一轮",
                        isRoundActive = false,
                        canRedetect = false,
                        roundNumber = if (mode.getCurrentPlayer().id == _uiState.value.players.firstOrNull()?.id) {
                            _uiState.value.roundNumber + 1
                        } else {
                            _uiState.value.roundNumber
                        }
                    )
                }
            }
        }
    }

    fun resetGame() {
        gameMode?.reset()
        updateState {
            GameUiState(currentState = GameState.IDLE)
        }
    }

    fun setError(message: String) {
        updateState {
            it.copy(
                errorMessage = message,
                statusMessage = null,
                currentState = GameState.WAITING_FOR_THROW,
                isRoundActive = false,
                canRedetect = false
            )
        }
    }

    fun clearError() {
        updateState { it.copy(errorMessage = null) }
    }

    private fun updateState(update: (GameUiState) -> GameUiState) {
        _uiState.value = update(_uiState.value)
    }
}
