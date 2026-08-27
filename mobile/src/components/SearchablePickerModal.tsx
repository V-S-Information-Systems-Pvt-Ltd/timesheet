import React, { useMemo, useState, useCallback } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon } from './Icon';

export interface PickerItem {
  id: string;
  name: string;
  subtitle?: string;
  badge?: string;
}

interface SearchablePickerModalProps {
  visible: boolean;
  title: string;
  items: PickerItem[];
  selectedId: string;
  onSelect: (item: PickerItem) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  palette: Palette;
}

export function SearchablePickerModal({
  visible,
  title,
  items,
  selectedId,
  onSelect,
  onClose,
  searchPlaceholder = 'Search...',
  palette,
}: SearchablePickerModalProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase().trim();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        (item.badge && item.badge.toLowerCase().includes(q))
    );
  }, [items, search]);

  const handleSelect = useCallback(
    (item: PickerItem) => {
      onSelect(item);
      setSearch('');
      onClose();
    },
    [onSelect, onClose]
  );

  const handleClose = useCallback(() => {
    setSearch('');
    onClose();
  }, [onClose]);

  const keyExtractor = useCallback((item: PickerItem) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: PickerItem }) => {
      const isSelected = item.id === selectedId;

      return (
        <PressableScale
          accessibilityLabel={`${item.name}${item.badge ? `, ${item.badge}` : ''}${isSelected ? ', selected' : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          onPress={() => handleSelect(item)}
          style={[
            styles.itemRow,
            {
              backgroundColor: isSelected ? palette.badgeBg : palette.card,
              borderColor: isSelected ? colors.primary : palette.border,
            },
          ]}
        >
          <View style={styles.itemTextContainer}>
            <View style={styles.itemNameRow}>
              <Text
                numberOfLines={1}
                style={[
                  styles.itemName,
                  { color: isSelected ? colors.primary : palette.foreground },
                ]}
              >
                {item.name}
              </Text>
              {item.badge ? (
                <View style={[styles.itemBadge, { backgroundColor: isSelected ? colors.primary : palette.badgeBg }]}>
                  <Text
                    style={[
                      styles.itemBadgeText,
                      { color: isSelected ? colors.onPrimary : colors.primary },
                    ]}
                  >
                    {item.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            {item.subtitle ? (
              <Text numberOfLines={1} style={[styles.itemSubtitle, { color: palette.muted }]}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
          {isSelected ? (
            <Text style={[styles.checkmark, { color: colors.primary }]}>✓</Text>
          ) : null}
        </PressableScale>
      );
    },
    [handleSelect, palette, selectedId]
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      transparent={false}
      visible={visible}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: palette.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: palette.border }]}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.title, { color: palette.foreground }]}>{title}</Text>
            <Pressable
              accessibilityLabel="Close picker"
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={handleClose}
              style={styles.closeButton}
            >
              <Text style={[styles.closeButtonText, { color: colors.primary }]}>Done</Text>
            </Pressable>
          </View>

          {/* Search Box */}
          <View
            style={[
              styles.searchBar,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <Icon color={palette.placeholder} name="search" size={16} style={styles.searchIcon} />
            <TextInput
              accessibilityLabel={searchPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setSearch}
              placeholder={searchPlaceholder}
              placeholderTextColor={palette.placeholder}
              returnKeyType="done"
              style={[styles.searchInput, { color: palette.foreground }]}
              value={search}
            />
            {search ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => setSearch('')}
                style={styles.clearSearchBtn}
              >
                <Icon color={palette.muted} name="close" size={14} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* List */}
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filtered}
          initialNumToRender={12}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon color={palette.muted} name="folder" size={32} style={styles.emptyIcon} />
              <Text style={[styles.emptyText, { color: palette.muted }]}>
                {search ? `No results found for "${search}"` : 'No items available.'}
              </Text>
            </View>
          }
          maxToRenderPerBatch={10}
          renderItem={renderItem}
          windowSize={5}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '800',
  },
  closeButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body,
    height: '100%',
    padding: 0,
  },
  clearSearchBtn: {
    padding: spacing.xs,
  },
  clearSearchText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 52,
    ...shadows.sm,
  },
  itemTextContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  itemName: {
    fontSize: typography.body,
    fontWeight: '700',
    flexShrink: 1,
  },
  itemBadge: {
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  itemBadgeText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
  itemSubtitle: {
    fontSize: typography.caption,
    marginTop: 2,
  },
  checkmark: {
    fontSize: 18,
    fontWeight: '800',
    marginLeft: spacing.xs,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: typography.body,
    textAlign: 'center',
  },
});
