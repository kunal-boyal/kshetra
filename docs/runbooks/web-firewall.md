# The web firewall

Every cell's load balancer and every web portal's CloudFront distribution sit behind AWS WAF (spec 13, decisions D67 and D98). This runbook says what the rules do, how to read what they caught, and when to change them.

## What the rules do

| Where | Rule | What it does |
|---|---|---|
| Load balancer | `SignInPerAddress` | Blocks an address making more than `sign_in_per_5_minutes` (300) sign-in attempts in 5 minutes. It counts only requests that come straight to the cell, which in practice means phones. |
| Load balancer | `AWSManagedRulesCommonRuleSet` | Blocks common attacks. Its body-size rule only counts, as imports and logos arrive as bodies up to 20 MB and the API checks sizes itself. |
| Load balancer | `AWSManagedRulesKnownBadInputsRuleSet` | Blocks known exploit patterns. |
| Load balancer | `AWSManagedRulesAmazonIpReputationList` | Blocks addresses AWS knows as bad. |
| Load balancer | `AWSManagedRulesSQLiRuleSet` | Counts SQL injection patterns without blocking, until the pilot shows free-text notes don't trip it. |
| CloudFront (portal, console) | `SignInPerViewer` | Blocks a browser's address making more than 300 sign-in attempts in 5 minutes. CloudFront sees the real address, which the load balancer can't. |
| CloudFront (portal, console) | `AWSManagedRulesAmazonIpReputationList` | As above. |

Sign-in attempts are the paths matched by `^/(auth/v1/(otp|totp|oauth|sso|support)/|platform/v1/(session|setup)(/confirm)?$)`. Token refresh, sign-out and switching tenants stay outside it, so many phones behind one carrier address are never throttled for staying signed in. The API keeps its own limits per number and per address as well (spec 11.1).

CloudFront sends every request it passes to the cell with an `X-Origin-Verify` header. Terraform makes the header's value once and keeps it in its state. The load balancer's sign-in rule skips requests that carry it, as CloudFront's own rule has counted them by viewer. The header is redacted from the WAF's logs.

## Reading what the rules caught

- **Sampled requests:** in the console, WAF & Shield › Web ACLs › `<environment>-cell1` (region ap-south-1) or `<environment>-edge` (Global). Each rule keeps three hours of samples.
- **Logs:** the cell's WAF writes every request to the log group `aws-waf-logs-<environment>-cell1`, kept 30 days, with `authorization`, `cookie` and `x-origin-verify` redacted. A Logs Insights query for what the SQL injection rules would have blocked:

  ```
  fields @timestamp, httpRequest.clientIp, httpRequest.uri
  | filter nonTerminatingMatchingRules.0.ruleId = "AWSManagedRulesSQLiRuleSet"
  | sort @timestamp desc
  ```

- **Metrics:** each rule has its own CloudWatch metric under `AWS/WAFV2`.

## Changing them

- **Turn the SQL injection rules on** once a month of the pilot's samples shows only attacks, not people's notes. In `infra/modules/cell/load-balancer.tf`, set the set's `count` to `false`.
- **A carrier's address blocked at sign-in:** raise `sign_in_per_5_minutes` on the cell (and on the web module, if browsers are affected), apply, and note why in the incident's record.
- **An attack the rules miss:** add a rule to the ACL concerned, in count mode first, and read its samples before blocking.
- Every change is applied with Terraform, never in the console, so the next apply doesn't undo it.
