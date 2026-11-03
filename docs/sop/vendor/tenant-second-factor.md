# Reset a tenant user's authenticator

| | |
|---|---|
| **Who** | Support or Platform admin (`platform.support.request`) |
| **Where** | Console › a tenant's page › **Reset an authenticator** |
| **Related** | [Enter a tenant as support](support-access.md), [Sign in and look after your account](sign-in-and-your-account.md), [the tenant admin's procedures](../admin/README.md) |

On the web portal, anyone whose role can change who does what (an admin, usually) signs in with an authenticator code after the SMS code. If such a person loses their authenticator and their recovery codes, another admin of the tenant resets it on the person's page in the portal (**Reset the authenticator**). When nobody else in the tenant can, for example a tenant's only admin, the vendor removes it from the console. The person then sets up a new authenticator at their next web sign-in.

This is the tenant's user, not vendor staff: a staff member who lost their own authenticator asks a platform admin to reset their sign-in ([Manage staff](manage-staff.md)).

## Before you start

- Make sure no other admin of the tenant can reset it in the portal. If one can, ask them to.
- Confirm who is calling, outside this call: for example, call back on the number the tenant has for them, and check with someone at the customer you already know. You record how you confirmed it.
- You don't need a support grant for this.

## Steps

1. Open the tenant's page and find the **Reset an authenticator** card. It says it is for someone who has lost their authenticator and their recovery codes, when no other admin can reset it.
2. Enter **Their mobile number**: the ten digits they sign in with.
3. In **How you confirmed it is them**, write how you checked, in a sentence.
4. Select **Reset**.
5. The card says "Removed. They set up a new authenticator at their next sign-in.", or, if they had none, "They had no authenticator; their sessions have ended."
6. Tell the person to sign in on the web again: after the SMS code, the portal asks them to set up a new authenticator.

## What the system checks

- The number must belong to someone in this tenant; the person is found by it.
- Their authenticator is removed, and every session they have ends, whether or not they had one.
- The reset is recorded in the platform audit, with the reason you gave. It doesn't reach the tenant's own audit log or its admins, so tell the customer's contact what you did.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Under **Their mobile number**: "Nobody in this tenant has this number" | No one in this tenant signs in with this number | Check the number and the tenant with the caller |
| The field explains the number is wrong before anything is sent | It isn't a ten-digit Indian mobile number | Enter the ten digits, without +91 |
| You don't have access to this. | Your role isn't Support or Platform admin | Ask Support |

## Waiting on the owner

- MSG91 with DLT: in production the person's SMS code at their next sign-in needs MSG91 and its DLT template.
