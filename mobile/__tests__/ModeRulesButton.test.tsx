import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import { ModeRulesButton } from '../src/ui/components/ModeRulesButton';
import { modeOptions } from '../src/domain/game/modeCatalog';
import { MODE_RULES } from '../src/domain/game/modeRules';

test('every playable mode has rules', () => {
  modeOptions.forEach(option => {
    expect(MODE_RULES[option.runtimeGameType].length).toBeGreaterThan(0);
  });
});

test('the i button opens the rules and 知道了 closes them', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<ModeRulesButton gameType="game301" title="301" />);
  });
  const root = renderer!.root;
  const modal = () => root.findByType(Modal);
  expect(modal().props.visible).toBe(false);

  ReactTestRenderer.act(() => root.findByProps({ accessibilityLabel: '玩法规则' }).props.onPress());
  expect(modal().props.visible).toBe(true);

  // The nearest ancestor of the 知道了 label that handles presses.
  let done: ReactTestRenderer.ReactTestInstance | null = root.findAll(
    node => node.type === Text && node.props.children === '知道了',
  )[0];
  while (done && typeof done.props.onPress !== 'function') {
    done = done.parent;
  }
  ReactTestRenderer.act(() => done!.props.onPress());
  expect(modal().props.visible).toBe(false);
});
