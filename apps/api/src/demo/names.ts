/**
 * Everything the demo content is made of (decision D70). People and businesses are fictional; the
 * towns are real places around Nashik, so maps look right. Nothing here names a real person or
 * firm.
 */

/** A small, seeded random source, so the same seed makes the same demo. */
export class Dice {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** A number in [0, 1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  shuffle<T>(list: readonly T[]): T[] {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.floor(this.next() * (index + 1));
      [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
  }
}

export const FIRST_NAMES = [
  'Aarti',
  'Abhijit',
  'Ajay',
  'Amol',
  'Anil',
  'Ashwini',
  'Balasaheb',
  'Deepak',
  'Ganesh',
  'Gauri',
  'Harish',
  'Jayant',
  'Kavita',
  'Kiran',
  'Mahesh',
  'Manisha',
  'Nandini',
  'Nilesh',
  'Pooja',
  'Pradeep',
  'Prakash',
  'Pravin',
  'Rahul',
  'Rajesh',
  'Ravi',
  'Rohini',
  'Sachin',
  'Sandeep',
  'Sanjay',
  'Santosh',
  'Shital',
  'Sneha',
  'Sunil',
  'Suresh',
  'Swati',
  'Tushar',
  'Vaishali',
  'Vijay',
  'Vinod',
  'Yogesh',
] as const;

export const SURNAMES = [
  'Aher',
  'Bhamre',
  'Borse',
  'Chavan',
  'Deshmukh',
  'Gaikwad',
  'Ghuge',
  'Jadhav',
  'Kadam',
  'Kale',
  'Kulkarni',
  'More',
  'Nikam',
  'Pagar',
  'Patil',
  'Pawar',
  'Salunkhe',
  'Sangle',
  'Shinde',
  'Sonawane',
  'Thakare',
  'Wagh',
] as const;

/** Market towns around Nashik, with their centres. */
export const MARKETS = [
  { code: 'NIP', name: 'Niphad', lat: 20.08, lng: 74.11 },
  { code: 'SIN', name: 'Sinnar', lat: 19.845, lng: 73.998 },
  { code: 'DIN', name: 'Dindori', lat: 20.203, lng: 73.833 },
  { code: 'CHA', name: 'Chandwad', lat: 20.327, lng: 74.248 },
  { code: 'YEO', name: 'Yeola', lat: 20.042, lng: 74.489 },
  { code: 'PIM', name: 'Pimpalgaon Baswant', lat: 20.17, lng: 73.99 },
  { code: 'IGA', name: 'Igatpuri', lat: 19.696, lng: 73.563 },
  { code: 'TRI', name: 'Trimbakeshwar', lat: 19.932, lng: 73.53 },
] as const;

export type Market = (typeof MARKETS)[number];

/** Villages for farmers and meetings, beside each market's own name. */
export const VILLAGES = [
  'Ozar',
  'Lasalgaon',
  'Vinchur',
  'Kasbe Sukene',
  'Pimpri',
  'Mohadi',
  'Khedgaon',
  'Vadner',
  'Shirwade',
  'Saykheda',
  'Kherwadi',
  'Talwade',
  'Rui',
  'Bhendali',
  'Nandur',
  'Dhondgavhan',
] as const;

interface Parts {
  first: string;
  surname: string;
  town: string;
}

type Pattern = (parts: Parts) => string;

/** A product the demo puts in the catalogue: an item code, a product name, a pack and its price. */
export interface DemoProduct {
  code: string;
  product: string;
  pack: string;
  mrp: string;
  taxRate: string;
}

/**
 * The words of one industry's demo (decision D97): what its businesses are called, what it sells,
 * what its people write and where its gatherings meet. What the demo makes still follows the
 * tenant's configuration; the flavour only names and words it.
 */
export interface Flavour {
  /** Names of accounts that supply others, such as distributors. */
  suppliers: readonly Pattern[];
  /** Names of the other businesses, such as shops. */
  shops: readonly Pattern[];
  /** Names by the account type's English name, before the patterns above. */
  byTypeName: readonly { match: RegExp; names: readonly Pattern[] }[];
  products: readonly DemoProduct[];
  outcomes: readonly string[];
  observations: readonly string[];
  rejections: readonly string[];
  /** Where activities without an account happen: villages, halls. */
  gatherings: readonly string[];
  /** What such activities are about, for fields asking for a topic. */
  topics: readonly string[];
  /** The chance of such an activity after each stop. */
  activityChance: number;
}

const AGRI: Flavour = {
  suppliers: [
    (parts) => `${parts.surname} Agri Distributors, ${parts.town}`,
    (parts) => `${parts.town} Krishi Distributors`,
    (parts) => `${parts.surname} and Sons Agro Corporation`,
  ],
  shops: [
    (parts) => `${parts.surname} Krishi Seva Kendra`,
    (parts) => `${parts.town} Agro Agencies`,
    (parts) => `Shree ${parts.surname} Fertilisers`,
    (parts) => `Kisan Seeds and Pesticides, ${parts.town}`,
    (parts) => `${parts.surname} Agro Traders`,
    (parts) => `Jai Kisan Krishi Bhandar, ${parts.town}`,
  ],
  byTypeName: [],
  products: [
    { code: 'VRD-1KG', product: 'Vriddhi 19:19:19', pack: '1 kg', mrp: '420', taxRate: '18' },
    { code: 'KVC-500', product: 'Kavach fungicide', pack: '500 ml', mrp: '780', taxRate: '18' },
    { code: 'SKT-250', product: 'Shakti bio-stimulant', pack: '250 ml', mrp: '360', taxRate: '18' },
    { code: 'RKS-100', product: 'Rakshak insecticide', pack: '100 ml', mrp: '540', taxRate: '18' },
    { code: 'ANK-50', product: 'Ankur seed treatment', pack: '50 g', mrp: '190', taxRate: '18' },
    {
      code: 'HRB-1KG',
      product: 'Hara Bhara micronutrient',
      pack: '1 kg',
      mrp: '310',
      taxRate: '18',
    },
  ],
  outcomes: [
    'Discussed the new season plan; the owner will order after the bank payment clears.',
    'Stock of Vriddhi is low; asked them to place an order this week.',
    'Explained the dose and spray interval; farmers asked for a field demo next week.',
    'Collected the pending payment and took the next order.',
    'Shared the scheme for this month; good interest in Kavach.',
    'Checked liquidation of last month’s stock: most of it has sold.',
    'Met the owner and the counter staff; display of our products is now at the front.',
    'Crop looks healthy after the second spray; farmer will recommend it to neighbours.',
    'Competition is offering a discount; we need to follow up with the scheme details.',
    'Meeting went well; 30 farmers attended and asked about seed treatment.',
  ],
  observations: [
    'Treated plot shows better root growth than the untreated one.',
    'Leaf colour improved within a week of the spray.',
    'Fewer pests seen on the treated rows; farmer is satisfied.',
    'Early stage; will check again after ten days.',
  ],
  rejections: [
    'The photo doesn’t show the shop. Please take one with the board in view next time.',
    'The amount looks wrong. Please check it with the distributor’s ledger.',
    'Please write what was discussed; “ok” isn’t enough.',
  ],
  gatherings: VILLAGES,
  topics: ['Seed treatment', 'Spray schedule', 'Soil health', 'Crop nutrition'],
  activityChance: 0.4,
};

const PHARMA: Flavour = {
  suppliers: [
    (parts) => `${parts.surname} Pharma Distributors, ${parts.town}`,
    (parts) => `${parts.town} Medical Agencies`,
    (parts) => `Shree ${parts.surname} Pharmaceuticals`,
  ],
  shops: [
    (parts) => `${parts.surname} Medical Stores`,
    (parts) => `${parts.town} Chemists and Druggists`,
    (parts) => `Shree ${parts.surname} Medicals`,
    (parts) => `Apna Medical, ${parts.town}`,
    (parts) => `${parts.surname} Pharmacy`,
  ],
  byTypeName: [
    {
      match: /doctor|physician/i,
      names: [(parts) => `Dr. ${parts.first} ${parts.surname}`],
    },
    {
      match: /hospital|clinic|nursing/i,
      names: [
        (parts) => `${parts.surname} Hospital, ${parts.town}`,
        (parts) => `${parts.town} Multispeciality Hospital`,
        (parts) => `Shree ${parts.surname} Nursing Home`,
        (parts) => `Sanjeevani Clinic, ${parts.town}`,
      ],
    },
  ],
  products: [
    { code: 'CFX-200', product: 'Cefoxa 200', pack: '10 tablets', mrp: '118', taxRate: '12' },
    { code: 'PNT-40', product: 'Pantorel 40', pack: '15 tablets', mrp: '96', taxRate: '12' },
    { code: 'GLM-2', product: 'Glimora M2', pack: '15 tablets', mrp: '142', taxRate: '12' },
    { code: 'ATV-10', product: 'Atorvin 10', pack: '10 tablets', mrp: '88', taxRate: '12' },
    { code: 'CLD-60', product: 'Calodex D3', pack: '4 capsules', mrp: '64', taxRate: '12' },
    { code: 'MTF-500', product: 'Metfora 500', pack: '20 tablets', mrp: '52', taxRate: '12' },
  ],
  outcomes: [
    'Doctor agreed to start Glimora M2 for new diabetic patients.',
    'Detailed Pantorel 40; doctor asked for the comparison study next visit.',
    'Chemist has stock of Cefoxa for a week; will reorder through the stockist.',
    'Doctor prescribes Atorvin regularly; asked for patient education leaflets.',
    'Stockist cleared the expiry returns; next supply on Monday.',
    'Collected the pending payment and took the next order.',
    'Doctor was busy; met the assistant and left samples with the request slip.',
    'Competition is offering a bonus scheme; shared our offer on Calodex D3.',
  ],
  observations: [
    'Good attendance; doctors asked about dosing in renal impairment.',
    'Camp screened patients for blood sugar; several referred to the clinic.',
    'Speaker’s session on lipid management was well received.',
  ],
  rejections: [
    'The call needs the products you detailed. Please add them.',
    'The photo doesn’t show the venue. Please take one with the banner in view next time.',
    'Please write what the doctor committed to; “ok” isn’t enough.',
  ],
  gatherings: [
    'IMA Hall, Nashik Road',
    'Hotel Panchavati banquet hall',
    'Civil Hospital auditorium',
    'Rotary Hall, College Road',
  ],
  topics: [
    'Managing type 2 diabetes',
    'Lipid management in practice',
    'Rational use of antibiotics',
    'Vitamin D deficiency',
    'Free blood sugar camp',
  ],
  activityChance: 0.05,
};

/** The flavour of a tenant's industry template; any other template takes agri's. */
export function flavourOf(templateKey: string): Flavour {
  return templateKey === 'pharma' ? PHARMA : AGRI;
}

function parts(dice: Dice, town: string): Parts {
  return { first: dice.pick(FIRST_NAMES), surname: dice.pick(SURNAMES), town };
}

/** A name for an account of a type, by the type's own name, or as a supplier or a shop. */
export function placeName(
  dice: Dice,
  flavour: Flavour,
  typeName: string,
  kind: 'supplier' | 'person' | 'shop',
  town: string,
): string {
  const named = flavour.byTypeName.find((entry) => entry.match.test(typeName));
  if (named) return dice.pick(named.names)(parts(dice, town));
  if (kind === 'person') return personName(dice);
  return dice.pick(kind === 'supplier' ? flavour.suppliers : flavour.shops)(parts(dice, town));
}

/** Whether accounts of a type are people, such as farmers or doctors, rather than businesses. */
export function personType(key: string): boolean {
  return /farmer|doctor|patient|person|contact/.test(key);
}

export function personName(dice: Dice): string {
  return `${dice.pick(FIRST_NAMES)} ${dice.pick(SURNAMES)}`;
}
