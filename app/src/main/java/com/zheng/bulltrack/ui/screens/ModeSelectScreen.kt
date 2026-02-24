package com.zheng.bulltrack.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.zheng.bulltrack.domain.model.GameType

@Composable
fun ModeSelectScreen(
    onModeSelected: (GameType) -> Unit,
    onBack: () -> Unit
) {
    var selectedMode by remember { mutableStateOf<GameType?>(null) }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "选择游戏模式",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = 24.dp)
        )
        
        Column(modifier = Modifier.selectableGroup()) {
            GameType.entries.forEach { gameType ->
                val modeName = when (gameType) {
                    GameType.HIGH_SCORE -> "高分赛"
                    GameType.GAME_301 -> "301"
                    GameType.GAME_501 -> "501"
                    GameType.CRICKET -> "Cricket"
                }
                
                val description = when (gameType) {
                    GameType.HIGH_SCORE -> "10轮比赛，累计得分最高者获胜"
                    GameType.GAME_301 -> "从301分开始，先归零者获胜（需双倍区结束）"
                    GameType.GAME_501 -> "从501分开始，先归零者获胜（需双倍区结束）"
                    GameType.CRICKET -> "击中15-20及靶心，全部关闭且得分最高者获胜"
                }
                
                ModeSelectItem(
                    modeName = modeName,
                    description = description,
                    isSelected = selectedMode == gameType,
                    onClick = { selectedMode = gameType }
                )
            }
        }
        
        Spacer(modifier = Modifier.weight(1f))
        
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = onBack,
                modifier = Modifier.weight(1f)
            ) {
                Text("返回")
            }
            
            Button(
                onClick = { selectedMode?.let { onModeSelected(it) } },
                enabled = selectedMode != null,
                modifier = Modifier.weight(1f)
            ) {
                Text("下一步")
            }
        }
    }
}

@Composable
private fun ModeSelectItem(
    modeName: String,
    description: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .selectable(
                selected = isSelected,
                onClick = onClick,
                role = Role.RadioButton
            ),
        color = if (isSelected) 
            MaterialTheme.colorScheme.primaryContainer 
        else 
            MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = modeName,
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
