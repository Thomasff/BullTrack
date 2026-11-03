package io.github.thomasff.bulltrack.core.vision

data class StartRoundDetectionUpdate(
    val debugImages: List<DebugImageArtifact> = emptyList(),
    val errorMessage: String? = null,
    // Darts already on the board in the first frame.
    val startDartCount: Int = 0,
    // Board's left half over its right half in the image; above 1 means the phone is left of
    // the board, 0 when unknown.
    val leftRightHalfRatio: Float = 0f,
    // Board box height over the side of the square the model sees (0 when unknown), and
    // whether the board keeps clear of that square's edges.
    val boardHeightShare: Float = 0f,
    val boardInSquare: Boolean = false,
    // Top of that square in the upright frame; it moves up or down to centre the board.
    val modelSquareTop: Int = 0
)
