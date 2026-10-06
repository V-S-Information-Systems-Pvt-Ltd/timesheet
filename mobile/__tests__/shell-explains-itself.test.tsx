import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppErrorBoundary } from '../App';
import { Text } from 'react-native';
import { getPalette } from '../src/theme';

jest.mock('../src/api/client');

describe('the shell explains itself (R4)', () => {
  it('renders the error boundary in dark mode when isDarkMode is true', () => {
    const palette = getPalette(true);
    function Boom(): never {
      throw new Error('render boom');
    }
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppErrorBoundary isDarkMode>
          <Boom />
        </AppErrorBoundary>
      );
    });
    const texts = renderer!.root
      .findAllByType(Text)
      .flatMap((node) => (node.props as { children?: unknown }).children)
      .filter((child): child is string => typeof child === 'string');
    expect(texts.some((t) => t.includes('Something went wrong'))).toBe(true);
    // Dark palette is applied to the container (assert structurally: the
    // boundary reads the prop, so the container's background is the dark
    // background).
    const container = renderer!.root.findByProps({ testID: 'error-boundary-container' });
    expect(container.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: palette.background })])
    );
  });
});
