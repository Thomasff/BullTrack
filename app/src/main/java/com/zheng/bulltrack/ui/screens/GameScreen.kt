package com.zheng.bulltrack.ui.screens

import android.view.ViewGroup
import androidx.camera.core.Preview
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.zheng.bulltrack.application.state.GameState
import com.zheng.bulltrack.application.state.GameUiState
import com.zheng.bulltrack.camera.CameraXManager

@Composable
fun GameScreen(
    uiState: GameUiState,
    onCaptureBefore: () -> Unit,
    onCaptureAfter: () -> Unit,
    onConfirmResult: () -> Unit,
    onManualAdjust: (Int, Int, Int) -> Unit,
    onReset: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    
    var cameraManager by remember { mutableStateOf<CameraXManager?>(null) }
    var preview by remember { mutableStateOf<Preview?>(null) }
    
    LaunchedEffect(Unit) {
        cameraManager = CameraXManager(lifecycleOwner).also {
            it.initialize(context)
        }
    }
    
    Column(
        modifier = Modifier.fillMaxSize()
    ) {
        GameInfoHeader(
            currentPlayer = uiState.currentPlayer,
            roundNumber = uiState.roundNumber,
            scoreBoard = uiState.scoreBoard
        )
        
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            AndroidView(
                factory = { ctx ->
                    PreviewView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                        
                        preview = Preview.Builder().build().also {
                            it.setSurfaceProvider(surfaceProvider)
                        }
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
            
            when (uiState.currentState) {
                GameState.WAITING_FOR_THROW -> {
                    CaptureButton(
                        text = "拍摄空靶",
                        onClick = onCaptureBefore,
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }
                GameState.CAPTURING_START -> {
                    CaptureButton(
                        text = "拍摄投掷后",
                        onClick = onCaptureAfter,
                        modifier = Modifier.align(Alignment.BottomCenter)
                    )
                }
                GameState.PROCESSING -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                GameState.SHOWING_RESULT -> {
                    ResultOverlay(
                        throws = uiState.currentThrows,
                        roundScore = uiState.currentRoundResult?.roundScore ?: 0,
                        onConfirm = onConfirmResult,
                        onManualAdjust = onManualAdjust,
                        modifier = Modifier.align(Alignment.BottomCenter)
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
                else -> {}
            }
            
            uiState.errorMessage?.let { error ->
                Snackbar(
                    modifier = Modifier.align(Alignment.BottomCenter)
                ) {
                    Text(error)
                }
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
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
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
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
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
fun CaptureButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    FilledTonalButton(
        onClick = onClick,
        modifier = modifier
            .padding(32.dp)
            .size(80.dp),
        shape = CircleShape
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Default.CameraAlt,
                contentDescription = null,
                modifier = Modifier.size(32.dp)
            )
            Text(text, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
fun ResultOverlay(
    throws: List<com.zheng.bulltrack.domain.model.ThrowResult>,
    roundScore: Int,
    onConfirm: () -> Unit,
    onManualAdjust: (Int, Int, Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "识别结果",
                style = MaterialTheme.typography.titleMedium
            )
            
            Spacer(modifier = Modifier.height(8.dp))
            
            throws.forEachIndexed { index, throwResult ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("飞镖 ${index + 1}")
                    Text(
                        text = when (throwResult.ring) {
                            com.zheng.bulltrack.domain.model.RingType.DOUBLE -> "D${throwResult.sector}"
                            com.zheng.bulltrack.domain.model.RingType.TRIPLE -> "T${throwResult.sector}"
                            com.zheng.bulltrack.domain.model.RingType.INNER_BULL -> "BULL"
                            com.zheng.bulltrack.domain.model.RingType.OUTER_BULL -> "BULL(25)"
                            else -> throwResult.sector.toString()
                        }
                    )
                    Text(throwResult.score.toString())
                }
            }
            
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("本轮得分", style = MaterialTheme.typography.titleMedium)
                Text(
                    roundScore.toString(),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { /* TODO: Manual adjust */ },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("修改")
                }
                
                Button(
                    onClick = onConfirm,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("确认")
                }
            }
        }
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
