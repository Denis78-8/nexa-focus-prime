# NEXA Admin Panel: legacy data mapping

This file records only the defaults found in the retired localStorage employee fixtures. Those fixtures are not a trusted identity source and must not create Supabase users or grant access by display name.

| Legacy identity | Supabase identity match | Legacy default | Migration state |
| --- | --- | --- | --- |
| Denis Savinov | `denis.savinov@nexa.ru`, exact email with confirmed Supabase Auth address | Owner; access level 5; VIP | Owner is granted by the migration only after Supabase confirms this exact email. Profile display name is not used for authorization. |
| Valeria Blohina | No verified Auth UUID/email was present in the old fixtures | VIP | Not assigned. Link manually to a confirmed Auth UUID before importing the VIP flag. |
| Directors in old fixtures | No verified Auth UUID/email mapping available | Access level 4 | Not assigned. Resolve each person to a confirmed Auth UUID and grant explicitly. |
| Other old fixture employees | No verified Auth UUID/email mapping available | Access level 2 | Not assigned. New invitations receive level 2 by default. |

No localStorage password, demo password, synthetic `@nexa.local` email, phone number, or other contact value is copied into Supabase. The legacy roster remains a reference only until each person is matched to a real, confirmed Auth identity.
