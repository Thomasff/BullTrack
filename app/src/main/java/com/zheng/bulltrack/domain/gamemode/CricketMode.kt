package com.zheng.bulltrack.domain.gamemode

import com.zheng.bulltrack.domain.model.Player
import com.zheng.bulltrack.domain.model.PlayerScore
import com.zheng.bulltrack.domain.model.RoundResult
import com.zheng.bulltrack.domain.model.ScoreBoard
import com.zheng.bulltrack.domain.model.ThrowResult

class CricketMode(
    private val players: List<Player>
) : GameMode {
    
    companion object {
        val TARGET_NUMBERS = listOf(15, 16, 17, 18, 19, 20, 25)
    }
    
    private var currentPlayerIndex = 0
    private val marks = mutableMapOf<Int, MutableMap<Int, Int>>()
    private val scores = mutableMapOf<Int, Int>()
    private val roundScores = mutableMapOf<Int, MutableList<Int>>()
    private var winner: Player? = null
    
    init {
        players.forEach { player ->
            marks[player.id] = mutableMapOf<Int, Int>().apply {
                TARGET_NUMBERS.forEach { put(it, 0) }
            }
            scores[player.id] = 0
            roundScores[player.id] = mutableListOf()
        }
    }
    
    override fun applyRound(throws: List<ThrowResult>): RoundResult {
        val player = getCurrentPlayer()
        var roundScore = 0
        
        throws.forEach { throwResult ->
            val number = if (throwResult.sector == 25) 25 else throwResult.sector
            
            if (number in TARGET_NUMBERS) {
                val multiplier = when (throwResult.ring) {
                    com.zheng.bulltrack.domain.model.RingType.DOUBLE -> 2
                    com.zheng.bulltrack.domain.model.RingType.TRIPLE -> 3
                    com.zheng.bulltrack.domain.model.RingType.INNER_BULL -> 2
                    else -> 1
                }
                
                val currentMarks = marks[player.id]!![number] ?: 0
                val newMarks = minOf(currentMarks + multiplier, 3)
                val extraMarks = maxOf(0, currentMarks + multiplier - 3)
                
                marks[player.id]!![number] = newMarks
                
                if (extraMarks > 0 && isAllOpponentsClosed(player.id, number)) {
                    val pointValue = if (number == 25) 25 else number
                    roundScore += pointValue * extraMarks
                    scores[player.id] = scores[player.id]!! + pointValue * extraMarks
                }
            }
        }
        
        roundScores[player.id]!!.add(roundScore)
        
        val result = RoundResult(
            player = player,
            throws = throws,
            roundScore = roundScore
        )
        
        if (checkWin(player.id)) {
            winner = player
        } else {
            currentPlayerIndex = (currentPlayerIndex + 1) % players.size
        }
        
        return result
    }
    
    private fun isAllOpponentsClosed(playerId: Int, number: Int): Boolean {
        return players.filter { it.id != playerId }.all { 
            (marks[it.id]?.get(number) ?: 0) >= 3 
        }
    }
    
    private fun checkWin(playerId: Int): Boolean {
        val playerMarks = marks[playerId] ?: return false
        val allClosed = TARGET_NUMBERS.all { (playerMarks[it] ?: 0) >= 3 }
        
        if (!allClosed) return false
        
        val highestOpponentScore = players
            .filter { it.id != playerId }
            .maxOfOrNull { scores[it.id] ?: 0 } ?: 0
        
        return (scores[playerId] ?: 0) >= highestOpponentScore
    }
    
    override fun isGameOver(): Boolean = winner != null
    
    override fun getScoreBoard(): ScoreBoard {
        val playerScores = players.map { player ->
            PlayerScore(
                player = player,
                score = scores[player.id] ?: 0,
                roundScores = roundScores[player.id] ?: emptyList()
            )
        }
        
        return ScoreBoard(players = playerScores)
    }
    
    fun getMarks(playerId: Int): Map<Int, Int> {
        return marks[playerId] ?: emptyMap()
    }
    
    override fun getCurrentPlayer(): Player = players[currentPlayerIndex]
    
    override fun getWinner(): Player? = winner
    
    override fun reset() {
        currentPlayerIndex = 0
        winner = null
        players.forEach { player ->
            marks[player.id] = mutableMapOf<Int, Int>().apply {
                TARGET_NUMBERS.forEach { put(it, 0) }
            }
            scores[player.id] = 0
            roundScores[player.id] = mutableListOf()
        }
    }
}
