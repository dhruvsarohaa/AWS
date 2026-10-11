import { getStore } from './store.mjs'
import { emailHash } from './subscriptions.mjs'
export async function reconcileDelivery(detail, store) {
  const type = detail?.eventType || detail?.notificationType,
    tags = detail?.mail?.tags,
    tag = (name) => tags?.[name]?.[0]
  if (
    ![
      'Delivery',
      'Bounce',
      'Complaint',
      'Reject',
      'Rendering Failure',
    ].includes(type) ||
    !tag('airday-owner')
  )
    return
  const owner = tag('airday-owner')
  if (typeof owner !== 'string' || owner.length > 100) return
  const kind = tag('airday-kind'),
    id = kind === 'review' ? tag('airday-event') : tag('airday-decision'),
    workspace = tag('airday-workspace')
  if (
    typeof id !== 'string' ||
    id.length > 100 ||
    (kind !== 'review' && kind !== 'approval') ||
    (kind === 'approval' &&
      (typeof workspace !== 'string' || workspace.length > 100))
  )
    return
  const pk = kind === 'review' ? `OUTBOX#${owner}` : `DECISIONS#${workspace}`,
    recipients = detail.mail.destination
  if (
    typeof detail.mail.messageId !== 'string' ||
    !Array.isArray(recipients) ||
    recipients.length !== 1 ||
    typeof recipients[0] !== 'string'
  )
    return
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.get(pk, id)
    if (
      !row ||
      (row.data.messageId && row.data.messageId !== detail.mail.messageId) ||
      row.data.destinationHash !== emailHash(recipients[0]) ||
      (kind === 'approval' && row.data.recipientSub !== owner)
    )
      return
    const current = kind === 'review' ? row.data.status : row.data.delivery
    if (
      ![
        'unknown',
        'delivery_unknown',
        'accepted',
        'sent',
        'delivered',
        'failed',
        'suppressed',
      ].includes(current)
    )
      return
    if (type === 'Bounce' || type === 'Complaint')
      await store.put(`SUPPRESSED#${emailHash(recipients[0])}`, 'current', {
        reason: type.toLowerCase(),
        at: new Date().toISOString(),
      })
    const status =
      type === 'Delivery'
        ? 'delivered'
        : type === 'Bounce' || type === 'Complaint'
          ? 'suppressed'
          : 'failed'
    if (
      current === 'suppressed' ||
      (current === 'failed' && status !== 'suppressed') ||
      current === status
    )
      return
    if (
      await store.replace(
        pk,
        row.sk,
        {
          ...row.data,
          [kind === 'review' ? 'status' : 'delivery']: status,
          messageId: detail.mail.messageId,
          feedbackAt: new Date().toISOString(),
        },
        row.version,
      )
    )
      return
  }
  // Let EventBridge retry a contended update instead of losing a terminal event.
  throw new Error('Delivery feedback changed concurrently')
}
export async function handler(event) {
  if (
    event.source !== 'aws.ses' ||
    event.account !== process.env.AWS_ACCOUNT_ID
  )
    throw new Error('Untrusted delivery event')
  if (
    event.detail?.mail?.tags?.['ses:configuration-set']?.[0] !==
    process.env.SES_CONFIGURATION_SET
  )
    throw new Error('Unexpected SES configuration set')
  await reconcileDelivery(event.detail, await getStore())
  return { ok: true }
}
