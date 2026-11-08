import { getCountries, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { fail } from './domain';
export const countries=getCountries();
export function phoneForWhatsApp(raw:string,country='AT'){
  const value=raw.trim();if(!value)fail('Telefonnummer fehlt.');
  if(!countries.includes(country as CountryCode))fail('Das Standardland ist nicht gültig konfiguriert.');
  const parsed=parsePhoneNumberFromString(value,{defaultCountry:country as CountryCode,extract:false});
  if(!parsed||!parsed.isValid()||parsed.ext)fail('Telefonnummer ist nicht eindeutig verarbeitbar. Bitte Nummer und Standardland prüfen.');
  if(!value.startsWith('+')&&!value.startsWith('00')&&parsed.formatNational().startsWith('0')&&!value.replace(/[\s().-]/g,'').startsWith('0'))fail('Lokale Telefonnummer ist ohne Orts- oder Mobilvorwahl nicht eindeutig verarbeitbar.');
  return parsed.number;
}
export function storedPhone(raw:string,country='AT'){if(!raw.trim())return '';try{return phoneForWhatsApp(raw,country);}catch{return raw.trim();}}
