# Infrastructure

Terraform for the cells (spec 14.2, decision D67). Nothing here is applied by CI: CI checks that it is formatted and valid, and the Deploy workflow only rolls images and the web portal out.

| Path | What it is |
|---|---|
| `environments/staging`, `environments/production` | One environment each, in its own AWS account, with its state in that account's S3 bucket |
| `modules/environment` | Everything one environment holds: network, image repository, certificates, the cell, the web portal, the platform console when it has a domain, and the deploy role |
| `modules/network` | A VPC across two zones: public, private and database subnets, NAT and an S3 endpoint |
| `modules/cell` | The load balancer with WAF, ECS services, PostgreSQL, Valkey, media storage behind CloudFront, logs and alarms |
| `modules/web` | A single-page app's bucket and CloudFront, which also passes its API paths to the cell: `/v1` and `/auth` for the web portal, `/platform` for the console |
| `modules/ecr` | The image repository: immutable tags, scanned on push |
| `modules/github-deploy` | The role GitHub Actions takes by OIDC, for the main branch's deploys only |
| `scripts/deploy-cell.sh`, `scripts/publish-web.sh` | What the Deploy workflow runs, usable by hand for a rollback |

The defaults are the lean pilot cell: a single-zone database and one Valkey node, one API task and one worker, a few hundred US dollars a month. A production cell raises the sizes in its environment's `cell` block (`db_multi_az`, `db_replica`, `redis_nodes`, `nat_per_zone`, `endpoints`, the API's count), not in the modules.

Setting an environment up, and deploying to it: [docs/runbooks/deploy.md](../docs/runbooks/deploy.md).
