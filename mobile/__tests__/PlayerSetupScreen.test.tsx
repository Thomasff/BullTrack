import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

const mockStartGameSession = jest.fn();
jest.mock('../src/application/services/liveRoundService', () => ({
  startGameSession: (...args: unknown[]) => mockStartGameSession(...args),
}));
jest.mock('../src/application/services/historyRepository', () => ({
  listKnownPlayerNames: async () => [],
}));

import { PlayerSetupScreen } from '../src/ui/screens/PlayerSetupScreen';

const pressText = (root: ReactTestRenderer.ReactTestInstance, label: string) => {
  const text = root.findAll(node => node.type === Text && node.props.children === label)[0];
  let node: ReactTestRenderer.ReactTestInstance | null = text;
  // The nearest ancestor that handles presses (Pressable).
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return ReactTestRenderer.act(() => node!.props.onPress());
};

test('team setup starts a game with one team index per player', async () => {
  const navigate = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  // Async act also flushes the history-player load started on mount.
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PlayerSetupScreen
        navigation={{ navigate } as never}
        route={{ key: 'setup', name: 'PlayerSetup', params: { modeOptionId: 'x01-501' } } as never}
      />,
    );
  });
  const root = renderer!.root;

  await pressText(root, '组队');
  await pressText(root, '+ 添加队员'); // second member for A 队
  const inputs = root.findAllByType(TextInput);
  expect(inputs).toHaveLength(3);
  await ReactTestRenderer.act(() => inputs[0].props.onChangeText('Alice'));
  await ReactTestRenderer.act(() => inputs[2].props.onChangeText('Carol'));
  await pressText(root, '开始');

  expect(mockStartGameSession).toHaveBeenCalledWith(
    expect.any(String),
    ['Alice', '玩家 2', 'Carol'],
    expect.any(String),
    [0, 0, 1],
  );
  expect(navigate).toHaveBeenCalledWith('Game');
});
