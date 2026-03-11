package com.zheng.bulltrack.ui.viewmodel

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zheng.bulltrack.application.state.GameState
import com.zheng.bulltrack.application.state.GameUiState
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.application.usecase.CaptureRoundUseCase
import com.zheng.bulltrack.application.usecase.FinishGameUseCase
import com.zheng.bulltrack.application.usecase.ProcessRoundUseCase
import com.zheng.bulltrack.application.usecase.StartGameUseCase
import com.zheng.bulltrack.domain.gamemode.GameModeFactory
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.scoring.VirtualBoardScorer
import com.zheng.bulltrack.vision.DartDetector
import com.zheng.bulltrack.vision.NativeDartDetector
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class GameViewModel(
    private val stateMachine: GameStateMachine,
    private val startGameUseCase: StartGameUseCase,
    private val captureRoundUseCase: CaptureRoundUseCase,
    private val processRoundUseCase: ProcessRoundUseCase,
    private val finishGameUseCase: FinishGameUseCase,
    private val dartDetector: DartDetector
) : ViewModel() {

    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()

    private var roundJob: Job? = null

    init {
        dartDetector.init()
        viewModelScope.launch {
            stateMachine.uiState.collect { state ->
                _uiState.value = state
            }
        }
    }

    fun selectGameMode(gameType: GameType) {
        stateMachine.selectMode(gameType)
    }

    fun setPlayers(playerNames: List<String>) {
        val players = playerNames.mapIndexed { index, name ->
            Player(id = index + 1, name = name.ifEmpty { "Player ${index + 1}" })
        }
        stateMachine.setPlayers(players)

        val gameType = _uiState.value.gameType ?: return
        val gameMode = GameModeFactory.create(gameType, players)
        processRoundUseCase.setGameMode(gameMode)
        stateMachine.startGame(gameMode)
    }

    fun startRound() {
        if (_uiState.value.currentState != GameState.WAITING_FOR_THROW) {
            return
        }
        if (dartDetector is NativeDartDetector) {
            dartDetector.reset()
        }
        roundJob?.cancel()
        roundJob = viewModelScope.launch {
            runCatching {
                captureRoundUseCase.startRound()
            }.onFailure { error ->
                stateMachine.setError("检测失败: ${error.message}")
            }
        }
    }

    fun endRound() {
        if (!_uiState.value.isRoundActive) {
            return
        }
        captureRoundUseCase.stopRound()
    }

    fun redetectRound() {
        if (!_uiState.value.canRedetect) {
            return
        }
        viewModelScope.launch {
            captureRoundUseCase.redetectRound()
        }
    }

    fun confirmResult() {
        val throws = _uiState.value.currentThrows
        processRoundUseCase(throws)
        stateMachine.confirmResult()
        captureRoundUseCase.clearRound()
        if (dartDetector is NativeDartDetector) {
            dartDetector.reset()
        }
        roundJob = null
    }

    fun updatePendingThrowPosition(index: Int, position: DartPosition) {
        val currentThrows = _uiState.value.currentThrows.toMutableList()
        if (index in currentThrows.indices) {
            currentThrows[index] = VirtualBoardScorer.calculateScore(position)
            stateMachine.updateShowingThrows(currentThrows)
        }
    }

    fun resetGame() {
        roundJob?.cancel()
        roundJob = null
        captureRoundUseCase.clearRound()
        if (dartDetector is NativeDartDetector) {
            dartDetector.reset()
        }
        finishGameUseCase()
    }

    fun clearError() {
        stateMachine.clearError()
    }

    override fun onCleared() {
        roundJob?.cancel()
        if (dartDetector is NativeDartDetector) {
            dartDetector.release()
        }
        super.onCleared()
    }
}
