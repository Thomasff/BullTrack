package com.zheng.bulltrack.domain.model

data class PlayerScore(
    val player: Player,
    val score: Int,
    val roundScores: List<Int> = emptyList()
)
