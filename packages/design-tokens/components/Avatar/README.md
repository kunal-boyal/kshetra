# Avatar

An avatar stands for a person who has no photo: their initials on a pastel chip. RankBadge puts a place in a ranking on the same round chip.

## Anatomy
- **Avatar:** `ks-ico round` with the person's initials, in one of the eight pastel hues. Sizes are `sm` (32), `md` (40), `lg` (48) and `xl` (72).
- **RankBadge:** `ks-seq`. First place is in `butter`, second in `sand`, third in `sage`; later places have no hue.

## The consumer provides
- The person's name and ID. `initialsOf()` and `avatarHue()` in `@thelamp/shared` pick the letters and the hue, so a person keeps one colour in the portal, the console and the phone.
- For RankBadge, the rank and its spoken label ("Rank 2").

## Rules
- Initials: the first letter of the first and last words. A Devanagari letter stays whole with its vowel sign ("सुजो").
- Beside a written name the avatar is decoration and hidden from screen readers. Standing alone, it is named.
- The hue never carries meaning. Status goes in a badge.
- Outdoor draws a 2 px ring in the text colour, as every `ks-ico` does.
