package com.zheng.bulltrack.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zheng.bulltrack.domain.model.GameType

@Composable
fun PlayerSetupScreen(
    gameType: GameType,
    onStartGame: (List<String>) -> Unit,
    onBack: () -> Unit
) {
    var playerCount by remember { mutableStateOf(2) }
    val playerNames = remember { mutableStateListOf<String>() }
    
    LaunchedEffect(playerCount) {
        while (playerNames.size < playerCount) {
            playerNames.add("")
        }
        while (playerNames.size > playerCount) {
            playerNames.removeLast()
        }
    }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "玩家设置",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = 16.dp)
        )
        
        Text(
            text = "玩家人数: $playerCount",
            style = MaterialTheme.typography.titleMedium
        )
        
        Slider(
            value = playerCount.toFloat(),
            onValueChange = { playerCount = it.toInt() },
            valueRange = 1f..4f,
            steps = 2,
            modifier = Modifier.fillMaxWidth()
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(playerNames.indices.toList()) { index ->
                OutlinedTextField(
                    value = playerNames[index],
                    onValueChange = { playerNames[index] = it },
                    label = { Text("玩家 ${index + 1}") },
                    placeholder = { Text("输入名字（可选）") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
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
                onClick = { onStartGame(playerNames.toList()) },
                modifier = Modifier.weight(1f)
            ) {
                Text("开始游戏")
            }
        }
    }
}
