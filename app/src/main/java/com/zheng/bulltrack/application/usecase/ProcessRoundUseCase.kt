package com.zheng.bulltrack.application.usecase

import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.domain.gamemode.GameMode
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ThrowResult

class ProcessRoundUseCase(
    private val stateMachine: GameStateMachine
) {
    private var gameMode: GameMode? = null
    
    fun setGameMode(mode: GameMode) {
        this.gameMode = mode
    }
    
    operator fun invoke(throws: List<ThrowResult>): RoundResult? {
        val mode = gameMode ?: return null
        
        val result = mode.applyRound(throws)
        stateMachine.applyRoundResult(result)
        
        return result
    }
}
