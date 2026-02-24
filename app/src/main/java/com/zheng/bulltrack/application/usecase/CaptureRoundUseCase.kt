package com.zheng.bulltrack.application.usecase

import android.graphics.Bitmap
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.DartDetector

class CaptureRoundUseCase(
    private val stateMachine: GameStateMachine,
    private val dartDetector: DartDetector
) {
    suspend operator fun invoke(beforeImage: Bitmap, afterImage: Bitmap): List<ThrowResult> {
        stateMachine.startCapturing()
        
        return try {
            val results = dartDetector.detect(beforeImage, afterImage)
            stateMachine.processThrows(results)
            results
        } catch (e: Exception) {
            stateMachine.setError("Detection failed: ${e.message}")
            emptyList()
        }
    }
}
