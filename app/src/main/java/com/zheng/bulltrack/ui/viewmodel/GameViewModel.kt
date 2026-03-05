package com.zheng.bulltrack.ui.viewmodel

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
    
    private var beforeImage: Bitmap? = null
    private var afterImage: Bitmap? = null
    
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
    
    fun captureBeforeImage(bitmap: Bitmap) {
        beforeImage = bitmap
        stateMachine.startCapturing()
    }
    
    fun captureAfterImage(bitmap: Bitmap) {
        afterImage = bitmap
        
        viewModelScope.launch {
            val before = beforeImage ?: return@launch
            val after = afterImage ?: return@launch
            captureRoundUseCase(before, after)
        }
    }
    
    fun confirmResult() {
        val throws = _uiState.value.currentThrows
        processRoundUseCase(throws)
        stateMachine.confirmResult()
        beforeImage = null
        afterImage = null
    }

    fun updatePendingThrowPosition(index: Int, position: DartPosition) {
        val currentThrows = _uiState.value.currentThrows.toMutableList()
        if (index in currentThrows.indices) {
            currentThrows[index] = VirtualBoardScorer.calculateScore(position)
            stateMachine.updateShowingThrows(currentThrows)
        }
    }
    
    fun resetGame() {
        beforeImage = null
        afterImage = null
        finishGameUseCase()
    }
    
    fun clearError() {
        stateMachine.clearError()
    }
}
