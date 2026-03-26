package com.zheng.bulltrack.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Slider
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.zheng.bulltrack.application.state.GameState
import com.zheng.bulltrack.application.state.GameUiState
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.domain.scoring.VirtualBoardScorer
import kotlin.math.roundToInt

@Composable
fun GameScreen(
    uiState: GameUiState,
    onStartRound: () -> Unit,
    onEndRound: () -> Unit,
    onConfirmResult: () -> Unit,
    onRedetect: () -> Unit,
    onManualAdjustPosition: (Int, DartPosition) -> Unit,
    onCameraPermissionChanged: (Boolean) -> Unit,
    onBindPreview: (PreviewView) -> Unit,
    onUnbindPreview: () -> Unit,
    onZoomRatioChanged: (Float) -> Unit,
    onReset: () -> Unit
) {
    val context = LocalContext.current
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = onCameraPermissionChanged
    )
    val isPermissionGranted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.CAMERA
    ) == PackageManager.PERMISSION_GRANTED

    LaunchedEffect(isPermissionGranted) {
        onCameraPermissionChanged(isPermissionGranted)
        if (!isPermissionGranted) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        GameInfoHeader(
            currentPlayer = uiState.currentPlayer,
            roundNumber = uiState.roundNumber,
            scoreBoard = uiState.scoreBoard
        )

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color(0xFF101820))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                RoundStatusCard(uiState)

                if (uiState.isPreviewVisible) {
                    CameraPreviewCard(
                        uiState = uiState,
                        onBindPreview = onBindPreview,
                        onUnbindPreview = onUnbindPreview,
                        onZoomRatioChanged = onZoomRatioChanged
                    )
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.TopCenter
                ) {
                    when (uiState.currentState) {
                        GameState.ROUND_IN_PROGRESS,
                        GameState.PROCESSING,
                        GameState.SHOWING_RESULT -> {
                            VirtualDartboardEditor(
                                throws = uiState.currentThrows,
                                editable = uiState.currentState == GameState.SHOWING_RESULT,
                                onThrowPositionChanged = onManualAdjustPosition,
                                modifier = Modifier.align(Alignment.TopCenter)
                            )
                        }

                        GameState.GAME_OVER -> {
                            GameOverOverlay(
                                winner = uiState.winner,
                                scoreBoard = uiState.scoreBoard,
                                onPlayAgain = onReset,
                                modifier = Modifier.align(Alignment.Center)
                            )
                        }

                        else -> Unit
                    }
                }
            }

            when (uiState.currentState) {
                GameState.WAITING_FOR_THROW -> {
                    PrimaryActionButton(
                        text = "开始本轮",
                        onClick = onStartRound,
                        enabled = uiState.isCameraPermissionGranted && uiState.isCameraReady,
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }

                GameState.ROUND_IN_PROGRESS,
                GameState.PROCESSING -> {
                    if (uiState.currentState == GameState.PROCESSING) {
                        CircularProgressIndicator(
                            modifier = Modifier.align(Alignment.Center),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    PrimaryActionButton(
                        text = "结束本轮",
                        onClick = onEndRound,
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }

                GameState.SHOWING_RESULT -> {
                    ResultOverlay(
                        throws = uiState.currentThrows,
                        roundScore = uiState.currentThrows.sumOf { it.score },
                        canRedetect = uiState.canRedetect,
                        onRedetect = onRedetect,
                        onConfirm = onConfirmResult,
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }

                else -> Unit
            }

            uiState.errorMessage?.let { error ->
                Snackbar(modifier = Modifier.align(Alignment.BottomCenter)) {
                    Text(error)
                }
            }
        }
    }
}

@Composable
private fun RoundStatusCard(uiState: GameUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = when (uiState.currentState) {
                    GameState.WAITING_FOR_THROW -> "等待开始"
                    GameState.ROUND_IN_PROGRESS -> "连续检测中"
                    GameState.PROCESSING -> "处理中"
                    GameState.SHOWING_RESULT -> "本轮结果"
                    GameState.GAME_OVER -> "比赛结束"
                    else -> "BullTrack"
                },
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "已识别 ${uiState.detectedDartCount}/${uiState.maxDartsPerRound} 支飞镖",
                style = MaterialTheme.typography.bodyMedium
            )

            uiState.statusMessage?.let { status ->
                Spacer(modifier = Modifier.height(6.dp))
                Text(status, style = MaterialTheme.typography.bodySmall)
            }

            uiState.cameraStatusMessage?.let { status ->
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = status,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (uiState.cameraLockPhase != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = buildString {
                        append("拍摄模式")
                        uiState.cameraLockPhase?.let { phase ->
                            append(" [$phase]")
                        }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            uiState.cameraLockReason?.let { reason ->
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = reason,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.tertiary
                )
            }
        }
    }
}

@Composable
private fun CameraPreviewCard(
    uiState: GameUiState,
    onBindPreview: (PreviewView) -> Unit,
    onUnbindPreview: () -> Unit,
    onZoomRatioChanged: (Float) -> Unit
) {
    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "开始本轮前调整预览和倍率",
                style = MaterialTheme.typography.titleSmall
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(9f / 16f)
                    .background(Color.Black),
                contentAlignment = Alignment.Center
            ) {
                if (uiState.isCameraPermissionGranted) {
                    AndroidView(
                        factory = { context ->
                            PreviewView(context).apply {
                                scaleType = PreviewView.ScaleType.FILL_CENTER
                                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                                onBindPreview(this)
                            }
                        },
                        update = { previewView ->
                            onBindPreview(previewView)
                        },
                        modifier = Modifier.fillMaxSize()
                    )

                    DisposableEffect(Unit) {
                        onDispose {
                            onUnbindPreview()
                        }
                    }
                } else {
                    Text(
                        text = "等待相机权限",
                        color = Color.White,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            Text(
                text = "倍率 ${String.format("%.2f", uiState.zoomRatio)}x",
                style = MaterialTheme.typography.bodyMedium
            )
            Slider(
                value = uiState.zoomRatio,
                onValueChange = onZoomRatioChanged,
                valueRange = 1f..4f,
                enabled = uiState.isCameraReady
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = {
                        Text(if (uiState.isCameraReady) "相机已就绪" else "相机未就绪")
                    }
                )
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = {
                        Text(
                            "自动稳定拍摄"
                        )
                    }
                )
            }
        }
    }
}

@Composable
fun GameInfoHeader(
    currentPlayer: com.zheng.bulltrack.domain.model.Player?,
    roundNumber: Int,
    scoreBoard: com.zheng.bulltrack.domain.model.ScoreBoard?
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.primaryContainer
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "第 $roundNumber 轮",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = "当前: ${currentPlayer?.name ?: "-"}",
                    style = MaterialTheme.typography.titleMedium
                )
            }

            scoreBoard?.let { board ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    board.players.forEach { playerScore ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = playerScore.player.name,
                                style = MaterialTheme.typography.bodySmall
                            )
                            Text(
                                text = playerScore.score.toString(),
                                style = MaterialTheme.typography.titleLarge
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PrimaryActionButton(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    modifier: Modifier = Modifier
) {
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .padding(32.dp)
            .size(width = 160.dp, height = 56.dp),
        shape = CircleShape
    ) {
        Text(text)
    }
}

@Composable
fun ResultOverlay(
    throws: List<ThrowResult>,
    roundScore: Int,
    canRedetect: Boolean,
    onRedetect: () -> Unit,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(
                text = "识别结果",
                style = MaterialTheme.typography.titleSmall
            )

            Spacer(modifier = Modifier.height(6.dp))

            if (throws.isEmpty()) {
                Text("当前没有识别到飞镖", style = MaterialTheme.typography.bodySmall)
            } else {
                throws.forEachIndexed { index, throwResult ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("飞镖 ${index + 1}", style = MaterialTheme.typography.bodySmall)
                        Text(formatThrow(throwResult), style = MaterialTheme.typography.bodySmall)
                        Text(throwResult.score.toString(), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("本轮得分", style = MaterialTheme.typography.titleSmall)
                Text(
                    roundScore.toString(),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            if (canRedetect) {
                Button(
                    onClick = onRedetect,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("重新识别")
                }

                Spacer(modifier = Modifier.height(8.dp))
            }

            Button(
                onClick = onConfirm,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("确认结果")
            }
        }
    }
}

@Composable
private fun VirtualDartboardEditor(
    throws: List<ThrowResult>,
    editable: Boolean,
    onThrowPositionChanged: (Int, DartPosition) -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current
    var boardCanvasSize by remember { mutableStateOf(IntSize.Zero) }
    var draggingIndex by remember { mutableStateOf<Int?>(null) }
    var hoverRegion by remember { mutableStateOf<ThrowResult?>(null) }
    val lift by animateFloatAsState(
        targetValue = if (hoverRegion != null) 1.08f else 1f,
        label = "hoverLift"
    )

    val markerColors = listOf(
        Color(0xFFFFF176),
        Color(0xFF80DEEA),
        Color(0xFFFFAB91)
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.TopCenter
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .aspectRatio(1f)
                .padding(top = 12.dp)
                .onSizeChanged { boardCanvasSize = it }
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                drawVirtualBoard(
                    hover = hoverRegion,
                    lift = lift
                )
            }

            if (boardCanvasSize.width > 0 && boardCanvasSize.height > 0) {
                throws.forEachIndexed { index, throwResult ->
                    val position = throwResult.position ?: fallbackPosition(index)
                    val latestPosition by rememberUpdatedState(position)
                    val markerCenter = normalizedToCanvas(position, boardCanvasSize)
                    val touchSizeDp = 72.dp
                    val touchSizePx = with(density) { touchSizeDp.toPx() }

                    val dragModifier = if (editable) {
                        Modifier.pointerInput(index, boardCanvasSize) {
                            var currentPos = latestPosition
                            detectDragGestures(
                                onDragStart = {
                                    currentPos = latestPosition
                                    draggingIndex = index
                                    hoverRegion = VirtualBoardScorer.calculateScore(currentPos)
                                },
                                onDrag = { change, dragAmount ->
                                    change.consume()
                                    val currentCenter = normalizedToCanvas(currentPos, boardCanvasSize)
                                    val newCenter = currentCenter + dragAmount
                                    val unclamped = canvasToNormalized(newCenter, boardCanvasSize)
                                    currentPos = VirtualBoardScorer.clampToBoard(unclamped)
                                    hoverRegion = VirtualBoardScorer.calculateScore(currentPos)
                                    onThrowPositionChanged(index, currentPos)
                                },
                                onDragEnd = {
                                    val snapped = VirtualBoardScorer.snapToRegionCenter(currentPos)
                                    onThrowPositionChanged(index, snapped)
                                    draggingIndex = null
                                    hoverRegion = null
                                },
                                onDragCancel = {
                                    draggingIndex = null
                                    hoverRegion = null
                                }
                            )
                        }
                    } else {
                        Modifier
                    }

                    Box(
                        modifier = Modifier
                            .size(touchSizeDp)
                            .offset {
                                IntOffset(
                                    (markerCenter.x - touchSizePx / 2f).roundToInt(),
                                    (markerCenter.y - touchSizePx / 2f).roundToInt()
                                )
                            }
                            .then(dragModifier),
                        contentAlignment = Alignment.Center
                    ) {
                        val color = markerColors[index % markerColors.size]
                        val markerColor = if (draggingIndex == index) Color.White else color
                        val markerStroke = with(density) {
                            if (draggingIndex == index) 3.4.dp.toPx() else 3.dp.toPx()
                        }
                        val markerArm = with(density) {
                            if (draggingIndex == index) 11.dp.toPx() else 9.dp.toPx()
                        }
                        Canvas(modifier = Modifier.size(28.dp)) {
                            val c = center
                            drawLine(
                                color = markerColor,
                                start = Offset(c.x - markerArm, c.y - markerArm),
                                end = Offset(c.x + markerArm, c.y + markerArm),
                                strokeWidth = markerStroke
                            )
                            drawLine(
                                color = markerColor,
                                start = Offset(c.x + markerArm, c.y - markerArm),
                                end = Offset(c.x - markerArm, c.y + markerArm),
                                strokeWidth = markerStroke
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawVirtualBoard(
    hover: ThrowResult?,
    lift: Float
) {
    val radius = size.minDimension / 2f
    val center = Offset(size.width / 2f, size.height / 2f)

    fun ringStroke(inner: Float, outer: Float): Float = (outer - inner) * radius
    fun ringRadius(inner: Float, outer: Float): Float = ((inner + outer) / 2f) * radius

    drawCircle(
        color = Color(0xFF2E2E2E),
        radius = radius,
        center = center
    )

    for (sectorIndex in 0 until 20) {
        val startAngle = VirtualBoardScorer.DRAW_START_ANGLE_DEGREES +
            sectorIndex * VirtualBoardScorer.SECTOR_SWEEP_DEGREES
        val singleColor = if (sectorIndex % 2 == 0) Color(0xFFE9D8A6) else Color(0xFF111111)
        val multiplierColor = if (sectorIndex % 2 == 0) Color(0xFFC62828) else Color(0xFF2E7D32)

        drawBandSector(
            center = center,
            radius = radius,
            startAngle = startAngle,
            inner = VirtualBoardScorer.DOUBLE_END,
            outer = VirtualBoardScorer.BOARD_OUTER_END,
            color = Color(0xFF3F3F3F)
        )
        drawBandSector(center, radius, startAngle, VirtualBoardScorer.OUTER_SINGLE_END, VirtualBoardScorer.DOUBLE_END, multiplierColor)
        drawBandSector(center, radius, startAngle, VirtualBoardScorer.TRIPLE_END, VirtualBoardScorer.OUTER_SINGLE_END, singleColor)
        drawBandSector(center, radius, startAngle, VirtualBoardScorer.INNER_SINGLE_END, VirtualBoardScorer.TRIPLE_END, multiplierColor)
        drawBandSector(center, radius, startAngle, VirtualBoardScorer.OUTER_BULL_END, VirtualBoardScorer.INNER_SINGLE_END, singleColor)
    }

    drawCircle(
        color = Color(0xFF2E7D32),
        radius = VirtualBoardScorer.OUTER_BULL_END * radius,
        center = center
    )
    drawCircle(
        color = Color(0xFFC62828),
        radius = VirtualBoardScorer.INNER_BULL_END * radius,
        center = center
    )

    for (i in 0 until 20) {
        val angleRad = Math.toRadians(
            (VirtualBoardScorer.DRAW_START_ANGLE_DEGREES + i * VirtualBoardScorer.SECTOR_SWEEP_DEGREES).toDouble()
        )
        val innerLineRadius = VirtualBoardScorer.OUTER_BULL_END * radius
        val start = Offset(
            (center.x + innerLineRadius * kotlin.math.cos(angleRad).toFloat()),
            (center.y + innerLineRadius * kotlin.math.sin(angleRad).toFloat())
        )
        val end = Offset(
            (center.x + radius * kotlin.math.cos(angleRad).toFloat()),
            (center.y + radius * kotlin.math.sin(angleRad).toFloat())
        )
        drawLine(
            color = Color(0xAA000000),
            start = start,
            end = end,
            strokeWidth = 1.5f
        )
    }

    hover?.let { hovered ->
        val highlight = Color(0xFFFDD835).copy(alpha = 0.75f)
        val ring = hovered.ring

        if (ring == RingType.INNER_BULL) {
            drawCircle(
                color = highlight.copy(alpha = 0.45f),
                radius = VirtualBoardScorer.INNER_BULL_END * radius,
                center = center
            )
            drawCircle(
                color = Color.White.copy(alpha = 0.25f * lift),
                radius = VirtualBoardScorer.INNER_BULL_END * radius,
                center = center,
                style = Stroke(width = 2f)
            )
            return
        }

        if (ring == RingType.OUTER_BULL) {
            drawCircle(
                color = highlight,
                radius = ringRadius(VirtualBoardScorer.INNER_BULL_END, VirtualBoardScorer.OUTER_BULL_END),
                center = center,
                style = Stroke(width = ringStroke(VirtualBoardScorer.INNER_BULL_END, VirtualBoardScorer.OUTER_BULL_END))
            )
            drawCircle(
                color = Color.White.copy(alpha = 0.25f * lift),
                radius = ringRadius(VirtualBoardScorer.INNER_BULL_END, VirtualBoardScorer.OUTER_BULL_END),
                center = center,
                style = Stroke(width = 2f)
            )
            return
        }

        if (ring == RingType.MISS) {
            val missRingRadius = ringRadius(VirtualBoardScorer.DOUBLE_END, VirtualBoardScorer.BOARD_OUTER_END)
            val missRingStroke = ringStroke(VirtualBoardScorer.DOUBLE_END, VirtualBoardScorer.BOARD_OUTER_END)
            drawCircle(
                color = highlight,
                radius = missRingRadius,
                center = center,
                style = Stroke(width = missRingStroke)
            )
            drawCircle(
                color = Color.White.copy(alpha = 0.25f * lift),
                radius = missRingRadius,
                center = center,
                style = Stroke(width = 2f)
            )
            return
        }

        val sectorIndex = VirtualBoardScorer.sectorIndexForScore(hovered.sector)
        val startAngle = VirtualBoardScorer.DRAW_START_ANGLE_DEGREES +
            sectorIndex * VirtualBoardScorer.SECTOR_SWEEP_DEGREES
        val (inner, outer) = when (ring) {
            RingType.INNER_SINGLE -> VirtualBoardScorer.OUTER_BULL_END to VirtualBoardScorer.INNER_SINGLE_END
            RingType.TRIPLE -> VirtualBoardScorer.INNER_SINGLE_END to VirtualBoardScorer.TRIPLE_END
            RingType.OUTER_SINGLE -> VirtualBoardScorer.TRIPLE_END to VirtualBoardScorer.OUTER_SINGLE_END
            RingType.DOUBLE -> VirtualBoardScorer.OUTER_SINGLE_END to VirtualBoardScorer.DOUBLE_END
            else -> 0f to 0f
        }

        if (outer > inner) {
            drawBandSector(
                center = center,
                radius = radius,
                startAngle = startAngle,
                inner = inner,
                outer = outer,
                color = highlight,
            )
            drawBandSector(
                center = center,
                radius = radius,
                startAngle = startAngle,
                inner = inner,
                outer = outer,
                color = Color.White.copy(alpha = 0.20f * lift),
            )
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawBandSector(
    center: Offset,
    radius: Float,
    startAngle: Float,
    inner: Float,
    outer: Float,
    color: Color
) {
    val strokeWidth = (outer - inner) * radius
    val drawRadius = ((inner + outer) / 2f) * radius
    drawArc(
        color = color,
        startAngle = startAngle,
        sweepAngle = 18f,
        useCenter = false,
        topLeft = Offset(center.x - drawRadius, center.y - drawRadius),
        size = Size(drawRadius * 2f, drawRadius * 2f),
        style = Stroke(width = strokeWidth)
    )
}

private fun normalizedToCanvas(position: DartPosition, boardSize: IntSize): Offset {
    val radius = minOf(boardSize.width, boardSize.height) / 2f
    val center = Offset(boardSize.width / 2f, boardSize.height / 2f)
    return Offset(
        x = center.x + position.x * radius,
        y = center.y + position.y * radius
    )
}

private fun canvasToNormalized(offset: Offset, boardSize: IntSize): DartPosition {
    val radius = minOf(boardSize.width, boardSize.height) / 2f
    if (radius == 0f) return DartPosition(0f, 0f)
    val center = Offset(boardSize.width / 2f, boardSize.height / 2f)
    val x = ((offset.x - center.x) / radius)
    val y = ((offset.y - center.y) / radius)

    val r = kotlin.math.sqrt(x * x + y * y)
    if (r <= 1f || r == 0f) {
        return DartPosition(x, y)
    }

    val scale = 1f / r
    return DartPosition(x * scale, y * scale)
}

private fun fallbackPosition(index: Int): DartPosition {
    return when (index % 3) {
        0 -> DartPosition(-0.18f, -0.22f)
        1 -> DartPosition(0.16f, 0.08f)
        else -> DartPosition(0.08f, -0.16f)
    }
}

private fun formatThrow(throwResult: ThrowResult): String {
    return when (throwResult.ring) {
        RingType.DOUBLE -> "D${throwResult.sector}"
        RingType.TRIPLE -> "T${throwResult.sector}"
        RingType.INNER_BULL -> "BULL"
        RingType.OUTER_BULL -> "BULL(25)"
        RingType.MISS -> "MISS"
        else -> throwResult.sector.toString()
    }
}

@Composable
fun GameOverOverlay(
    winner: com.zheng.bulltrack.domain.model.Player?,
    scoreBoard: com.zheng.bulltrack.domain.model.ScoreBoard?,
    onPlayAgain: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(32.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "游戏结束!",
                style = MaterialTheme.typography.headlineMedium
            )

            Spacer(modifier = Modifier.height(16.dp))

            winner?.let {
                Text(
                    text = "${it.name} 获胜!",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            scoreBoard?.let { board ->
                board.players.forEach { playerScore ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(playerScore.player.name)
                        Text(playerScore.score.toString())
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = onPlayAgain,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("再玩一次")
            }
        }
    }
}
