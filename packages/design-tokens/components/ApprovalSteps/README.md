# ApprovalSteps

Approval steps show a request's whole chain — who acted, what they said and when, and who it waits for now.

## States per step
`done` (`success-solid` node with check) · `current` (`waiting` ring and dot; meta shows SLA) · `rejected` (`danger-solid` node with ×; the note is shown in full) · not reached (empty node, muted title).

## The consumer provides
Steps from the workflow instance: approver (person or resolved role), designation, decision, note, time. Every node also says its state in words for screen readers.
