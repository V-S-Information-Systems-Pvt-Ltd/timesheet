// mobile/src/components/WorkspaceBrand.tsx
// Reusable authenticated workspace identity: logo + name, rendered on the wide
// navigation rail and in the compact authenticated-shell header above narrow
// screen content (R3 of MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN).
//
// Failure recovery contract:
//  * a failed remote logo falls back to the bundled asset and never logs the
//    URL;
//  * when branding.logoUrl changes (save / reset / reconnect) the failed state
//    is cleared and the new URL is retried immediately, without remount or
//    sign-in — both a keyed Image instance and a URL-scoped effect enforce
//    this;
//  * on reset the default name, primary color, and bundled logo render at once
//    because the component only reads the current `branding` prop.

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius, type Palette } from '../theme';
import type { WorkspaceBranding } from '../api/contracts';

const BUNDLED_LOGO = require('../assets/vsis-logo.jpg');

interface WorkspaceBrandProps {
  branding?: WorkspaceBranding | null;
  palette: Palette;
  /** Compact authenticated-shell header variant for narrow screens. */
  compact?: boolean;
}

export function WorkspaceBrand({ branding, palette, compact = false }: WorkspaceBrandProps) {
  const logoUrl = branding?.logoUrl?.trim() || null;
  const workspaceName = branding?.appName?.trim() || 'VSIS Timesheet';
  const [failedLogoUrl, setFailedLogoUrl] = React.useState<string | null>(null);

  // URL-scoped reset: any change of branding.logoUrl clears the failed state so
  // a corrected URL retries immediately in the same mounted session.
  React.useEffect(() => {
    setFailedLogoUrl(null);
  }, [logoUrl]);

  const showRemote = logoUrl !== null && logoUrl !== failedLogoUrl;
  const source = showRemote ? { uri: logoUrl as string } : BUNDLED_LOGO;

  return (
    <View style={compact ? styles.compactContainer : styles.railContainer} testID="workspace-brand">
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel={`${workspaceName} logo`}
        key={logoUrl ?? 'bundled'}
        onError={() => {
          // Only the URL that failed is remembered; the fallback asset never
          // triggers an error loop because it replaces the source entirely.
          setFailedLogoUrl(logoUrl);
        }}
        resizeMode="contain"
        source={source}
        style={compact ? styles.compactLogo : styles.railLogo}
      />
      <Text
        numberOfLines={compact ? 1 : 2}
        style={[compact ? styles.compactName : styles.railName, { color: palette.muted }]}
      >
        {workspaceName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  railContainer: {
    alignItems: 'flex-start',
  },
  railLogo: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xs,
    height: 36,
    marginBottom: spacing.sm,
    width: 88,
  },
  railName: {
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  compactContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  compactLogo: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xs,
    height: 28,
    width: 64,
  },
  compactName: {
    flexShrink: 1,
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});