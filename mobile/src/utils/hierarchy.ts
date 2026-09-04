export interface HierarchyTreeNode<T> {
  item: T;
  children: HierarchyTreeNode<T>[];
  depth: number;
  isOrphan?: boolean;
  hasCycle?: boolean;
}

export interface HierarchyTreeResult<T> {
  roots: HierarchyTreeNode<T>[];
  orphanCount: number;
  totalCount: number;
}

function getManagerId<T extends { id: string; managerId?: string | null }>(
  item: T
): string | null {
  return item.managerId ?? null;
}

function getSortKey<T extends { name?: string; email?: string }>(item: T): string {
  return (item.name || item.email || '').trim().toLowerCase();
}

function getHierarchyRoleRank<T extends { hierarchyRole?: string }>(item: T): number {
  const role = item.hierarchyRole ?? 'user';
  switch (role) {
    case 'manager':
      return 1;
    case 'team_lead':
      return 2;
    case 'engineer':
      return 3;
    case 'user':
    default:
      return 4;
  }
}

/**
 * Pure projection that builds a hierarchical tree from a flat list of user profiles.
 * - Handles top-level roots (no manager or manager not in list)
 * - Sorts siblings stably by hierarchy role rank (Manager -> Lead -> Engineer -> User) then name
 * - Handles circular reporting references defensively without infinite recursion
 * - Captures detached cycle orphans at root with cycle annotation so no profiles are dropped
 */
export function buildHierarchyTree<
  T extends {
    id: string;
    name?: string;
    email?: string;
    managerId?: string | null;
    hierarchyRole?: string;
  }
>(items: readonly T[]): HierarchyTreeResult<T> {
  const byId = new Map<string, T>();
  const childrenMap = new Map<string, T[]>();

  for (const item of items) {
    byId.set(item.id, item);
  }

  const sortItems = (a: T, b: T): number => {
    const rankA = getHierarchyRoleRank(a);
    const rankB = getHierarchyRoleRank(b);
    if (rankA !== rankB) return rankA - rankB;
    return getSortKey(a).localeCompare(getSortKey(b));
  };

  // Populate children mapping
  for (const item of items) {
    const mId = getManagerId(item);
    if (mId && byId.has(mId)) {
      const existing = childrenMap.get(mId) || [];
      existing.push(item);
      childrenMap.set(mId, existing);
    }
  }

  // Sort child arrays
  for (const children of childrenMap.values()) {
    children.sort(sortItems);
  }

  const candidateRoots: T[] = [];
  let orphanCount = 0;

  for (const item of items) {
    const mId = getManagerId(item);
    if (!mId) {
      candidateRoots.push(item);
    } else if (!byId.has(mId)) {
      candidateRoots.push(item);
      orphanCount++;
    }
  }

  candidateRoots.sort(sortItems);

  const visitedGlobal = new Set<string>();

  function buildNode(item: T, depth: number, branchPath: Set<string>, isOrphan = false): HierarchyTreeNode<T> {
    visitedGlobal.add(item.id);
    const nextBranch = new Set(branchPath).add(item.id);
    const rawChildren = childrenMap.get(item.id) || [];
    const children: HierarchyTreeNode<T>[] = [];

    for (const child of rawChildren) {
      if (nextBranch.has(child.id)) {
        // Cycle detected
        children.push({
          item: child,
          children: [],
          depth: depth + 1,
          hasCycle: true,
        });
        continue;
      }
      if (visitedGlobal.has(child.id)) {
        continue;
      }
      children.push(buildNode(child, depth + 1, nextBranch));
    }

    return {
      item,
      children,
      depth,
      ...(isOrphan ? { isOrphan: true } : {}),
    };
  }

  const roots: HierarchyTreeNode<T>[] = [];
  for (const rootItem of candidateRoots) {
    const mId = getManagerId(rootItem);
    const isOrphan = Boolean(mId && !byId.has(mId));
    roots.push(buildNode(rootItem, 0, new Set(), isOrphan));
  }

  // Attach any unvisited cycle members
  for (const item of items) {
    if (!visitedGlobal.has(item.id)) {
      orphanCount++;
      roots.push(buildNode(item, 0, new Set(), true));
    }
  }

  roots.sort((a, b) => sortItems(a.item, b.item));

  return {
    roots,
    orphanCount,
    totalCount: items.length,
  };
}
