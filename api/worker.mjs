import { runtime } from './runtime.mjs'
export async function handler(event) {
  const { engine, context } = await runtime(),
    batchItemFailures = []
  for (const record of event.Records || []) {
    try {
      const job = JSON.parse(record.body)
      if(job.type==='context.refresh')await context.refresh(job)
      else if(job.type==='refresh')await engine.refresh(job.area)
      else throw new Error('Unknown job')
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId })
      console.warn(
        JSON.stringify({
          event: 'refresh_job_failed',
          messageId: record.messageId,
        }),
      )
    }
  }
  return { batchItemFailures }
}
