package com.zheng.bulltrack.domain.gamemode

import com.zheng.bulltrack.domain.model.GameType
import com.zheng.bulltrack.domain.model.Player

object GameModeFactory {
    fun create(type: GameType, players: List<Player>): GameMode {
        require(players.isNotEmpty()) { "At least one player is required" }
        require(players.size <= 4) { "Maximum 4 players allowed" }
        
        return when (type) {
            GameType.HIGH_SCORE -> HighScoreMode(players)
            GameType.GAME_301 -> Game301Mode(players)
            GameType.GAME_501 -> Game501Mode(players)
            GameType.CRICKET -> CricketMode(players)
        }
    }
}
