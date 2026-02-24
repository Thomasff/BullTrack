package com.zheng.bulltrack.domain.gamemode

import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ScoreBoard
import com.zheng.bulltrack.domain.model.ThrowResult

interface GameMode {
    fun applyRound(throws: List<ThrowResult>): RoundResult
    fun isGameOver(): Boolean
    fun getScoreBoard(): ScoreBoard
    fun getCurrentPlayer(): Player
    fun getWinner(): Player?
    fun reset()
}
