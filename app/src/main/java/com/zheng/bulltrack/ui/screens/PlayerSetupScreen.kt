package com.zheng.bulltrack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zheng.bulltrack.domain.model.GameType
import kotlin.math.roundToInt

@Composable
fun PlayerSetupScreen(
    gameType: GameType,
    onStartGame: (List<String>) -> Unit,
    onBack: () -> Unit
) {
    var playerCount by remember { mutableIntStateOf(2) }
    val playerNames = remember { mutableStateListOf("", "") }

    fun syncPlayerNames(targetCount: Int) {
        while (playerNames.size < targetCount) {
            playerNames.add("")
        }
        while (playerNames.size > targetCount) {
            playerNames.removeAt(playerNames.lastIndex)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "Player Setup",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        Text(
            text = "Players: $playerCount",
            style = MaterialTheme.typography.titleMedium
        )

        Slider(
            value = playerCount.toFloat(),
            onValueChange = { value ->
                val newCount = value.roundToInt().coerceIn(1, 4)
                if (newCount != playerCount) {
                    syncPlayerNames(newCount)
                    playerCount = newCount
                }
            },
            valueRange = 1f..4f,
            steps = 2,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(16.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items((0 until playerCount).toList()) { index ->
                OutlinedTextField(
                    value = playerNames.getOrElse(index) { "" },
                    onValueChange = { value ->
                        if (index < playerNames.size) {
                            playerNames[index] = value
                        }
                    },
                    label = { Text("Player ${index + 1}") },
                    placeholder = { Text("Enter name (optional)") },
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
                Text("Back")
            }

            Button(
                onClick = { onStartGame(playerNames.take(playerCount)) },
                modifier = Modifier.weight(1f)
            ) {
                Text("Start")
            }
        }
    }
}
