# Steps

Steps show a sequence and where it stands: done, now, turned down, still to come. ApprovalSteps is the same for an approval chain.

## Anatomy
`ks-steps` of `ks-step`s, each with:
- a node: a check when done, a cross when turned down, an `accent` ring when current, hollow when to come;
- the title in `ks-title`;
- a `ks-meta` line for who, when or what happens next.

## The consumer provides
Each step's state, title and line, in the reader's language.

## Rules
- Each step says its state in words; the node only helps scanning.
- Steps to come are muted, never hidden: people should see what follows.
- Times are on the tenant's clock.
