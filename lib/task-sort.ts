export type TaskSortKey = 'default' | 'points' | 'title' | 'status';
export type TaskSortDirection = 'asc' | 'desc';

export type TaskSort = {
  key: TaskSortKey;
  direction: TaskSortDirection;
};

export const DEFAULT_TASK_SORT: TaskSort = { key: 'default', direction: 'asc' };

export type TaskSortOption = TaskSort & { label: string };

/** Every sort choice offered to the user, in menu order. */
export const TASK_SORT_OPTIONS: TaskSortOption[] = [
  { key: 'default', direction: 'asc', label: 'Default order' },
  { key: 'points', direction: 'desc', label: 'Points: High to Low' },
  { key: 'points', direction: 'asc', label: 'Points: Low to High' },
  { key: 'title', direction: 'asc', label: 'Name: A to Z' },
  { key: 'title', direction: 'desc', label: 'Name: Z to A' },
  { key: 'status', direction: 'asc', label: 'Open first' },
  { key: 'status', direction: 'desc', label: 'Completed first' },
];

export function isSameSort(a: TaskSort, b: TaskSort): boolean {
  return a.key === b.key && a.direction === b.direction;
}

type SortableTask = {
  title: string;
  max_points: number;
};

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

/**
 * Returns a sorted copy of `tasks`. `statusRank` orders tasks by completion
 * (lower = less complete); ascending puts uncompleted tasks first.
 * Ties fall back to title, then to the original (server) order.
 */
export function sortTasks<T extends SortableTask>(
  tasks: T[],
  sort: TaskSort,
  statusRank: (task: T) => number,
): T[] {
  if (sort.key === 'default') return tasks;

  const sign = sort.direction === 'asc' ? 1 : -1;
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);

  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case 'points':
        return (
          sign * ((Number(a.max_points) || 0) - (Number(b.max_points) || 0)) ||
          byTitle(a, b)
        );
      case 'title':
        return sign * byTitle(a, b);
      case 'status':
        return sign * (statusRank(a) - statusRank(b)) || byTitle(a, b);
      default:
        return 0;
    }
  };

  // Array.prototype.sort is stable, so equal items keep server order.
  return [...tasks].sort(compare);
}
