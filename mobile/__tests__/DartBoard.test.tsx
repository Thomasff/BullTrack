import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { DartBoard } from '../src/ui/components/DartBoard';
import { createThrow } from '../src/domain/game/throws';

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
