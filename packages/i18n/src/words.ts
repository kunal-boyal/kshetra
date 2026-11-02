import type { Locale } from '@thelamp/shared';

/**
 * An amount in rupees written out in words in the Indian system (crore, lakh, thousand, hundred),
 * for a payslip's net pay (decision D128): "Twenty-two thousand three hundred seventy-seven
 * rupees", "बाईस हज़ार तीन सौ सतहत्तर रुपये", with paise when there are any.
 */

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

/** Hindi has its own word for every number below a hundred. */
const HI_BELOW_100 = [
  'शून्य',
  'एक',
  'दो',
  'तीन',
  'चार',
  'पाँच',
  'छह',
  'सात',
  'आठ',
  'नौ',
  'दस',
  'ग्यारह',
  'बारह',
  'तेरह',
  'चौदह',
  'पंद्रह',
  'सोलह',
  'सत्रह',
  'अठारह',
  'उन्नीस',
  'बीस',
  'इक्कीस',
  'बाईस',
  'तेईस',
  'चौबीस',
  'पच्चीस',
  'छब्बीस',
  'सत्ताईस',
  'अट्ठाईस',
  'उनतीस',
  'तीस',
  'इकतीस',
  'बत्तीस',
  'तैंतीस',
  'चौंतीस',
  'पैंतीस',
  'छत्तीस',
  'सैंतीस',
  'अड़तीस',
  'उनतालीस',
  'चालीस',
  'इकतालीस',
  'बयालीस',
  'तैंतालीस',
  'चवालीस',
  'पैंतालीस',
  'छियालीस',
  'सैंतालीस',
  'अड़तालीस',
  'उनचास',
  'पचास',
  'इक्यावन',
  'बावन',
  'तिरपन',
  'चौवन',
  'पचपन',
  'छप्पन',
  'सत्तावन',
  'अट्ठावन',
  'उनसठ',
  'साठ',
  'इकसठ',
  'बासठ',
  'तिरसठ',
  'चौंसठ',
  'पैंसठ',
  'छियासठ',
  'सड़सठ',
  'अड़सठ',
  'उनहत्तर',
  'सत्तर',
  'इकहत्तर',
  'बहत्तर',
  'तिहत्तर',
  'चौहत्तर',
  'पचहत्तर',
  'छिहत्तर',
  'सतहत्तर',
  'अठहत्तर',
  'उन्यासी',
  'अस्सी',
  'इक्यासी',
  'बयासी',
  'तिरासी',
  'चौरासी',
  'पचासी',
  'छियासी',
  'सत्तासी',
  'अट्ठासी',
  'नवासी',
  'नब्बे',
  'इक्यानबे',
  'बानबे',
  'तिरानबे',
  'चौरानबे',
  'पंचानबे',
  'छियानबे',
  'सत्तानबे',
  'अट्ठानबे',
  'निन्यानबे',
];

const SCALES: Record<Locale, { crore: string; lakh: string; thousand: string; hundred: string }> = {
  en: { crore: 'crore', lakh: 'lakh', thousand: 'thousand', hundred: 'hundred' },
  hi: { crore: 'करोड़', lakh: 'लाख', thousand: 'हज़ार', hundred: 'सौ' },
};

function below100(value: number, locale: Locale): string {
  if (locale === 'hi') return HI_BELOW_100[value]!;
  if (value < 20) return EN_ONES[value]!;
  const tens = EN_TENS[Math.floor(value / 10)]!;
  return value % 10 === 0 ? tens : `${tens}-${EN_ONES[value % 10]}`;
}

/** A whole number in words, Indian grouping; zero as the word. */
function inWords(value: bigint, locale: Locale): string {
  if (value === 0n) return below100(0, locale);
  const scale = SCALES[locale];
  const parts: string[] = [];
  const crore = value / 10_000_000n;
  let rest = value % 10_000_000n;
  if (crore > 0n) parts.push(`${inWords(crore, locale)} ${scale.crore}`);
  const groups: [bigint, string][] = [
    [100_000n, scale.lakh],
    [1_000n, scale.thousand],
    [100n, scale.hundred],
  ];
  for (const [size, word] of groups) {
    const count = rest / size;
    if (count > 0n) parts.push(`${below100(Number(count), locale)} ${word}`);
    rest %= size;
  }
  if (rest > 0n) parts.push(below100(Number(rest), locale));
  return parts.join(' ');
}

/** `amount` (a decimal string of rupees, two places) in words, rupees and paise. */
export function amountInWords(amount: string, locale: Locale): string {
  const [whole = '0', fraction = ''] = amount.trim().split('.');
  const rupees = BigInt(whole || '0');
  const paise = Number((fraction + '00').slice(0, 2));
  const rupeeWords = inWords(rupees, locale);
  if (locale === 'hi') {
    const text = `${rupeeWords} रुपये`;
    return paise > 0 ? `${text} और ${below100(paise, 'hi')} पैसे` : text;
  }
  const text = `${rupeeWords} rupees`;
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return paise > 0 ? `${capital} and ${below100(paise, 'en')} paise` : capital;
}
