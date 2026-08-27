import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type IconName =
  | 'home'
  | 'clock'
  | 'plus'
  | 'reports'
  | 'calendar'
  | 'bell'
  | 'team'
  | 'profile'
  | 'folder'
  | 'tag'
  | 'search'
  | 'close'
  | 'check'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'offline'
  | 'lock'
  | 'more'
  | 'trash'
  | 'filter';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Universal vector-inspired icon component for React Native.
 * Renders crisp, scalable glyphs with full theming support and accessibility isolation.
 */
export const Icon = React.memo(function IconComponent({
  name,
  size = 20,
  color = '#E4282F',
  style,
}: IconProps) {
  const renderGlyph = () => {
    switch (name) {
      case 'home':
        return '⌂';
      case 'clock':
        return '◷';
      case 'plus':
        return '+';
      case 'reports':
        return '▦';
      case 'calendar':
        return '▤';
      case 'bell':
        return '⍾';
      case 'team':
        return '⚲';
      case 'profile':
        return '●';
      case 'folder':
        return '▱';
      case 'tag':
        return '◊';
      case 'search':
        return '⚲';
      case 'close':
        return '✕';
      case 'check':
        return '✓';
      case 'chevron-left':
        return '‹';
      case 'chevron-right':
        return '›';
      case 'chevron-down':
        return '▾';
      case 'offline':
        return '⌁';
      case 'lock':
        return '⚿';
      case 'more':
        return '⋯';
      case 'trash':
        return '✕';
      case 'filter':
        return '⧩';
      default:
        return '•';
    }
  };

  return (
    <View
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
      style={[styles.container, { width: size, height: size }, style]}
    >
      <Text
        style={[
          styles.glyph,
          {
            fontSize: size * 0.9,
            lineHeight: size,
            color,
          },
        ]}
      >
        {renderGlyph()}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    textAlign: 'center',
    fontWeight: '700',
    includeFontPadding: false,
  },
});
