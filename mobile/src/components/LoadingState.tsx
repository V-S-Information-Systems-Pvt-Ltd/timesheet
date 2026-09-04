import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { spacing, typography, type Palette } from '../theme';

interface LoadingStateProps {
  message?: string;
  palette: Palette;
}

export function LoadingState({
  message = 'Loading...',
  palette,
}: LoadingStateProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={palette.primary} size="large" />
      <Text style={[styles.text, { color: palette.muted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  text: {
    fontSize: typography.body,
    marginTop: spacing.md,
    fontWeight: '500',
  },
});
