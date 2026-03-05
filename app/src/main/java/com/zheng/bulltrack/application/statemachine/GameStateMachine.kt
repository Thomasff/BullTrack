package com.zheng.bulltrack.application.statemachine

import com.zheng.bulltrack.application.state.GameState
import com.zheng.bulltrack.application.state.GameUiState
import com.zheng.bulltrack.domain.gamemode.GameMode
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ScoreBoard
import com.zheng.bulltrack.domain.model.ThrowResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class GameStateMachine {
    
    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()
    
    private var gameMode: GameMode? = null
    
    fun selectMode(gameType: GameType) {
        updateState { it.copy(
            currentState = GameState.MODE_SELECTED,
            gameType = gameType
        )}
    }
    
    fun setPlayers(players: List<Player>) {
        updateState { it.copy(
            players = players,
            currentPlayer = players.firstOrNull()
        )}
    }
    
    fun startGame(gameMode: GameMode) {
        this.gameMode = gameMode
        updateState { it.copy(
            currentState = GameState.WAITING_FOR_THROW,
            currentPlayer = gameMode.getCurrentPlayer(),
            scoreBoard = gameMode.getScoreBoard(),
            roundNumber = 1,
            throwNumber = 0
        )}
    }
    
    fun startCapturing() {
        val currentState = _uiState.value.currentState
        val newState = when (currentState) {
            GameState.WAITING_FOR_THROW -> GameState.CAPTURING_START
            GameState.CAPTURING_START -> GameState.CAPTURING_END
            else -> currentState
        }
        updateState { it.copy(currentState = newState) }
    }

    fun beginProcessing() {
        updateState { it.copy(currentState = GameState.PROCESSING) }
    }

    fun showDetectedResult(throws: List<ThrowResult>) {
        updateState {
            it.copy(
                currentState = GameState.SHOWING_RESULT,
                currentThrows = throws,
                currentRoundResult = null
            )
        }
    }

    fun updateShowingThrows(throws: List<ThrowResult>) {
        if (_uiState.value.currentState != GameState.SHOWING_RESULT) return
        updateState {
            it.copy(currentThrows = throws)
        }
    }
    
    fun applyRoundResult(result: RoundResult) {
        gameMode?.let { mode ->
            updateState { it.copy(
                currentState = GameState.SHOWING_RESULT,
                currentRoundResult = result,
                scoreBoard = mode.getScoreBoard()
            )}
        }
    }
    
    fun confirmResult() {
        gameMode?.let { mode ->
            if (mode.isGameOver()) {
                updateState { it.copy(
                    currentState = GameState.GAME_OVER,
                    winner = mode.getWinner()
                )}
            } else {
                updateState { it.copy(
                    currentState = GameState.WAITING_FOR_THROW,
                    currentPlayer = mode.getCurrentPlayer(),
                    currentThrows = emptyList(),
                    currentRoundResult = null,
                    throwNumber = 0,
                    roundNumber = if (mode.getCurrentPlayer().id == _uiState.value.players.firstOrNull()?.id) {
                        _uiState.value.roundNumber + 1
                    } else {
                        _uiState.value.roundNumber
                    }
                )}
            }
        }
    }
    
    fun resetGame() {
        gameMode?.reset()
        updateState { 
            GameUiState(
                currentState = GameState.IDLE
            )
        }
    }
    
    fun setError(message: String) {
        updateState { it.copy(
            errorMessage = message,
            currentState = GameState.WAITING_FOR_THROW
        )}
    }
    
    fun clearError() {
        updateState { it.copy(errorMessage = null) }
    }
    
    private fun updateState(update: (GameUiState) -> GameUiState) {
        _uiState.value = update(_uiState.value)
    }
}
