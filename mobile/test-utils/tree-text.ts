import type ReactTestRenderer from 'react-test-renderer';

type Node = ReactTestRenderer.ReactTestRendererNode | ReactTestRenderer.ReactTestRendererNode[] | null;

/** Concatenated visible text of a rendered tree (adjacent JSX fragments joined). */
export function treeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  const walk = (node: Node): string => {
    if (node === null) return '';
    if (Array.isArray(node)) return node.map(walk).join('');
    if (typeof node === 'string') return node;
    return (node.children ?? []).map(walk).join('');
  };
  return walk(renderer.toJSON());
}
