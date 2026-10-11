# Airday operator guide

Current release scope is **R0/R1/R2**. R3 is paused; R4/R5 are deferred. **AWS sign-in, provisioning, deployment and cloud restore have not been completed.** Cloud instructions below describe the final deployment step, not an existing deployed service.

## Local service

Run `pnpm dev` and open `http://127.0.0.1:5174/`. API health is `http://127.0.0.1:3001/api/health`. Stop with Ctrl+C in its terminal. Restart after changing `.env`.

```powershell
node scripts/operator.mjs status --local
node scripts/operator.mjs coverage --local
node scripts/operator.mjs backup --local
```

For **pause, resume, restore or erase**, stop `pnpm dev` first: the file store has one writer. The operator checks the API PID and refuses concurrent modification. Restart afterward. A stale PID file can be removed only after confirming that the recorded process is no longer this API.

```powershell
node scripts/operator.mjs pause --local
node scripts/operator.mjs resume --local
node scripts/operator.mjs restore --local --file <absolute-backup-path> --confirm
```

Restore validates backup rows and preserves a copy of the previous state, including unreadable state. Backups contain operational data and belong in private storage. Forecast archives are under `.airday-local/archives/forecast/`. The operator backup covers the server store; it excludes browser-local planning data.

In the app's Settings, users can export a versioned planning JSON backup and import one up to **2 MB**. Import validates the document and previews its contents before merge or replacement. Replacement uses an inline review and explicit confirmation; corrupted-store recovery preserves the damaged original and replacement in one transaction. Conflicting records cannot be silently merged. Import does not send the document to the server. A session-only result is labelled when persistence fails; it is not a durable backup. Keep these private exports separate from shareable reports, which omit private planning details.

## AWS prerequisites and deployment

Required for the default scope: a signed-in AWS CLI profile with provisioning rights for CloudFormation/IAM, Lambda, API Gateway, WAF, DynamoDB, SQS, EventBridge Scheduler, S3, Secrets Manager, CloudWatch and Amplify. SNS and AWS Budgets permissions are additionally needed when supplying an operator alert email. Cognito, SES and the notification/delivery-feedback resources are omitted from the default `R0R2` stack; they are not prerequisites for this release.

Do not share account passwords, session tokens or keys in chat. Depending on the account, use AWS CLI `aws login --profile airday --region ap-south-1`, or the organization's IAM Identity Center `aws configure sso` / `aws sso login` flow. A browser link is short-lived; generate a fresh one when ready. The earlier login attempt in this project did not complete.

Save provider keys locally in `.env`; they remain server-only. The existing OpenAQ key has powered live local readings and can be used for the first monitor-enabled launch. Another provider key is not required for R0/R1/R2. data.gov.in is optional and cannot replace the measurement-contract review. Review Open-Meteo's terms for the intended hosted use; its commercial key is needed if the chosen use requires that service.

```powershell
pnpm preflight
.\scripts\deploy-aws.ps1 -Profile airday -Region ap-south-1 -ReleaseScope R0R2 -AlertEmail <operator-email>
```

`pnpm preflight` checks local prerequisites/configuration; it does not establish cloud permissions, credits or a completed deployment. The script's default `R0R2` gate currently selects **24 test files** and excludes R3/R4/R5, workspace and pilot integration suites. It runs scoped tests, lint, configuration/security/infra checks and frontend/API builds before cloud identity or provisioning. Repeat the final combined local gate after the latest browser fixes before signing in and deploying.

At the cloud step, the script creates/reuses Amplify to determine the site origin, deploys SAM, transfers provider credentials out of band to Secrets Manager, uploads the frontend, configures security headers, polls deployment and warms Delhi evidence. It records non-secret configuration, including `releaseScope`, in `.airday-deploy.json`. Deployment smoke checks require `R0R2` capabilities, no staff auth configuration, schema-valid evidence and a current monitor observation timestamp. Successful deployment does not establish station accuracy or complete coverage.

The example's `-AlertEmail` creates an operator SNS subscription and an **account-wide $75 monthly budget** with actual-cost notifications above **$20/$50/$75**. Confirm the SNS subscription. Omitting `-AlertEmail` omits those resources; CloudWatch alarms remain visible without email actions. Budget alerts are notifications, not a spending cap or automatic shutdown. Verify the actual credit balance and expiry before publishing.

Core charge-bearing resources include Amplify storage/transfer, API Gateway and WAF, three Lambdas, refresh SQS/DLQ, Scheduler, DynamoDB on demand with point-in-time recovery, private S3 archives, one Secrets Manager secret and CloudWatch logs/metrics/alarms. Archive objects expire after 90 days and noncurrent S3 versions after seven days; core logs have seven-day retention. Retained tables, archives and secrets can continue costing money after stack deletion. The **$15–$35/month low-traffic allowance is a planning estimate**, not a verified bill; see [AWS_R0_R2_DEPLOYMENT_REVIEW.md](AWS_R0_R2_DEPLOYMENT_REVIEW.md) for assumptions and pricing references.

The default scope refuses `-SharedWorkspaces`, `-ReviewEmail`, `-NotificationSender`, weather, fires and public-evidence options. These paused integrations require an explicit future `Full` release and separate acceptance; a sender flag alone does not enable email. Automatic OpenAQ archival independently requires reviewed source licenses and the explicit `-ArchiveOpenAq` switch.

## Cloud controls, coverage and backup

Cloud operator commands use `.airday-deploy.json` and its AWS profile. They need only the relevant operator IAM permissions; application users cannot run these privileged operations.

```powershell
node scripts/operator.mjs status
node scripts/operator.mjs coverage
node scripts/operator.mjs pause
node scripts/operator.mjs resume
node scripts/operator.mjs backup
```

Pause is read by workers and the dispatcher. Existing evidence stays accessible with original dates and an on-screen paused warning. In-flight upstream calls may finish. CloudWatch shows provider/archive failures, queue age and the refresh DLQ. R0/R1/R2 has no notification queue, SES delivery state or staff-workspace writes.

For a provider outage or 429, verify the source status and old timestamp. Do not clear the source cache or insert an example value. Review credentials and limits; cooldown and due refresh resume automatically. A source metadata change should fail its contract and remain unverified until reviewed.

### Restore drill

1. Pause ingestion. Export a new backup and note the current table/output configuration. Browser-local planning data needs its separate Settings export; a DynamoDB restore does not restore it.
2. Restore DynamoDB backup/PITR to a **new** table using the AWS console or documented CLI `restore-table-from-backup` / `restore-table-to-point-in-time` operation. Verify its status is ACTIVE.
3. Check `pk`/`sk`, the `Timeline` GSI, encryption and representative evidence, forecast-run and sensor-history records. Re-enable TTL on `expireAt` and point-in-time recovery; restored settings must not be assumed.
4. Redeploy in `R0R2` scope with `-RestoredEvidenceTable <new-table-name>` and the intended operator alert email. The template switches function environment and scoped table permissions, without creating a second unused evidence table. Keep the original table for rollback.
5. Verify health, scoped config, public dashboard/history contracts, original provider timestamps and representative archived evidence. Inspect failure/capacity states and confirm browser-local plans remain accessible separately. Resume only after inspection.

No cloud restore drill has been run yet. Local persistence and transaction semantics have offline checks. Account resources retained by CloudFormation, on-demand backups and deployment packages need an explicit cleanup/retention policy; stack deletion alone does not erase them.

## Historical R3 operator procedures — paused

The following procedures are retained for a future R3 release. **Do not perform them for the current R0/R1/R2 release.** Their resources, endpoints and frontend controls are disabled by the default scope. A future release must explicitly choose `Full`; shared accounts additionally require `-SharedWorkspaces`, and scheduled email requires `-ReviewEmail`, a verified sender and a signing key. These are separate verification and deployment gates, not current credential requirements.

R3 adds local/shared area groups, opted-in scheduled review emails/briefs, a separate public evidence projection and independently gated weather/FIRMS context. See [IMPLEMENTATION_R3.md](IMPLEMENTATION_R3.md) for flags, quotas, endpoints and verification gates. The deployment script requires explicit FIRMS product/key and public redistribution configuration before enabling their respective modules.

Subscription plan sync requires explicit consent and the administrator-synchronized verified account email. Revocation stops evaluation, purges the synced plan/area and frees admission; workspace erasure includes subscriptions/outbox records, including owners whose membership moved. Signed unsubscribe uses an explicit POST confirmation, generation rotation and expiry. Queued deliveries recheck consent/membership/destination immediately before send. Unknown SES outcomes must not be blindly resent.

In a future email-enabled stack, monitor `DeliveryFeedbackAlarm` and the stack output `DeliveryFeedbackDlqUrl`; neither exists in the default release. Its dedicated queue contains failed SES feedback events or Lambda failure envelopes; investigate and replay the original SES event to `DeliveryEventsFunction`, never to the notification queue. A `delivery_unknown` must not be automatically resent because SES has no exactly-once request token. Keep accepted and delivered states distinct; bounce/complaint suppression persists until investigated. The feedback handler validates source/account/configuration-set, owner/record, message ID and destination hash. Provider and feedback integration/recovery require actual cloud drills before release.

Guest use requires no account. To enable a pilot institution, provision its own workspace ID and roles. The operator never sends invitation emails automatically.

```powershell
node scripts/operator.mjs member --email <email> --workspace <organization-id> --role owner --password-file <private-temporary-password-file>
node scripts/operator.mjs member --email <existing-email> --workspace <organization-id> --role reviewer
node scripts/operator.mjs revoke --email <email>
```

For new users, keep the temporary password file private and outside the repository; Cognito forces its change. Verify email through the account flow before enabling delivery, then rerun membership provisioning to synchronize the verified-email flag. Users explicitly enable their own notification preference. Owner/approver plan saves reject stale versions; proposals require the corresponding shared activity, a matching locally reviewed plan and a server-held evidence snapshot. A changed plan/policy, material forecast change, lost coverage or newly stale forecast evidence requires a new review before approval. Follow-through is recorded after approval.

Operational data erasure uses an explicit `erase-workspace --workspace <id> --confirm` command. It removes active organization rows/memberships/preferences. Cognito identities have a separate administration deletion process. Restorable backups retain prior data until their retention expires; document the retention to pilot organizations and honor requests through the operator process. Review membership transfers and reset any old notification preference when changing organizations.

## Policy and measurement contracts

`api/config/cpcb-contract.json` starts **unverified**. Only change it after reviewing official dataset documentation and an authenticated response. Record concentration quantity, exact unit, mean period in seconds, timestamp field/meaning, source document, reviewer and review time. `provider_update` is not re-labelled as measurement end. Ambiguous index/averaging data stays out of numerical concentration displays.

`api/config/policies.json` starts empty. Reviewed records use these fields:

```json
{
  "id": "document-identifier",
  "title": "Issuing authority document title",
  "kind": "order",
  "status": "reviewed",
  "jurisdictions": ["verified city or state label"],
  "effectiveFrom": "YYYY-MM-DD",
  "effectiveTo": "YYYY-MM-DD",
  "url": "https://issuing-authority/document",
  "documentHash": "SHA256_OF_THE_ACTUAL_DOCUMENT",
  "reviewedBy": "reviewer identifier",
  "reviewedAt": "ISO_TIMESTAMP_WITH_TIMEZONE",
  "instruction": "Reviewed instruction preserving scope and exceptions",
  "revokedAt": null
}
```

This is a schema example, not a real order. Follow linked amendments/revocations, distinguish schedules/advisories/invocation orders, check applicable education instructions and re-review at least daily. Changes are included in the API bundle on redeployment; the default does not scrape or infer current law.

`station-mappings.json` records manually verified cross-feed station/origin identities with source, provider station ID, canonical station ID, optional origin ID, review evidence URL, reviewer and date. Do not infer identity from a nearby coordinate or similar name.

Run `pnpm check:config` and rebuild/redeploy after review. Schema validation does not authenticate the factual interpretation or reviewer's work.

## Prospective evaluation

Collect real forecast archives first. Reconciled OpenAQ hours are stored with original periods, revisions and first retrieval time. Export one sensor's bounded history for research after reviewing its license:

```powershell
node scripts/operator.mjs export-history --sensor <numeric-sensor-id>
node scripts/evaluate.mjs --input .airday-local/archives --cutoff <ISO-holdout-cutoff> --threshold <your-review-number> --output .airday-local/evaluation.json
```

For cloud forecasts, download the authorized private archive to a local research folder, then use the same evaluator. Confirm every plotted value's timestamp/unit/statistic and mark test-only data. The report approximates period averages from model samples, rejects hindsight forecasts, reports error/threshold misses and separates chronological holdout data. It does not enable corrected values in the app or prove health benefits. Investigate station quality, reporting delays, missingness and season/lead-time coverage before interpreting results.

Interview at least 3–5 potential users about decision authority, acceptable times, indoor options, notice requirements and follow-through. A campus sensor pilot additionally needs installation, reference collocation, humidity effects, maintenance and calibration. These are external research/operations gates, not implemented sensor accuracy or purifier automation.
