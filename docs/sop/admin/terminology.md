# Use your organisation's own words

| | |
|---|---|
| **Who** | Admin or Business head (`terminology.manage`) |
| **Where** | Web portal › **Settings** › **Organisation** › **Terminology**, or **Change words** on the Organisation page |
| **Module** | Core |
| **Related** | [Set up the organisation and its brand](organisation-and-branding.md), [Define account types](account-types.md) |

Ten terms change from one industry to another. The apps never print them as fixed words: they use your organisation's word wherever the term appears, in menus, buttons, messages and notifications. Your template already set most of them; change any your people call something else.

## Before you start

- Agree the words with the people who will use them, in English and in Hindi.

## The terms

| Term | Product's word (English) | Product's word (Hindi) | Template words |
|---|---|---|---|
| Account | Account, Accounts | खाता, खाते | Kept in every template; each account type has its own name, such as Distributor or Doctor ([Define account types](account-types.md)) |
| Field user | Field user, Field users | फ़ील्ड कर्मचारी | SME (agri), MR (pharma), DSR (FMCG), TSM (building) |
| Activity | Activity, Activities | गतिविधि, गतिविधियाँ | Call (pharma) |
| Journey plan | Journey plan, Journey plans | यात्रा योजना, यात्रा योजनाएँ | Beat plan (agri), Tour plan (pharma), PJP (FMCG) |
| Planned visit | Planned visit, Planned visits | नियोजित विज़िट | Beat (agri, FMCG) |
| Target | Target, Targets | लक्ष्य | |
| Order | Order, Orders | ऑर्डर | POB (pharma) |
| Sell-through | Sell-through | सेल-थ्रू | Liquidation (agri) |
| Start day (a label) | Start day | दिन शुरू करें | Punch in (agri) |
| End day (a label) | End day | दिन खत्म करें | Punch out (agri) |

## Steps

1. Open **Settings** › **Organisation** › **Terminology**. Each term has its own section, headed with your current word.
2. For a noun, fill **One, in English** and **Many, in English**, and **One, in Hindi** and **Many, in Hindi**. For the two labels (Start day and End day), fill **In English** and **In Hindi**. A Hindi box left empty takes the English word.
3. Words your template set are already filled in. Each empty box shows the product's word faintly. Leave every box of a term empty to keep the product's word.
4. Select **Save**. The page says **Saved.** If a term is only partly filled in, nothing is saved: the page says **Some terms are only partly filled in. Finish them, or clear them to keep the product's words. Nothing was saved.**, and each English box still empty says **Fill this in too, or clear the term to keep the product's word.**
5. The web uses the new words at once. Phones use them at their next sync.

## What the system checks

- A term you type in needs its English whole: both **One** and **Many** for a noun. Hindi left empty takes the English, as on the other configuration pages. Nothing is saved while a term is partly filled in, so no word is dropped silently.
- A noun's form is up to 60 characters; a label up to 40.
- Messages that name a term change with it, such as **You are too far from this account.** becoming "You are too far from this customer." if you call accounts Customer. Write each word as it should read at the start of a sentence; the apps lower its first letter mid-sentence, leaving acronyms such as SME as they are.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some terms are only partly filled in. Finish them, or clear them to keep the product's words. Nothing was saved. | A term has a word in some boxes but an English box is empty; that box says **Fill this in too, or clear the term to keep the product's word.** | Fill the box, or clear the whole term, and save again. |
| Some details need fixing. Check the highlighted fields. | A box is too long or not accepted. The box says why. | Shorten it and save again. |
| You don't have access to this. | Your role lacks `terminology.manage`. | Ask an admin. |
| A phone still shows the old word. | The phone hasn't synced since. | Ask the person to open the app online and sync. |

## Waiting on the owner

- The Hindi words in the templates and the product await a native speaker's review.
