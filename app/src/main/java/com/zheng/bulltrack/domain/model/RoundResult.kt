package com.zheng.bulltrack.domain.model

data class RoundResult(
    val player: Player,
    val throws: List<ThrowResult>,
    val roundScore: Int
)
