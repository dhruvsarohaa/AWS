import type { FavoritePlace, Place } from '../types.ts'
export type LocalGroup = { id: string; name: string; placeIds: string[] }
export type SharedGroup = { id: string; name: string; sites: Place[] }
export function validLocalGroups(
  value: unknown,
  favorites: FavoritePlace[],
): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > 10) return false
  const ids = new Set<string>()
  return value.every((g) => {
    if (
      !g ||
      typeof g.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(g.id) ||
      ids.has(g.id) ||
      typeof g.name !== 'string' ||
      !g.name.trim() ||
      g.name.length > 80 ||
      !Array.isArray(g.placeIds) ||
      !g.placeIds.length ||
      g.placeIds.length > 5 ||
      new Set(g.placeIds).size !== g.placeIds.length ||
      !g.placeIds.every(
        (id: unknown) =>
          typeof id === 'string' && favorites.some((f) => f.id === id),
      )
    )
      return false
    ids.add(g.id)
    return true
  })
}
