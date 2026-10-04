import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { ViewProps as WindowsViewProps } from 'react-native-windows';

interface Overlay {
  children: React.ReactNode;
  onRequestClose?: () => void;
}

interface OverlayHost {
  show: (id: string, overlay: Overlay) => void;
  hide: (id: string) => void;
}

const HostContext = createContext<OverlayHost | null>(null);

/** Keep Windows date dialogs above the entire shell without a native popup window. */
export function WindowsModalHost({ children }: { children: React.ReactNode }) {
  const [overlays, setOverlays] = useState<Map<string, Overlay>>(() => new Map());
  const focusTarget = useRef<React.ElementRef<typeof View>>(null);
  const show = useCallback((id: string, overlay: Overlay) => {
    setOverlays((current) => new Map(current).set(id, overlay));
  }, []);
  const hide = useCallback((id: string) => {
    setOverlays((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);
  const host = useMemo(() => ({ show, hide }), [show, hide]);
  const active = Array.from(overlays.entries()).pop();
  const activeId = active?.[0];
  const overlay = active?.[1];

  useEffect(() => {
    if (activeId) focusTarget.current?.focus();
  }, [activeId]);

  if (Platform.OS !== 'windows') return <>{children}</>;

  const keyboardProps: Pick<WindowsViewProps, 'onKeyDownCapture' | 'keyDownEvents'> = {
    keyDownEvents: [{ code: 'Escape', handledEventPhase: 1 }],
    onKeyDownCapture: (event) => {
      if (event.nativeEvent.key === 'Escape') {
        event.stopPropagation();
        overlay?.onRequestClose?.();
      }
    },
  };

  return (
    <HostContext.Provider value={host}>
      <View style={styles.root}>
        <View
          testID="windows-modal-background"
          style={styles.root}
          pointerEvents={overlay ? 'none' : 'auto'}
          accessibilityElementsHidden={Boolean(overlay)}
          importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}
          onFocus={overlay ? () => focusTarget.current?.focus() : undefined}
        >
          {children}
        </View>
        {overlay ? (
          <View
            {...keyboardProps}
            key={activeId}
            ref={focusTarget}
            testID="windows-modal-overlay"
            accessibilityViewIsModal
            collapsable={false}
            focusable
            style={styles.overlay}
          >
            {overlay.children}
          </View>
        ) : null}
      </View>
    </HostContext.Provider>
  );
}

export function WindowsModal({ visible, children, onRequestClose }: Overlay & { visible: boolean }) {
  const host = useContext(HostContext);
  const id = useId();

  useLayoutEffect(() => {
    if (!host) return;
    if (visible) host.show(id, { children, onRequestClose });
    else host.hide(id);
  }, [host, id, visible, children, onRequestClose]);

  useLayoutEffect(() => () => host?.hide(id), [host, id]);

  if (visible && !host) throw new Error('WindowsModal requires WindowsModalHost in the application shell.');
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
});
