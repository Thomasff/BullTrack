package com.zheng.bulltrack.application.usecase

import com.zheng.bulltrack.application.statemachine.GameStateMachine

class FinishGameUseCase(
    private val stateMachine: GameStateMachine
) {
    operator fun invoke() {
        stateMachine.resetGame()
    }
}
