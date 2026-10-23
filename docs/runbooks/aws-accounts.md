# AWS accounts

How the AWS accounts are opened, once (decision D67, chosen by Kunal on 2026-10-23). The company owns them, as an AWS Organization of three: a management account that holds only billing and sign-in, and member accounts for staging and production, where everything runs. After this, [deploy](deploy.md) sets up each environment.

## Before you start

- **The company is registered** (decision D1), with its PAN and GSTIN. AWS bills Indian customers through AWS India, and the account's legal name and GSTIN go on every invoice.
- **Email on thelamp.in** works, from any mail provider. Make three addresses, which may all deliver to one inbox: `aws@thelamp.in` for the management account, `aws-staging@thelamp.in` and `aws-production@thelamp.in` for the members. Each account's root user is one of them, and AWS sends its security notices there.
- **A password manager** for the root passwords, and an authenticator app or security key for MFA.
- **A company card**, or one you can claim back.

## 1. The management account

1. Sign up at aws.amazon.com with `aws@thelamp.in`, as a **Business** account in the company's legal name, with its GSTIN and registered address. Choose the Basic support plan.
2. Give the root user a long generated password, and turn on MFA at once (IAM › Security credentials). Never create access keys for the root user.
3. In Account › Alternate contacts, name billing, operations and security contacts.
4. In Account › IAM user and role access to Billing information, turn access on, so people signed in through Identity Center can see costs.

## 2. The Organization and its members

1. In AWS Organizations, create an organization with all features.
2. Add two accounts: `thelamp-staging` with `aws-staging@thelamp.in`, and `thelamp-production` with `aws-production@thelamp.in`. Note each account's 12-digit ID.
3. In IAM › Root access management, turn on centralized root access for the members, and remove their root credentials. The management account can still recover a member's root if one is ever needed.
4. Optional, once something runs: a service control policy keeping the members in Mumbai and the global services. Test it in staging before attaching it to production.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MumbaiAndGlobalOnly",
      "Effect": "Deny",
      "NotAction": [
        "acm:*", "budgets:*", "ce:*", "cloudfront:*", "health:*", "iam:*", "kms:*",
        "organizations:*", "route53:*", "route53domains:*", "s3:ListAllMyBuckets",
        "shield:*", "sso:*", "sts:*", "support:*", "trustedadvisor:*", "wafv2:*"
      ],
      "Resource": "*",
      "Condition": { "StringNotEquals": { "aws:RequestedRegion": ["ap-south-1", "us-east-1"] } }
    }
  ]
}
```

`us-east-1` stays open because CloudFront's certificates live there.

## 3. Sign-in through IAM Identity Center

1. Turn on IAM Identity Center in `ap-south-1`, with its own identity store.
2. Add a user for Kunal with his `thelamp.in` address, and require MFA at every sign-in.
3. Make a permission set `AdministratorAccess` (AWS's managed policy, 8-hour sessions) and assign it to Kunal in `thelamp-staging` and `thelamp-production`. Make a `Billing` permission set for the management account.
4. Note the AWS access portal URL. From here on, people sign in there, never as root.

## 4. Costs

In the management account, which sees the whole organization's bill:

1. Budgets › a monthly cost budget, with alerts to `aws@thelamp.in` at 50%, 80% and 100% of actual cost, and at 100% of forecast. Set the amount from the cells' sizes in `infra/environments/*/main.tf` priced in the AWS Pricing Calculator, with a margin, and adjust it after the first month's bill.
2. Cost Anomaly Detection › a monitor for AWS services, with a daily summary.
3. Turn on Cost Explorer.

## 5. A trail of what happens

In the management account, CloudTrail › an organization trail for all regions, into a new S3 bucket, with log file validation on. It records every API call in every account, which the incident runbook relies on.

## 6. This machine

The AWS CLI v2 and Terraform 1.17, then one profile per account through Identity Center:

```bash
aws configure sso --profile thelamp-staging      # the access portal URL, region ap-south-1, the staging account, AdministratorAccess
aws configure sso --profile thelamp-production
aws sso login --profile thelamp-staging
aws sts get-caller-identity --profile thelamp-staging
```

## 7. Terraform state

In each member account, a bucket for Terraform's state, named as `backend.hcl.example` expects. For staging (production is the same with its profile and name):

```bash
export AWS_PROFILE=thelamp-staging
account=$(aws sts get-caller-identity --query Account --output text)
bucket="thelamp-staging-terraform-state-$account"
aws s3api create-bucket --bucket "$bucket" --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$bucket" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$bucket" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Then continue with [deploy](deploy.md), step 1, with `AWS_PROFILE` set to the environment's profile.
