package com.zheng.bulltrack.ui.viewmodel

import android.content.Context
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.application.usecase.CaptureRoundUseCase
import com.zheng.bulltrack.application.usecase.FinishGameUseCase
import com.zheng.bulltrack.application.usecase.ProcessRoundUseCase
import com.zheng.bulltrack.application.usecase.StartGameUseCase
import com.zheng.bulltrack.camera.CameraManager
import com.zheng.bulltrack.camera.CameraRoundFrameSource
import com.zheng.bulltrack.camera.CameraXManager
import com.zheng.bulltrack.debug.DebugImageSaver
import com.zheng.bulltrack.vision.DartDetector
import com.zheng.bulltrack.vision.NativeDartDetector

class ViewModelFactory {

    companion object {
        private var gameViewModel: GameViewModel? = null

        fun createGameViewModel(context: Context): GameViewModel {
            if (gameViewModel != null) return gameViewModel!!

            val stateMachine = GameStateMachine()
            val dartDetector: DartDetector = NativeDartDetector(context.applicationContext.assets)
            val cameraManager: CameraManager = CameraXManager().apply {
                initialize(context.applicationContext)
            }
            val frameSource = CameraRoundFrameSource(cameraManager)
            val debugImageSaver = DebugImageSaver(context.applicationContext)

            val startGameUseCase = StartGameUseCase(stateMachine)
            val captureRoundUseCase = CaptureRoundUseCase(
                stateMachine = stateMachine,
                dartDetector = dartDetector,
                frameSource = frameSource,
                debugImageSaver = debugImageSaver
            )
            val processRoundUseCase = ProcessRoundUseCase(stateMachine)
            val finishGameUseCase = FinishGameUseCase(stateMachine)

            gameViewModel = GameViewModel(
                stateMachine = stateMachine,
                startGameUseCase = startGameUseCase,
                captureRoundUseCase = captureRoundUseCase,
                processRoundUseCase = processRoundUseCase,
                finishGameUseCase = finishGameUseCase,
                dartDetector = dartDetector,
                cameraManager = cameraManager
            )

            return gameViewModel!!
        }
    }
}
