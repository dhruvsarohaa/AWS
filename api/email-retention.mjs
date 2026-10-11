import { revokeSubscription, subPk } from './subscriptions.mjs'
// Owner references retain workspace scope after membership revocation or reassignment.
export async function eraseWorkspaceEmail(workspace, store, members = []) {
  const owners = new Set(members),
    partition = `EMAIL_OWNERS#${workspace}`
  let cursor = null
  do {
    const page = await store.range(partition, '', '~', 100, cursor)
    for (const row of page.rows) owners.add(row.sk)
    cursor = page.after
  } while (cursor)
  let erased = 0
  for (const owner of owners) {
    const subscription = await store.get(subPk(owner))
    if (subscription?.data.workspaceId === workspace) {
      if (
        !(await revokeSubscription(subscription, store, 'subscription_erased'))
      )
        throw new Error(
          'Subscription changed during erasure. Retry after account access is stopped.',
        )
      await store.delete(subscription.pk, subscription.sk)
      erased++
    }
    cursor = null
    do {
      const page = await store.range(`OUTBOX#${owner}`, '', '~', 100, cursor)
      for (const row of page.rows)
        if (row.data.workspaceId === workspace) {
          await store.delete(row.pk, row.sk)
          erased++
        }
      cursor = page.after
    } while (cursor)
    await store.delete(partition, owner)
  }
  // Due rows contain only owner/event IDs; remove orphaned references too.
  cursor = null
  do {
    const page = await store.range('DUE#OUTBOX', '', '~', 100, cursor)
    for (const row of page.rows)
      if (
        owners.has(row.data.sub) &&
        !(await store.get(`OUTBOX#${row.data.sub}`, row.data.id))
      )
        await store.delete(row.pk, row.sk)
    cursor = page.after
  } while (cursor)
  return erased
}
