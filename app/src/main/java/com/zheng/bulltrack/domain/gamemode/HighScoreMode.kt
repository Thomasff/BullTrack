package com.zheng.bulltrack.domain.gamemode

import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.PlayerScore
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ScoreBoard
import com.zheng.bulltrack.domain.model.ThrowResult

class HighScoreMode(
    private val players: List<Player>,
    private val totalRounds: Int = 10
) : GameMode {
    
    private var currentRound = 0
    private var currentPlayerIndex = 0
    private val scores = mutableMapOf<Int, Int>()
    private val roundScores = mutableMapOf<Int, MutableList<Int>>()
    
    init {
        players.forEach { player ->
            scores[player.id] = 0
            roundScores[player.id] = mutableListOf()
        }
    }
    
    override fun applyRound(throws: List<ThrowResult>): RoundResult {
        val player = getCurrentPlayer()
        val roundScore = throws.sumOf { it.score }
        
        scores[player.id] = scores[player.id]!! + roundScore
        roundScores[player.id]!!.add(roundScore)
        
        val result = RoundResult(
            player = player,
            throws = throws,
            roundScore = roundScore
        )
        
        currentPlayerIndex = (currentPlayerIndex + 1) % players.size
        if (currentPlayerIndex == 0) {
            currentRound++
        }
        
        return result
    }
    
    override fun isGameOver(): Boolean {
        return currentRound >= totalRounds && currentPlayerIndex == 0
    }
    
    override fun getScoreBoard(): ScoreBoard {
        val playerScores = players.map { player ->
            PlayerScore(
                player = player,
                score = scores[player.id] ?: 0,
                roundScores = roundScores[player.id] ?: emptyList()
            )
        }.sortedByDescending { it.score }
        
        return ScoreBoard(players = playerScores)
    }
    
    override fun getCurrentPlayer(): Player {
        return players[currentPlayerIndex]
    }
    
    override fun getWinner(): Player? {
        if (!isGameOver()) return null
        
        val winningScore = scores.values.maxOrNull() ?: return null
        return players.find { scores[it.id] == winningScore }
    }
    
    override fun reset() {
        currentRound = 0
        currentPlayerIndex = 0
        players.forEach { player ->
            scores[player.id] = 0
            roundScores[player.id] = mutableListOf()
        }
    }
}
