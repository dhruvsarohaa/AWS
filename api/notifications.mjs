import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { getStore } from './store.mjs'
import { deliverReview } from './outbox.mjs'
import { emailHash } from './subscriptions.mjs'

export async function deliver(
  job,
  store,
  sender = process.env.NOTIFICATION_SENDER,
  send,
) {
  if (
    job.type !== 'notification' ||
    !job.workspaceId ||
    !job.decisionId ||
    !job.recipientSub
  )
    throw new Error('Notification job is invalid')
  const [decision, member, preferences] = await Promise.all([
    store.get(`DECISIONS#${job.workspaceId}`, job.decisionId),
    store.get('MEMBERS', job.recipientSub),
    store.get(`PREFERENCES#${job.recipientSub}`),
  ])
  if (
    !decision ||
    decision.data.approval !== 'approved' ||
    !preferences?.data?.enabled ||
    !member?.data.emailVerified ||
    !['owner', 'approver', 'reviewer'].includes(member.data.role) ||
    member.data.workspaceId !== job.workspaceId
  )
    return
  if (
    ['reopened', 'superseded'].includes(decision.data.lifecycle) ||
    (await store.get(`SUPPRESSED#${emailHash(member.data.email)}`)) ||
    ['sent', 'accepted', 'delivered', 'suppressed'].includes(
      decision.data.delivery,
    ) ||
    decision.data.delivery === 'delivery_unknown'
  )
    return
  if (!sender) {
    await store.replace(
      `DECISIONS#${job.workspaceId}`,
      job.decisionId,
      { ...decision.data, delivery: 'not_configured' },
      decision.version,
    )
    return
  }
  if (
    !(await store.claim(
      `DELIVERY#${job.workspaceId}#${job.decisionId}#${job.recipientSub}`,
      600,
    ))
  )
    return
  if (
    !(await store.increment(
      `EMAIL_QUOTA#${new Date().toISOString().slice(0, 10)}`,
      50,
      Math.floor(Date.now() / 1000) + 172800,
    ))
  )
    throw new Error('Daily email budget reached')
  const current = await store.get(
    `DECISIONS#${job.workspaceId}`,
    job.decisionId,
  )
  if (
    !current ||
    current.data.approval !== 'approved' ||
    ['reopened', 'superseded'].includes(current.data.lifecycle) ||
    current.data.delivery === 'delivery_unknown' ||
    ['accepted', 'delivered', 'suppressed'].includes(current.data.delivery)
  )
    return
  if (
    !(await store.replace(
      `DECISIONS#${job.workspaceId}`,
      job.decisionId,
      {
        ...current.data,
        delivery: 'delivery_unknown',
        destinationHash: emailHash(member.data.email),
        recipientSub: job.recipientSub,
      },
      current.version,
    ))
  )
    throw new Error('Decision changed before delivery')
  const [lastDecision, lastMember, lastPreferences, suppression] =
    await Promise.all([
      store.get(`DECISIONS#${job.workspaceId}`, job.decisionId),
      store.get('MEMBERS', job.recipientSub),
      store.get(`PREFERENCES#${job.recipientSub}`),
      store.get(`SUPPRESSED#${emailHash(member.data.email)}`),
    ])
  if (
    !lastDecision ||
    lastDecision.data.delivery !== 'delivery_unknown' ||
    lastDecision.data.approval !== 'approved' ||
    ['reopened', 'superseded'].includes(lastDecision.data.lifecycle) ||
    !lastPreferences?.data.enabled ||
    !lastMember?.data.emailVerified ||
    !['owner', 'approver', 'reviewer'].includes(lastMember.data.role) ||
    lastMember.data.workspaceId !== job.workspaceId ||
    emailHash(lastMember.data.email) !== emailHash(member.data.email) ||
    suppression
  ) {
    if (lastDecision?.data.delivery === 'delivery_unknown')
      await store.replace(
        lastDecision.pk,
        lastDecision.sk,
        { ...lastDecision.data, delivery: 'suppressed' },
        lastDecision.version,
      )
    return
  }
  // SES has no idempotency token. Unknown delivery is not retried automatically.
  const payload = {
    ...(process.env.SES_CONFIGURATION_SET
      ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET }
      : {}),
    EmailTags: [
      { Name: 'airday-owner', Value: job.recipientSub },
      { Name: 'airday-kind', Value: 'approval' },
      { Name: 'airday-workspace', Value: job.workspaceId },
      { Name: 'airday-decision', Value: job.decisionId },
    ],
    FromEmailAddress: sender,
    Destination: { ToAddresses: [lastMember.data.email] },
    Content: {
      Simple: {
        Subject: {
          Data: `Airday: approved plan for ${decision.data.activity}`,
          Charset: 'UTF-8',
        },
        Body: {
          Text: {
            Charset: 'UTF-8',
            Data: `Approved action: ${decision.data.choice}\nActivity: ${decision.data.activity}\nDate: ${decision.data.date} (IST)\nReason: ${decision.data.reason}\nEvidence: ${decision.data.snapshotId}\nApproved: ${decision.data.approvedAt}\nThis records your organization's decision; it is not an official government order.`,
          },
        },
      },
    },
  }
  try {
    const result = await (
      send ||
      ((message) => new SESv2Client({}).send(new SendEmailCommand(message)))
    )(payload)
    const after = await store.get(
      `DECISIONS#${job.workspaceId}`,
      job.decisionId,
    )
    if (after?.data.delivery === 'delivery_unknown')
      await store.replace(
        `DECISIONS#${job.workspaceId}`,
        job.decisionId,
        {
          ...after.data,
          delivery: 'accepted',
          acceptedAt: new Date().toISOString(),
          messageId: result.MessageId,
        },
        after.version,
      )
  } catch {
    console.warn(
      JSON.stringify({
        event: 'notification_delivery_uncertain',
        decisionId: job.decisionId,
      }),
    )
  }
}
export async function handler(event) {
  const store = await getStore(),
    batchItemFailures = []
  for (const record of event.Records || []) {
    try {
      const job = JSON.parse(record.body)
      if (job.type === 'review.deliver') await deliverReview(job, store)
      else await deliver(job, store)
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures }
}
