import { STATUS_ORDER, type Columns, type Status } from '../types/board';

export const createEmptyColumns = (): Columns =>
  STATUS_ORDER.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {} as Columns);

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const findCardStatus = (columns: Columns, cardId: string): Status | null => {
  for (const status of STATUS_ORDER) {
    if (columns[status].includes(cardId)) return status;
  }
  return null;
};

export const moveCard = (
  columns: Columns,
  cardId: string,
  from: Status,
  to: Status,
  toIndex: number,
): Columns => {
  if (from === to) {
    const list = [...columns[from]];
    const fromIndex = list.indexOf(cardId);
    if (fromIndex === -1) return columns;

    const boundedIndex = clamp(toIndex, 0, Math.max(0, list.length - 1));
    if (boundedIndex === fromIndex) return columns;

    list.splice(fromIndex, 1);
    list.splice(boundedIndex, 0, cardId);

    return { ...columns, [from]: list };
  }

  const source = [...columns[from]];
  const fromIndex = source.indexOf(cardId);
  if (fromIndex === -1) return columns;

  source.splice(fromIndex, 1);

  const target = [...columns[to]];
  const boundedIndex = clamp(toIndex, 0, target.length);
  target.splice(boundedIndex, 0, cardId);

  return {
    ...columns,
    [from]: source,
    [to]: target,
  };
};
