import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { parseDocument } from 'yaml'
const tags = [
  'Ref',
  'Sub',
  'GetAtt',
  'If',
  'Not',
  'Equals',
  'And',
  'Condition',
].map((name) => ({
  tag: `!${name}`,
  resolve: (value) => value,
}))
const doc = parseDocument(await readFile('template.yaml', 'utf8'), {
  customTags: tags,
})
assert.equal(doc.errors.length, 0, doc.errors.map((e) => e.message).join('\n'))
const stack = doc.toJS(),
  resources = stack.Resources
for (const name of [
  'EvidenceTable',
  'ArchiveBucket',
  'ProviderSecret',
  'RefreshQueue',
  'Api',
  'WebAcl',
  'WafAssociation',
  'ReadFunction',
  'IngestFunction',
  'DispatchFunction',
  'NotificationFunction',
  'DeliveryEventsFunction',
  'EmailConfiguration',
  'EmailEventDestination',
  'DeliveryFeedbackDlq',
  'DeliveryFeedbackDlqPolicy',
  'DeliveryFeedbackAlarm',
  'UserPool',
  'UserClient',
  'MonthlyBudget',
])
  assert.ok(resources[name], `${name} is defined`)
assert.ok(
  !JSON.stringify(stack).includes('FunctionUrlConfig'),
  'No endpoint bypasses API Gateway/WAF',
)
assert.ok(
  !Object.keys(stack.Parameters).some((name) =>
    /key|secret|password/i.test(name),
  ),
  'Secrets are not stack parameters',
)
assert.equal(stack.Parameters.MaxActiveStations.Default, 40)
assert.equal(stack.Parameters.MaxActiveStations.MinValue, 20)
assert.equal(stack.Parameters.MaxActiveStations.MaxValue, 40)
assert.equal(
  stack.Globals.Function.Environment.Variables.AIRDAY_MAX_ACTIVE_STATIONS,
  'MaxActiveStations',
)
assert.equal(resources.UserClient.Properties.GenerateSecret, false)
assert.deepEqual(resources.UserClient.Properties.AllowedOAuthFlows, ['code'])
assert.equal(
  resources.EvidenceTable.Properties.PointInTimeRecoverySpecification
    .PointInTimeRecoveryEnabled,
  true,
)
assert.equal(
  resources.ArchiveBucket.Properties.PublicAccessBlockConfiguration
    .BlockPublicPolicy,
  true,
)
assert.ok(
  resources.RefreshQueue.Properties.VisibilityTimeout >=
    6 * resources.IngestFunction.Properties.Timeout,
)
assert.equal(
  resources.IngestFunction.Properties.Events.Queue.Properties.BatchSize,
  1,
)
for (const flag of [
  'SharedWorkspacesEnabled',
  'ReviewEmailEnabled',
  'PublicEvidenceEnabled',
  'PublicRedistributionReviewed',
  'WeatherEnabled',
  'FiresEnabled',
  'FirmsProductVerified',
]) {
  assert.equal(
    String(stack.Parameters[flag].Default),
    'false',
    `${flag} is off by default`,
  )
  assert.deepEqual(stack.Parameters[flag].AllowedValues.map(String), [
    'true',
    'false',
  ])
}
for (const name of ['UserPool', 'UserClient', 'UserDomain'])
  assert.equal(
    resources[name].Condition,
    'SharedWorkspaces',
    `${name} is optional`,
  )
for (const name of [
  'NotificationDlq',
  'NotificationQueue',
  'NotificationFunction',
  'EmailConfiguration',
  'EmailEventDestination',
  'DeliveryEventsFunction',
  'DeliveryFeedbackDlq',
  'DeliveryFeedbackDlqPolicy',
  'DeliveryEventsLogs',
  'DeliveryFeedbackAlarm',
  'NotificationLogs',
])
  assert.equal(
    resources[name].Condition,
    'EmailDelivery',
    `${name} is optional`,
  )
assert.equal(resources.EvidenceTable.Condition, 'CreateEvidenceTable')
assert.deepEqual(stack.Conditions.CreateEvidenceTable, [
  'RestoredEvidenceTable',
  '',
])
assert.deepEqual(stack.Conditions.SharedWorkspaces, [
  ['ReleaseScope', 'Full'],
  ['SharedWorkspacesEnabled', 'true'],
])
assert.equal(stack.Parameters.ReleaseScope.Default, 'R0R2')
assert.deepEqual(stack.Parameters.ReleaseScope.AllowedValues, ['R0R2', 'Full'])
assert.equal(
  stack.Globals.Function.Environment.Variables.RELEASE_SCOPE,
  'ReleaseScope',
)
assert.deepEqual(stack.Rules.SharedWorkspaceReleasePrerequisite.RuleCondition, [
  'SharedWorkspacesEnabled',
  'true',
])
assert.deepEqual(
  stack.Rules.SharedWorkspaceReleasePrerequisite.Assertions[0].Assert,
  ['ReleaseScope', 'Full'],
)
assert.deepEqual(stack.Conditions.EmailDelivery, [
  'SharedWorkspaces',
  ['ReviewEmailEnabled', 'true'],
  'HasSender',
])
assert.equal(
  stack.Globals.Function.Environment.Variables.SHARED_WORKSPACES_ENABLED,
  'SharedWorkspacesEnabled',
)
for (const key of [
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'COGNITO_DOMAIN',
]) {
  const value = resources.ReadFunction.Properties.Environment.Variables[key]
  assert.equal(value[0], 'SharedWorkspaces', `${key} needs staff enablement`)
  assert.equal(value[2], 'AWS::NoValue', `${key} is absent when disabled`)
}
for (const functionName of ['ReadFunction', 'DispatchFunction']) {
  const variables = resources[functionName].Properties.Environment.Variables
  for (const key of ['NOTIFICATION_QUEUE_URL', 'NOTIFICATION_SENDER']) {
    assert.equal(
      variables[key][0],
      'EmailDelivery',
      `${functionName}/${key} needs email enablement`,
    )
    assert.equal(
      variables[key][2],
      'AWS::NoValue',
      `${functionName}/${key} is absent when disabled`,
    )
  }
}
for (const key of ['UserPoolId', 'ClientId', 'AuthDomain'])
  assert.equal(stack.Outputs[key].Condition, 'SharedWorkspaces')
for (const key of ['NotificationDlqUrl', 'DeliveryFeedbackDlqUrl'])
  assert.equal(stack.Outputs[key].Condition, 'EmailDelivery')
assert.equal(stack.Rules.ReviewEmailPrerequisites.Assertions.length, 2)
assert.equal(resources.AlertTopic.Condition, 'HasAlertEmail')
for (const name of [
  'IngestAlarm',
  'QueueAlarm',
  'DlqAlarm',
  'DeliveryFeedbackAlarm',
])
  assert.deepEqual(
    resources[name].Properties.AlarmActions,
    ['HasAlertEmail', ['AlertTopic'], 'AWS::NoValue'],
    `${name} only sends notifications when an operator email is configured`,
  )
assert.equal(
  resources.NotificationFunction.Properties.Environment.Variables
    .SES_CONFIGURATION_SET,
  'EmailConfiguration',
)
assert.equal(
  resources.DeliveryEventsFunction.Properties.Events.Feedback.Type,
  'EventBridgeRule',
)
assert.equal(
  resources.DeliveryFeedbackDlqPolicy.Properties.PolicyDocument.Statement[0]
    .Principal.Service,
  'events.amazonaws.com',
)
assert.ok(
  resources.DeliveryFeedbackDlqPolicy.Properties.PolicyDocument.Statement[0]
    .Condition.ArnEquals['aws:SourceArn'],
)
assert.equal(
  resources.DeliveryEventsFunction.Properties.EventInvokeConfig
    .DestinationConfig.OnFailure.Type,
  'SQS',
)
assert.deepEqual(
  resources.EmailEventDestination.Properties.EventDestination
    .MatchingEventTypes,
  ['DELIVERY', 'BOUNCE', 'COMPLAINT', 'REJECT', 'RENDERING_FAILURE'],
)
assert.ok(
  resources.DispatchFunction.Properties.Environment.Variables
    .NOTIFICATION_QUEUE_URL,
)
assert.ok(
  resources.NotificationQueue.Properties.VisibilityTimeout >=
    6 * resources.NotificationFunction.Properties.Timeout,
)
console.log(
  'Infrastructure contract checks passed. Run SAM validate --lint for CloudFormation schema checks; deployment still requires AWS credentials.',
)
