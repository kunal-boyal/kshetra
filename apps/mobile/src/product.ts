import Constants from 'expo-constants';

/** The product's display name, from the app config, which takes it from PRODUCT_NAME (spec D1). */
export const PRODUCT_NAME: string =
  (Constants.expoConfig?.extra?.productName as string | undefined) ?? 'Kshetra';
