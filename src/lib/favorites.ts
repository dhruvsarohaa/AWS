import type { FavoritePlace, Place } from '../types.ts'
import { validPlace } from './contracts.ts'
import { reviewedLocation } from './decision-evidence.ts'

export const FAVORITE_LIMIT = 5

/** A favorite is a coarse, explicit area selection, not retained exact GPS. */
export function createFavorite(place: Place, label: string): FavoritePlace {
  if (!validPlace(place) || !place.confirmed)
    throw new Error('Confirm a valid Indian location before saving an area.')
  const name = label.trim()
  if (!name || name.length > 80)
    throw new Error('A saved-area name must contain 1–80 characters.')
  const coarse: Place = {
    name: place.name.trim(),
    state: place.state.trim(),
    country: 'India',
    latitude: Math.round(place.latitude * 10) / 10,
    longitude: Math.round(place.longitude * 10) / 10,
    confirmed: true,
  }
  return { id: reviewedLocation(coarse).key, label: name, place: coarse }
}

export function upsertFavorite(
  places: FavoritePlace[],
  favorite: FavoritePlace,
): FavoritePlace[] {
  const canonical = createFavorite(favorite.place, favorite.label)
  if (
    canonical.id !== favorite.id ||
    canonical.place.latitude !== favorite.place.latitude ||
    canonical.place.longitude !== favorite.place.longitude ||
    favorite.place.detected ||
    favorite.place.accuracyMeters !== undefined ||
    favorite.place.detectedAt !== undefined
  )
    throw new Error(
      'A saved area must contain only confirmed rounded coordinates.',
    )
  const at = places.findIndex((p) => p.id === favorite.id)
  if (at < 0 && places.length >= FAVORITE_LIMIT)
    throw new Error('Five saved areas are already retained. Delete one first.')
  return at < 0
    ? [...places, canonical]
    : places.map((p, index) => (index === at ? canonical : structuredClone(p)))
}

export function renameFavorite(
  places: FavoritePlace[],
  id: string,
  label: string,
): FavoritePlace[] {
  const current = places.find((p) => p.id === id)
  if (!current) throw new Error('This saved area is no longer retained.')
  return upsertFavorite(places, createFavorite(current.place, label))
}

/** Does not delete decisions, feedback or evidence belonging to the area. */
export function deleteFavorite(places: FavoritePlace[], id: string) {
  return places.filter((p) => p.id !== id).map((p) => structuredClone(p))
}
