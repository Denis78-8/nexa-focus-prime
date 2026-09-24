# NEXA corporate mail architecture

**Real mailbox provisioning is not configured yet.** NEXA can suggest and reserve an address in its database, but the current provider adapter does not create a mailbox at an external mail service.

## Data model

`public.corporate_mailboxes` is the registry for corporate addresses. It is linked to immutable `auth.users.id` through `user_id`; names are display data only. The email, local part, domain, lifecycle status, optional provider identifiers, primary flag, creator, timestamps, disabled time and non-secret JSON metadata are stored separately from `profiles`.

The older `profiles.mailbox_status` compatibility field is not the source of truth and is no longer shown as the mailbox lifecycle; `corporate_mailboxes.status` is authoritative.

The email is lowercase and unique in PostgreSQL. A partial unique index allows one primary address per Auth user. The database status enum is `pending`, `active`, `suspended`, `disabled`, or `error`. A `pending` record means the address is reserved by NEXA; it does not prove an external mailbox exists.

`mailbox_audit_events` records `mailbox_created`, `mailbox_disabled`, `mailbox_enabled`, `mailbox_deleted`, and `mailbox_provision_failed`, with actor UUID, target UUID, timestamp and non-secret metadata. It must never contain passwords, provider credentials, access tokens, invitation tokens or recovery codes.

## Address rules

The server reads `NEXA_MAIL_DOMAIN`, defaulting to `nexa.ru`. It is a server-only setting and must not use a `VITE_` prefix. The address utility transliterates Cyrillic, normalizes case/spacing/apostrophes, keeps hyphens and multi-part names, and validates a conservative ASCII local-part format. Names use the first token followed by remaining name tokens; therefore hyphenated surnames remain hyphenated and multi-token surnames remain distinguishable.

The server checks both existing corporate addresses and existing profile/Auth emails. It proposes the base address first, then appends `2`, `3`, and so on before `@domain`. The database UNIQUE constraint remains the final concurrency guard. Suggesting an address never inserts a row.

## Provider contract and lifecycle

`src/lib/corporate-mail.server.ts` defines `CorporateMailProvider` operations for create, disable, enable, delete, lookup and invitation delivery. The current Null provider returns `provider_not_configured` for every operation. It cannot claim that an external operation succeeded.

The current admin flow is:

1. Invite a person through the existing Supabase Auth invite flow using an email they can access.
2. Suggest a separate corporate address from the profile name.
3. Let an authorized administrator confirm the suggestion.
4. Insert a `pending` reservation and an audit event. Call the provider abstraction.
5. Since no provider is configured, record `mailbox_provision_failed` with `provider_not_configured`, retain the pending reservation, and tell the administrator that no real mailbox was created.

When a real provider is selected later, its adapter should create the external mailbox after reservation and update the row to `active` only after the provider confirms success. Disable and enable should update provider state first and then the NEXA status. Deletion should normally be archival: retain the NEXA row and audit history, mark it `disabled`, and store `disabled_at`; only permanently remove a row when retention and provider deletion policies are defined. Auth identities cannot be hard-deleted while a mailbox references them; audit target UUIDs remain recorded if an Auth identity is later removed after proper archival. All transitions should be server-side and append an audit event.

## Security and secrets

RLS permits a signed-in employee to read only their own mailbox row. Administrative reads require `mailboxes.read`. Direct authenticated inserts, updates and deletes are revoked. Reservations and lifecycle changes run only in authenticated server functions after checking `mailboxes.manage`; service-role access stays in server-only code.

No corporate mailbox password is generated or stored by NEXA. Employees set their own Supabase Auth password through the existing Auth flow. Future provider API credentials must live only in server-side deployment secrets (for example, the hosting platform's encrypted environment/secret store), never in source control, database metadata, `profiles`, localStorage or `VITE_*` variables. The selected provider, secret names, scopes, rotation process and webhook verification requirements must be documented when a provider is chosen; no provider is selected here.

## Future integration checklist

- Implement the `CorporateMailProvider` contract in a server-only adapter for the provider chosen by NEXA.
- Configure `NEXA_MAIL_DOMAIN` and provider secrets in the server deployment environment.
- Make create/disable/enable/delete idempotent and reconcile provider responses with pending/error rows.
- Add signed webhook handling if provider events are used; verify signatures and deduplicate event IDs.
- Add safe retry/reconciliation for reservations created before a provider timeout.
- Keep Supabase Auth invitations separate from mailbox provisioning. Never send or store a user's password through NEXA.
