package com.zheng.bulltrack.application.usecase

import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.domain.gamemode.GameModeFactory
import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player

class StartGameUseCase(
    private val stateMachine: GameStateMachine
) {
    operator fun invoke(gameType: GameType, players: List<Player>) {
        stateMachine.selectMode(gameType)
        stateMachine.setPlayers(players)
        
        val gameMode = GameModeFactory.create(gameType, players)
        stateMachine.startGame(gameMode)
    }
}
