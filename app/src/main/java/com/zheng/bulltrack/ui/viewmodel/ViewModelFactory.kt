package com.zheng.bulltrack.ui.viewmodel

import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.application.usecase.CaptureRoundUseCase
import com.zheng.bulltrack.application.usecase.FinishGameUseCase
import com.zheng.bulltrack.application.usecase.ProcessRoundUseCase
import com.zheng.bulltrack.application.usecase.StartGameUseCase
import com.zheng.bulltrack.vision.DartDetector
import com.zheng.bulltrack.vision.MockDartDetector

class ViewModelFactory {
    
    companion object {
        private var gameViewModel: GameViewModel? = null
        
        fun createGameViewModel(): GameViewModel {
            if (gameViewModel != null) return gameViewModel!!
            
            val stateMachine = GameStateMachine()
            val dartDetector: DartDetector = MockDartDetector()
            
            val startGameUseCase = StartGameUseCase(stateMachine)
            val captureRoundUseCase = CaptureRoundUseCase(stateMachine, dartDetector)
            val processRoundUseCase = ProcessRoundUseCase(stateMachine)
            val finishGameUseCase = FinishGameUseCase(stateMachine)
            
            gameViewModel = GameViewModel(
                stateMachine = stateMachine,
                startGameUseCase = startGameUseCase,
                captureRoundUseCase = captureRoundUseCase,
                processRoundUseCase = processRoundUseCase,
                finishGameUseCase = finishGameUseCase,
                dartDetector = dartDetector
            )
            
            return gameViewModel!!
        }
    }
}
