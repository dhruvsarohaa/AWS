import { ApiError, coordinates } from './core.mjs'
export function validateGroups(groups) {
  if (!Array.isArray(groups) || groups.length > 10)
    throw new ApiError('Use up to ten groups.')
  const ids = new Set()
  return groups.map((g) => {
    if (
      !g ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(g.id || '') ||
      ids.has(g.id) ||
      typeof g.name !== 'string' ||
      !g.name.trim() ||
      g.name.length > 80 ||
      !Array.isArray(g.sites) ||
      !g.sites.length ||
      g.sites.length > 5
    )
      throw new ApiError(
        'Each group needs a unique ID, a name and one to five sites.',
      )
    ids.add(g.id)
    const areas = new Set()
    return {
      id: g.id,
      name: g.name.trim(),
      sites: g.sites.map((s) => {
        if (
          !s ||
          typeof s.name !== 'string' ||
          !s.name.trim() ||
          s.name.length > 80 ||
          typeof s.state !== 'string' ||
          s.state.length > 80 ||
          !coordinates(s.latitude, s.longitude) ||
          Math.abs(s.latitude * 10 - Math.round(s.latitude * 10)) > 1e-7 ||
          Math.abs(s.longitude * 10 - Math.round(s.longitude * 10)) > 1e-7
        )
          throw new ApiError(
            'Sites must use named coarse India areas rounded to 0.1 degrees.',
          )
        const id = `${s.latitude.toFixed(1)},${s.longitude.toFixed(1)}`
        if (areas.has(id))
          throw new ApiError('A group cannot contain a duplicate area.')
        areas.add(id)
        return {
          name: s.name.trim(),
          state: s.state.trim(),
          country: 'India',
          latitude: s.latitude,
          longitude: s.longitude,
          confirmed: true,
        }
      }),
    }
  })
}
export async function groupsRoute(method, body, member, store) {
  const pk = `WORKSPACE#${member.workspaceId}`,
    row = await store.get(pk, 'groups')
  if (method === 'GET')
    return { groups: row?.data.groups || [], version: row?.version || 0 }
  if (method !== 'PUT') throw new ApiError('Use GET or PUT for groups.', 405)
  if (!['owner', 'approver'].includes(member.role))
    throw new ApiError('Only an owner or approver can edit shared groups.', 403)
  if (!Number.isSafeInteger(body.version) || body.version < 0)
    throw new ApiError('A group version is required.')
  const groups = validateGroups(body.groups),
    at = new Date().toISOString()
  if (
    !(await store.replaceWithAudit(
      pk,
      'groups',
      { groups },
      body.version,
      `AUDIT#${member.workspaceId}`,
      {
        action: 'groups_saved',
        actor: member.sub,
        role: member.role,
        at,
        details: { count: groups.length },
      },
    ))
  )
    throw new ApiError('Groups changed. Reload before saving.', 409)
  return { groups, version: body.version + 1 }
}
