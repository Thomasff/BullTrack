package com.zheng.bulltrack.domain.gamemode

import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.PlayerScore
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ScoreBoard
import com.zheng.bulltrack.domain.model.ThrowResult

abstract class X01Mode(
    protected val players: List<Player>,
    protected val startingScore: Int
) : GameMode {
    
    protected var currentPlayerIndex = 0
    protected val scores = mutableMapOf<Int, Int>()
    protected val roundScores = mutableMapOf<Int, MutableList<Int>>()
    private var winner: Player? = null
    
    init {
        players.forEach { player ->
            scores[player.id] = startingScore
            roundScores[player.id] = mutableListOf()
        }
    }
    
    override fun applyRound(throws: List<ThrowResult>): RoundResult {
        val player = getCurrentPlayer()
        val roundScore = throws.sumOf { it.score }
        val currentScore = scores[player.id] ?: startingScore
        
        val newScore = currentScore - roundScore
        
        if (newScore == 0) {
            val hasDoubleOut = throws.last().score != throws.last().sector && 
                              throws.last().sector != 0
            
            if (hasDoubleOut || throws.any { it.score == 50 }) {
                scores[player.id] = 0
                winner = player
            } else {
                roundScores[player.id]!!.add(0)
            }
        } else if (newScore < 0 || newScore == 1) {
            roundScores[player.id]!!.add(0)
        } else {
            scores[player.id] = newScore
            roundScores[player.id]!!.add(roundScore)
        }
        
        val result = RoundResult(
            player = player,
            throws = throws,
            roundScore = if (scores[player.id] == 0) roundScore else (roundScores[player.id]?.last() ?: 0)
        )
        
        if (winner == null) {
            currentPlayerIndex = (currentPlayerIndex + 1) % players.size
        }
        
        return result
    }
    
    override fun isGameOver(): Boolean = winner != null
    
    override fun getScoreBoard(): ScoreBoard {
        val playerScores = players.map { player ->
            PlayerScore(
                player = player,
                score = scores[player.id] ?: startingScore,
                roundScores = roundScores[player.id] ?: emptyList()
            )
        }
        
        return ScoreBoard(players = playerScores)
    }
    
    override fun getCurrentPlayer(): Player = players[currentPlayerIndex]
    
    override fun getWinner(): Player? = winner
    
    override fun reset() {
        currentPlayerIndex = 0
        winner = null
        players.forEach { player ->
            scores[player.id] = startingScore
            roundScores[player.id] = mutableListOf()
        }
    }
}

class Game301Mode(players: List<Player>) : X01Mode(players, 301)

class Game501Mode(players: List<Player>) : X01Mode(players, 501)
