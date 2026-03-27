package com.zheng.bulltrack.ui.viewmodel

import android.graphics.Bitmap
import androidx.camera.view.PreviewView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.viewModelScope
import com.zheng.bulltrack.application.state.GameState
import com.zheng.bulltrack.application.state.GameUiState
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.application.usecase.CaptureRoundUseCase
import com.zheng.bulltrack.application.usecase.FinishGameUseCase
import com.zheng.bulltrack.application.usecase.ProcessRoundUseCase
import com.zheng.bulltrack.application.usecase.StartGameUseCase
import com.zheng.bulltrack.camera.CameraManager
import com.zheng.bulltrack.camera.CameraLockPhase
import com.zheng.bulltrack.camera.CameraState
import com.zheng.bulltrack.domain.gamemode.GameModeFactory
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.scoring.VirtualBoardScorer
import com.zheng.bulltrack.vision.DartDetector
import com.zheng.bulltrack.vision.NativeDartDetector
import kotlinx.coroutines.Dispatchers
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
    private val dartDetector: DartDetector,
    private val cameraManager: CameraManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()

    private var roundJob: Job? = null
    @Volatile
    private var warmUpRequested: Boolean = false

    init {
        dartDetector.init()
        viewModelScope.launch {
            stateMachine.uiState.collect { state ->
                _uiState.value = state
            }
        }
        viewModelScope.launch {
            cameraManager.cameraState.collect { cameraState ->
                when (cameraState) {
                    CameraState.Idle -> stateMachine.updateCameraStatus(
                        isReady = false,
                        zoomRatio = 1f,
                        statusMessage = "相机未初始化",
                        lockPhase = CameraLockPhase.IDLE.name,
                        lockReason = null
                    )

                    is CameraState.Ready -> stateMachine.updateCameraStatus(
                        isReady = true,
                        zoomRatio = cameraState.zoomRatio,
                        statusMessage = cameraState.statusMessage,
                        lockPhase = cameraState.lockPhase.name,
                        lockReason = cameraState.statusMessage
                    )

                    is CameraState.Capturing -> stateMachine.updateCameraStatus(
                        isReady = false,
                        zoomRatio = cameraState.zoomRatio,
                        statusMessage = cameraState.statusMessage,
                        lockPhase = cameraState.lockPhase.name,
                        lockReason = cameraState.statusMessage
                    )

                    is CameraState.Error -> {
                        stateMachine.updateCameraStatus(
                            isReady = false,
                            zoomRatio = cameraManager.getZoomRatio(),
                            statusMessage = cameraState.message,
                            lockPhase = CameraLockPhase.FALLBACK.name,
                            lockReason = cameraState.message
                        )
                        stateMachine.showError("相机错误: ${cameraState.message}")
                    }
                }
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
        if (!_uiState.value.isCameraPermissionGranted) {
            stateMachine.showError("需要先授予相机权限")
            return
        }
        if (!_uiState.value.isCameraReady) {
            stateMachine.showError("相机尚未就绪")
            return
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
        finishGameUseCase()
    }

    fun clearError() {
        stateMachine.clearError()
    }

    fun setCameraPermissionGranted(granted: Boolean) {
        stateMachine.setCameraPermission(granted)
        if (!granted) {
            cameraManager.unbindPreview()
        }
    }

    fun bindPreview(previewView: PreviewView, lifecycleOwner: LifecycleOwner) {
        if (!_uiState.value.isCameraPermissionGranted) {
            return
        }
        cameraManager.bindPreview(lifecycleOwner, previewView)
        stateMachine.updatePreviewVisibility(true)
    }

    fun unbindPreview() {
        cameraManager.unbindPreview()
        stateMachine.updatePreviewVisibility(false)
    }

    fun updateZoomRatio(zoomRatio: Float) {
        if (_uiState.value.currentState != GameState.WAITING_FOR_THROW) {
            return
        }
        cameraManager.setZoomRatio(zoomRatio)
    }

    fun warmUpDetectorOnGameScreenOpened() {
        if (warmUpRequested) {
            return
        }
        warmUpRequested = true
        viewModelScope.launch(Dispatchers.Default) {
            runCatching {
                dartDetector.warmUp()
            }
        }
    }

    override fun onCleared() {
        roundJob?.cancel()
        if (dartDetector is NativeDartDetector) {
            dartDetector.release()
        }
        cameraManager.release()
        super.onCleared()
    }
}
