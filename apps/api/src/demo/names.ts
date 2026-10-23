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
  surname: string;
  town: string;
}

const SHOP_PATTERNS = [
  (parts: Parts) => `${parts.surname} Krishi Seva Kendra`,
  (parts: Parts) => `${parts.town} Agro Agencies`,
  (parts: Parts) => `Shree ${parts.surname} Fertilisers`,
  (parts: Parts) => `Kisan Seeds and Pesticides, ${parts.town}`,
  (parts: Parts) => `${parts.surname} Agro Traders`,
  (parts: Parts) => `Jai Kisan Krishi Bhandar, ${parts.town}`,
] as const;

const DISTRIBUTOR_PATTERNS = [
  (parts: Parts) => `${parts.surname} Agri Distributors, ${parts.town}`,
  (parts: Parts) => `${parts.town} Krishi Distributors`,
  (parts: Parts) => `${parts.surname} and Sons Agro Corporation`,
] as const;

export function shopName(dice: Dice, town: string): string {
  return dice.pick(SHOP_PATTERNS)({ surname: dice.pick(SURNAMES), town });
}

export function distributorName(dice: Dice, town: string): string {
  return dice.pick(DISTRIBUTOR_PATTERNS)({ surname: dice.pick(SURNAMES), town });
}

export function personName(dice: Dice): string {
  return `${dice.pick(FIRST_NAMES)} ${dice.pick(SURNAMES)}`;
}

/** The catalogue's fictional products: an item code, a product name and a pack. */
export const PRODUCTS = [
  { code: 'VRD-1KG', product: 'Vriddhi 19:19:19', pack: '1 kg', unit: 'pack', mrp: '420' },
  { code: 'KVC-500', product: 'Kavach fungicide', pack: '500 ml', unit: 'pack', mrp: '780' },
  { code: 'SKT-250', product: 'Shakti bio-stimulant', pack: '250 ml', unit: 'pack', mrp: '360' },
  { code: 'RKS-100', product: 'Rakshak insecticide', pack: '100 ml', unit: 'pack', mrp: '540' },
  { code: 'ANK-50', product: 'Ankur seed treatment', pack: '50 g', unit: 'pack', mrp: '190' },
  { code: 'HRB-1KG', product: 'Hara Bhara micronutrient', pack: '1 kg', unit: 'pack', mrp: '310' },
] as const;

/** What people write in long text fields, by the kind of field. */
export const OUTCOMES = [
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
] as const;

export const OBSERVATIONS = [
  'Treated plot shows better root growth than the untreated one.',
  'Leaf colour improved within a week of the spray.',
  'Fewer pests seen on the treated rows; farmer is satisfied.',
  'Early stage; will check again after ten days.',
] as const;

export const REJECTIONS = [
  'The photo doesn’t show the shop. Please take one with the board in view next time.',
  'The amount looks wrong. Please check it with the distributor’s ledger.',
  'Please write what was discussed; “ok” isn’t enough.',
] as const;
