import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { DartBoard } from '../src/ui/components/DartBoard';
import { createThrow } from '../src/domain/game/throws';

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));

test('renders one numbered marker per throw', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <DartBoard
        size={300}
        throws={[createThrow('triple', 20), createThrow('miss')]}
        editable
      />,
    );
  });
  const labels = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .filter(child => typeof child === 'number');
  expect(labels).toEqual([1, 2]);
});

test('a dart detection is unsure about shows ? instead of its number', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <DartBoard
        size={300}
        throws={[createThrow('triple', 20), { ...createThrow('single', 1), needsCheck: true }]}
        editable
      />,
    );
  });
  const labels = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .filter(child => typeof child === 'number' || child === '?');
  expect(labels).toEqual([1, '?']);
});
